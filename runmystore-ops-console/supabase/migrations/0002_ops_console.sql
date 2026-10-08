-- RMS Ops Console: additive changes on top of 0001 (history import, pagination, KPIs).
-- Nothing here changes the event contract or the RLS model.

-- 1. Timeline pagination across all clients (owners/admins) needs a plain time index.
create index if not exists events_time_idx on public.events (occurred_at desc, id desc);

-- 2. The inbox only reads messages; keep that path narrow.
create index if not exists events_messages_idx on public.events (client_id, occurred_at desc)
  where type in ('message_sent', 'message_received');

-- 3. Backfilled history must not overwrite a bot's latest summary with an older event.
--    last_seen_at / last_event_at / last_error_at already use greatest(); last_summary did not.
create or replace function public.on_event_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.bots b set
    last_seen_at  = greatest(coalesce(b.last_seen_at, new.received_at), new.received_at),
    last_event_at = case when new.type <> 'heartbeat'
                         then greatest(coalesce(b.last_event_at, new.occurred_at), new.occurred_at)
                         else b.last_event_at end,
    last_error_at = case when new.type = 'error'
                         then greatest(coalesce(b.last_error_at, new.occurred_at), new.occurred_at)
                         else b.last_error_at end,
    last_summary  = case when new.type <> 'heartbeat'
                          and new.occurred_at >= coalesce(b.last_event_at, '-infinity'::timestamptz)
                         then new.summary else b.last_summary end
  where b.id = new.bot_id;

  if new.type = 'decision_needed' then
    insert into public.decisions (event_id, bot_id, client_id, question, context, options, priority, due_at, created_at)
    values (
      new.id, new.bot_id, new.client_id,
      coalesce(new.payload #>> '{decision,question}', new.summary),
      new.detail,
      coalesce(new.payload #> '{decision,options}', '[]'::jsonb),
      coalesce((new.payload #>> '{decision,priority}')::smallint, 1),
      (new.payload #>> '{decision,due_at}')::timestamptz,
      least(new.occurred_at, now())
    );
  end if;
  return new;
end $$;

-- 4. KPIs for a date range, index-friendly (the client_daily_stats view groups the whole table first).
--    Runs as the caller, so RLS on events/bots applies.
create or replace function public.client_stats_range(p_from timestamptz, p_to timestamptz)
returns table (
  client_id uuid, events bigint, answered bigint, brought_back bigint, leads_delivered bigint,
  orders bigint, errors bigint, decisions_opened bigint, messages_in bigint, messages_out bigint
)
language sql stable security invoker set search_path = public as $$
  select
    e.client_id,
    count(*),
    count(*) filter (where b.lane = 'cs' and e.type = 'message_sent'),
    count(*) filter (where b.lane = 'retention' and e.payload->>'outcome' in ('reordered','won_back')),
    count(*) filter (where b.lane = 'lead' and e.payload->>'outcome' = 'lead_delivered'),
    count(*) filter (where e.payload->>'outcome' in ('order','reordered','won_back','upsell')),
    count(*) filter (where e.type = 'error'),
    count(*) filter (where e.type = 'decision_needed'),
    count(*) filter (where e.type = 'message_received'),
    count(*) filter (where e.type = 'message_sent')
  from public.events e
  join public.bots b on b.id = e.bot_id
  where e.occurred_at >= p_from and e.occurred_at < p_to
  group by e.client_id
$$;

-- 5. Per-bot activity buckets for sparklines and the 7-day chart (heartbeats excluded).
create or replace function public.bot_activity(p_since timestamptz, p_bucket interval default interval '1 hour', p_bot_id uuid default null)
returns table (bot_id uuid, bucket timestamptz, n bigint, errors bigint)
language sql stable security invoker set search_path = public as $$
  select e.bot_id,
         date_bin(p_bucket, e.occurred_at, timestamptz '2000-01-01 00:00:00+00'),
         count(*),
         count(*) filter (where e.type = 'error')
  from public.events e
  where e.occurred_at >= p_since
    and e.type <> 'heartbeat'
    and (p_bot_id is null or e.bot_id = p_bot_id)
  group by 1, 2
$$;

-- 6. Run summaries for the per-bot ledger: one row per run_id, newest first, keyset-paged by started_at.
create or replace function public.bot_runs(p_bot_id uuid, p_before timestamptz default null, p_limit int default 30)
returns table (
  run_id text, started_at timestamptz, ended_at timestamptz, events bigint,
  messages bigint, crm_writes bigint, errors bigint, decisions bigint, finished boolean
)
language sql stable security invoker set search_path = public as $$
  select e.run_id,
         min(e.occurred_at), max(e.occurred_at), count(*),
         count(*) filter (where e.type in ('message_sent','message_received')),
         count(*) filter (where e.type = 'crm_write'),
         count(*) filter (where e.type = 'error'),
         count(*) filter (where e.type = 'decision_needed'),
         bool_or(e.type = 'run_finished')
  from public.events e
  where e.bot_id = p_bot_id and e.run_id is not null
    and (p_before is null or e.occurred_at < p_before)
  group by e.run_id
  order by 2 desc
  limit greatest(1, least(p_limit, 200))
$$;

revoke execute on function public.client_stats_range(timestamptz, timestamptz) from public, anon;
revoke execute on function public.bot_activity(timestamptz, interval, uuid) from public, anon;
revoke execute on function public.bot_runs(uuid, timestamptz, int) from public, anon;
grant execute on function public.client_stats_range(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.bot_activity(timestamptz, interval, uuid) to authenticated, service_role;
grant execute on function public.bot_runs(uuid, timestamptz, int) to authenticated, service_role;
