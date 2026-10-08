-- SQL test suite for the RMS Ops Console schema. Runs on the local harness after the seed.
-- Every block raises on failure; psql stops at the first error (ON_ERROR_STOP).
\set ON_ERROR_STOP on

-- ---------- fixtures: three users ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'operator@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'viewer@example.com');
insert into public.team_members (user_id, display_name, role, all_clients) values
  ('00000000-0000-0000-0000-000000000001', 'Owner', 'owner', true),
  ('00000000-0000-0000-0000-000000000002', 'Scoped operator', 'operator', false),
  ('00000000-0000-0000-0000-000000000003', 'Viewer', 'viewer', true);
insert into public.client_access (user_id, client_id)
  select '00000000-0000-0000-0000-000000000002', id from public.clients where slug = 'northside-candle';

-- ---------- 1. seed sanity ----------
do $$
declare n_clients int; n_bots int; n_events int; n_open int; n_care int; n_keys int;
begin
  select count(*) into n_clients from public.clients where is_demo;
  select count(*) into n_bots from public.bots;
  select count(*) into n_events from public.events;
  select count(*) into n_open from public.decisions where state = 'open';
  select count(*) into n_care from public.events e join public.bots b on b.id = e.bot_id where b.slug = 'care-pack';
  select count(*) into n_keys from public.bot_keys;
  assert n_clients = 4, 'expected 4 demo clients, got ' || n_clients;
  assert n_bots = 41, 'expected 41 bots (40 + care-pack), got ' || n_bots;
  assert n_events > 3000, 'expected > 3000 events, got ' || n_events;
  assert n_open between 8 and 12, 'expected 8-12 open decisions, got ' || n_open;
  assert n_care > 1500, 'expected > 1500 care-pack events, got ' || n_care;
  assert n_keys = 9, 'expected 9 simulator keys, got ' || n_keys;
  assert (select count(*) from public.bots where open_decisions > 0) >= 8, 'open_decisions counter not maintained';
  raise notice 'seed: % clients, % bots, % events (% care-pack), % open decisions', n_clients, n_bots, n_events, n_care, n_open;
end $$;

-- A Fresh Bros decision id for the cross-client guard, fetched as superuser before switching.
create temp table t_other as
  select id from public.decisions where client_id = (select id from public.clients where slug = 'fresh-bros') and state = 'open' limit 1;
grant select on t_other to public;

-- From here on, behave like PostgREST: session_user = authenticator, role switched per request.
set session authorization authenticator;

-- ---------- 2. anon sees nothing ----------
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
do $$
begin
  begin
    perform count(*) from public.events;
    raise exception 'anon could read events';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- 3. scoped operator sees exactly one client, everywhere ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', false);
set role authenticated;
do $$
declare cid uuid; n int;
begin
  select id into cid from public.clients where slug = 'northside-candle';
  assert (select count(*) from public.clients) = 1, 'operator sees more than one client';
  assert (select count(distinct client_id) from public.events) = 1 and (select count(*) from public.events where client_id <> cid) = 0, 'operator sees other clients events';
  assert (select count(distinct client_id) from public.bots) = 1, 'operator sees other clients bots';
  assert (select count(distinct client_id) from public.decisions) = 1, 'operator sees other clients decisions';
  assert (select count(distinct client_id) from public.client_daily_stats) = 1, 'view leaks across clients';
  assert (select count(*) from public.client_stats_range(now() - interval '30 days', now()) s where s.client_id <> cid) = 0, 'client_stats_range leaks';
  assert (select count(*) from public.bot_activity(now() - interval '7 days') a join public.bots b on b.id = a.bot_id where b.client_id <> cid) = 0, 'bot_activity leaks';
  assert (select count(*) from public.events where client_id = (select id from public.clients where slug = 'fresh-bros')) = 0, 'operator can read Fresh Bros';
  -- cannot write events directly
  begin
    insert into public.events (bot_id, client_id, type, summary) select id, client_id, 'action', 'x' from public.bots limit 1;
    raise exception 'operator inserted an event directly';
  exception when insufficient_privilege then null;
  end;
  -- cannot read key hashes, can read prefixes only as admin (operator is not admin)
  assert (select count(*) from public.bot_keys) = 0, 'operator can list bot keys';
  begin
    perform key_hash from public.bot_keys;
    raise exception 'operator could select key_hash';
  exception when insufficient_privilege then null;
  end;
  -- cannot create keys
  begin
    perform public.create_bot_key((select id from public.bots limit 1), 'x');
    raise exception 'operator created a key';
  exception when insufficient_privilege then null;
  end;
  raise notice 'rls: scoped operator confined to northside-candle';
end $$;
reset role;

-- ---------- 4. decisions loop: scoped operator answers own client, blocked on others ----------
set role authenticated;
do $$
declare d_mine uuid; d_other uuid; d public.decisions; ev public.events; before_open int; after_open int; bid uuid;
begin
  select dd.id, dd.bot_id into d_mine, bid from public.decisions dd join public.clients c on c.id = dd.client_id
    where c.slug = 'northside-candle' and dd.state = 'open' limit 1;
  assert d_mine is not null, 'no open northside decision in seed';
  select open_decisions into before_open from public.bots where id = bid;
  d := public.answer_decision(d_mine, 'approve', 'ok by me');
  assert d.state = 'answered' and d.answer_key = 'approve' and d.answered_by = '00000000-0000-0000-0000-000000000002', 'answer not recorded';
  select * into ev from public.events where id = d.event_id;
  assert ev.status = 'resolved', 'source event not resolved';
  select open_decisions into after_open from public.bots where id = bid;
  assert after_open = before_open - 1, 'open_decisions badge not decremented';
  begin
    perform public.answer_decision(d_mine, 'approve');
    raise exception 'answered twice';
  exception when others then
    assert sqlerrm like 'decision already%', 'unexpected error on second answer: ' || sqlerrm;
  end;
  -- a Fresh Bros decision: the operator must be refused
  select id into d_other from t_other;
  assert d_other is not null, 'fixture missing';
  begin
    perform public.answer_decision(d_other, 'approve');
    raise exception 'operator answered a Fresh Bros decision';
  exception when insufficient_privilege then null;
  end;
  raise notice 'decisions: answer, resolve, badge, double-answer guard, cross-client guard ok';
end $$;
reset role;

-- ---------- 5. viewer can see but cannot act ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', false);
set role authenticated;
do $$
declare d_any uuid;
begin
  assert (select count(*) from public.clients) = 4, 'viewer with all_clients should see 4 clients';
  select id into d_any from public.decisions where state = 'open' limit 1;
  begin
    perform public.answer_decision(d_any, 'approve');
    raise exception 'viewer answered a decision';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_event_status((select id from public.events limit 1), 'resolved');
    raise exception 'viewer changed an event status';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.event_notes (event_id, body) select id, 'hi' from public.events limit 1;
    raise exception 'viewer added a note';
  exception when insufficient_privilege then null;
  end;
  raise notice 'viewer: read-only enforced';
end $$;
reset role;

-- ---------- 6. owner: keys, notes, status ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
set role authenticated;
do $$
declare k text; kid uuid; bid uuid; eid uuid; note public.event_notes;
begin
  select id into bid from public.bots where slug = 'care-pack';
  k := public.create_bot_key(bid, 'test');
  assert k ~ '^rmsb_[0-9a-f]{8}_[0-9a-f]{48}$', 'key format wrong: ' || k;
  select id into kid from public.bot_keys where bot_id = bid and label = 'test';
  assert kid is not null, 'owner cannot list key metadata';
  begin
    perform key_hash from public.bot_keys where id = kid;
    raise exception 'owner could read key_hash';
  exception when insufficient_privilege then null;
  end;
  perform public.revoke_bot_key(kid);
  assert (select revoked_at from public.bot_keys where id = kid) is not null, 'revoke did not stick';
  -- note: client_id and user_id come from the trigger, never the client
  select id into eid from public.events where client_id = (select id from public.clients where slug = 'fresh-bros') limit 1;
  insert into public.event_notes (event_id, client_id, user_id, body)
    values (eid, '00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-00000000dead', 'checked with the customer')
    returning * into note;
  assert note.client_id = (select client_id from public.events where id = eid) and note.user_id = '00000000-0000-0000-0000-000000000001', 'note trigger did not override client/user';
  perform public.set_event_status(eid, 'resolved');
  assert (select status from public.events where id = eid) = 'resolved', 'set_event_status failed';
  raise notice 'owner: key create/revoke, notes, status ok';
end $$;
reset role;

-- ---------- 7. service role: idempotency and the backfill-safe trigger ----------
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
do $$
declare bid uuid; cid uuid; before_summary text; before_seen timestamptz; before_event timestamptz; n int; rows_inserted int;
begin
  select id, client_id, last_summary, last_seen_at, last_event_at into bid, cid, before_summary, before_seen, before_event
    from public.bots where slug = 'care-pack';
  -- idempotent insert: same (bot_id, idempotency_key) twice -> one row
  insert into public.events (bot_id, client_id, type, summary, idempotency_key, occurred_at, received_at)
    values (bid, cid, 'action', 'idem test', 'test:idem:1', now() - interval '90 days', now() - interval '90 days')
    on conflict (bot_id, idempotency_key) do nothing;
  insert into public.events (bot_id, client_id, type, summary, idempotency_key, occurred_at, received_at)
    values (bid, cid, 'action', 'idem test again', 'test:idem:1', now() - interval '90 days', now() - interval '90 days')
    on conflict (bot_id, idempotency_key) do nothing;
  get diagnostics rows_inserted = row_count;
  assert rows_inserted = 0, 'duplicate idempotency key inserted a second row';
  select count(*) into n from public.events where bot_id = bid and idempotency_key = 'test:idem:1';
  assert n = 1, 'expected exactly one row for the idempotency key';
  -- a 90-day-old backfilled row must not move liveness or the latest summary
  assert (select last_summary from public.bots where id = bid) = before_summary, 'old event overwrote last_summary';
  assert (select last_seen_at from public.bots where id = bid) = before_seen, 'old event moved last_seen_at';
  assert (select last_event_at from public.bots where id = bid) = before_event, 'old event moved last_event_at';
  -- a fresh row does
  insert into public.events (bot_id, client_id, type, summary, idempotency_key)
    values (bid, cid, 'action', 'newest thing', 'test:new:1');
  assert (select last_summary from public.bots where id = bid) = 'newest thing', 'new event did not update last_summary';
  -- decision_needed creates a decision; created_at follows occurred_at for history
  insert into public.events (bot_id, client_id, type, summary, idempotency_key, occurred_at, payload)
    values (bid, cid, 'decision_needed', 'old question', 'test:dec:1', now() - interval '10 days',
            '{"decision":{"question":"Old?","options":[{"key":"a","label":"A"}],"priority":3}}');
  assert (select created_at from public.decisions where event_id = (select id from public.events where idempotency_key = 'test:dec:1' and bot_id = bid))
         < now() - interval '9 days', 'decision created_at did not follow occurred_at';
  raise notice 'service role: idempotency + backfill-safe trigger ok';
end $$;

-- ---------- 8. bot-inbox semantics: an answered decision is delivered exactly once ----------
do $$
declare bid uuid; n1 int; n2 int;
begin
  select bot_id into bid from public.decisions where state = 'answered' and delivered_to_bot_at is null limit 1;
  assert bid is not null, 'no undelivered answered decision (expected the one answered in test 4)';
  with d as (
    update public.decisions set delivered_to_bot_at = now()
    where bot_id = bid and state in ('answered','dismissed') and delivered_to_bot_at is null
    returning id)
  select count(*) into n1 from d;
  with d as (
    update public.decisions set delivered_to_bot_at = now()
    where bot_id = bid and state in ('answered','dismissed') and delivered_to_bot_at is null
    returning id)
  select count(*) into n2 from d;
  assert n1 >= 1 and n2 = 0, 'bot-inbox delivered ' || n1 || ' then ' || n2;
  raise notice 'bot-inbox: delivered once (%), then none', n1;
end $$;
reset role;

reset session authorization;

-- ---------- 9. search ----------
do $$
declare n int;
begin
  select count(*) into n from public.events where fts @@ websearch_to_tsquery('english', 'melted gummies');
  assert n > 0, 'full-text search found nothing for "melted gummies"';
  select count(*) into n from public.events where fts @@ websearch_to_tsquery('english', '"care pack" -error');
  assert n > 0, 'websearch operators failed';
  raise notice 'search: fts ok (% hits for melted gummies)', (select count(*) from public.events where fts @@ websearch_to_tsquery('english', 'melted gummies'));
end $$;

-- ---------- 10. reset-demo removes everything demo ----------
\i /home/user/runmystore/runmystore-ops-console/scripts/reset-demo.sql
do $$
begin
  assert (select count(*) from public.clients) = 0, 'reset-demo left clients';
  assert (select count(*) from public.events) = 0, 'reset-demo left events';
  assert (select count(*) from public.bot_keys) = 0, 'reset-demo left keys';
  raise notice 'reset-demo: clean';
end $$;
