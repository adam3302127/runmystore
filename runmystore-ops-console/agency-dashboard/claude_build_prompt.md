# Build prompt: RMS Ops Console (paste into Claude Code)

> **How to use this:** open an empty folder, start **Claude Code** (it needs to run the CLIs; Claude.ai chat can't do that), choose Opus for the build, and paste everything below the line. Have ready: a Supabase account and empty project (ref + DB password), a Vercel account, and the subdomain you want (for example `ops.runmystore.com`). The SQL and Edge Functions below were applied and tested on Oct 7, 2026 against Postgres 17 + PostgREST with Supabase auth stubs (RLS, ingest, idempotency, decisions loop). They have **not** yet been run on a live Supabase project.

---

You're my build partner. Build and deploy a working, production-ready internal web app called **RMS Ops Console** for my agency, RunMyStore (RMS). Lead with judgment: if something below is wrong for the current versions of these tools, say so, fix it, and note what you changed. Debug in a loop until each checkpoint actually works. Don't stop at "should work."

## S: Situation (facts)
- I'm Adam Rahman, founder of Fresh Bros and RunMyStore (runmystore.com, brand "RMS"). Timezone America/New_York.
- RMS runs fleets of AI bots for client stores and businesses: Customer Service, Retention, and Lead Engine modules, plus ops bots. That's about **40 bots across several clients** today.
- The bots run on an assistant platform that has **no public read API**. Nothing can pull from the bots. **Bots must push events.** Each bot run can make HTTP calls or run curl, so every bot will POST JSON events to an ingest endpoint with its own API key.
- Close CRM stays the **system of record for contacts**. Bots write to Close directly and then log a `crm_write` event with the Close id. The console links to Close and does **not** mirror or sync contacts.
- Expected volume: about 8k events/day (~240k/month). Team users: 2–6 people (not clients).

## O: Outcome (what "done" means)
A deployed Next.js app on Vercel, backed by Supabase (Postgres + Realtime + Auth + Edge Functions), where my team can sign in and see, **live**:
1. Every bot's status and health (fleet overview).
2. A full activity ledger per bot, grouped by run.
3. A unified inbox of messages bots sent and received (email, WhatsApp, SMS, chat), with links to Close.
4. A decisions-needed queue that the team answers, with the answer delivered back to the bot.
5. Per-client views with daily KPIs.
6. Search and filtering across everything.

It also needs a demo seed, a live event **simulator**, a README with deploy steps, and the bot curl snippet.

## W: What matters
- **Truly live:** a new event shows up in under ~1 s without a page refresh.
- **Client separation:** a scoped operator must never see another client's data. Enforce this in Postgres RLS, not just in the UI.
- **Security of ingest:** per-bot keys. Store only hashes. The server derives `bot_id`/`client_id` from the key and never from the body. Keys can be revoked.
- **Brand:** it must look like runmystore.com (spec below), not a generic admin template.
- Low cost (Supabase Pro $25 + Vercel), reversible (plain Postgres, my code).

## C: Constraints
- Stack: **Next.js (App Router, TypeScript, latest stable) + Tailwind + `@supabase/ssr` + `@supabase/supabase-js` v2**, deployed on **Vercel**. Supabase CLI for migrations and functions. Use shadcn/ui primitives only where helpful, and restyle them to the brand. Charts: a small sparkline component (hand-rolled SVG or Recharts).
- Auth: Supabase Auth with **email magic link** (Google OAuth optional, behind a toggle). **Public sign-ups disabled.** Users get access only if a row exists in `team_members`, so the middleware redirects anyone else to a "No access" page.
- Edge Functions `ingest` and `bot-inbox` are deployed with `--no-verify-jwt`, because auth is the `x-bot-key` header.
- Privacy toggle `clients.store_message_bodies` (default **false**). When it's false, ingest strips message bodies, so we keep summaries + links only. The homepage promises clients their conversations stay in accounts they own.
- All times display in the viewer's timezone with a zone label (default America/New_York).
- Accessibility: keyboard-navigable, `aria-live="polite"` on the feed, respect `prefers-reduced-motion`.

## D: Don't
- Don't use placeholders, TODOs, lorem ipsum, or "implement later" stubs in shipped code. If a step needs something from me (project ref, keys, domain), stop and ask for exactly that.
- Don't invent features that break the event contract. Don't let the browser write to `events` directly.
- Don't put the service-role key in any client bundle or `NEXT_PUBLIC_*` variable.
- Don't mirror Close contacts. Don't call the Close API from the browser.
- Don't use real customer data in the seed. Use fictional names and `example.com` only.

## Facts / assumptions / decisions / open questions
- **Facts:** listed above.
- **Assumptions (flag if wrong):** about 40 bots; the team is under 10 people; English only; the bots can store two env vars (`RMS_BOT_KEY`, `RMS_INGEST_URL`) plus `RMS_INBOX_URL`.
- **Decisions already made:** Supabase + Next.js on Vercel; Close linked, not mirrored; push-only ingest with per-bot keys; dark brand theme.
- **Open questions (ask me at the right checkpoint, don't guess):** final subdomain; whether Google OAuth is needed; whether to add a Close webhook in phase 2; whether to build a client-facing read-only portal later. The RLS already supports scoping.

---

## 1. Database: apply exactly this migration (`supabase/migrations/0001_init.sql`)
Review it, keep the semantics, and fix anything that's incompatible with current Supabase, then tell me what changed. Notes: pgcrypto lives in the `extensions` schema. `create_bot_key` returns the plaintext key once. Bots never read tables.

```sql
-- RMS Ops Console: initial schema (Supabase / Postgres 15+)
-- pgcrypto lives in the "extensions" schema on Supabase.
create extension if not exists pgcrypto with schema extensions;

-- ---------- enums ----------
create type public.event_type as enum (
  'action','message_sent','message_received','crm_write','alert','error',
  'decision_needed','run_started','run_finished','heartbeat');
create type public.event_status as enum ('ok','pending','failed','needs_review','resolved');
create type public.team_role as enum ('owner','admin','operator','viewer');

-- ---------- tables ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  plan text check (plan in ('cs','retention','lead','run_the_store','custom','internal')),
  status text not null default 'active' check (status in ('onboarding','active','paused','churned')),
  timezone text not null default 'America/New_York',
  close_lead_id text,
  store_message_bodies boolean not null default false,
  accent_color text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  lane text not null default 'ops' check (lane in ('cs','retention','lead','ops','other')),
  platform text,
  description text,
  expected_interval_minutes int not null default 60 check (expected_interval_minutes > 0),
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_event_at timestamptz,
  last_error_at timestamptz,
  last_summary text,
  open_decisions int not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, slug)
);
create index bots_client_idx on public.bots(client_id);

create table public.bot_keys (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  prefix text not null unique,
  key_hash text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  run_id text,
  type public.event_type not null,
  status public.event_status not null default 'ok',
  severity smallint not null default 0 check (severity between 0 and 3),
  summary text not null check (char_length(summary) between 1 and 500),
  detail text check (detail is null or char_length(detail) <= 20000),
  channel text check (channel in ('email','whatsapp','sms','chat','crm','web','phone','internal','other')),
  direction text not null default 'none' check (direction in ('inbound','outbound','none')),
  counterparty_name text,
  counterparty_handle text,
  thread_ref text,
  close_lead_id text,
  close_activity_id text,
  amount_cents bigint,
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  fts tsvector generated always as (
    to_tsvector('english',
      coalesce(summary,'') || ' ' || coalesce(detail,'') || ' ' ||
      coalesce(counterparty_name,'') || ' ' || coalesce(counterparty_handle,''))
  ) stored,
  unique (bot_id, idempotency_key)
);
create index events_client_time_idx on public.events(client_id, occurred_at desc);
create index events_bot_time_idx    on public.events(bot_id, occurred_at desc);
create index events_type_time_idx   on public.events(type, occurred_at desc);
create index events_thread_idx      on public.events(client_id, thread_ref) where thread_ref is not null;
create index events_run_idx         on public.events(bot_id, run_id) where run_id is not null;
create index events_fts_idx         on public.events using gin(fts);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  question text not null,
  context text,
  options jsonb not null default '[]'::jsonb,
  priority smallint not null default 1 check (priority between 0 and 3),
  due_at timestamptz,
  state text not null default 'open' check (state in ('open','answered','dismissed','expired')),
  answer_key text,
  answer_note text,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  delivered_to_bot_at timestamptz,
  created_at timestamptz not null default now()
);
create index decisions_open_idx on public.decisions(state, priority desc, due_at nulls last);
create index decisions_bot_idx  on public.decisions(bot_id, state);

create table public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.team_role not null default 'viewer',
  all_clients boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.client_access (
  user_id uuid not null references public.team_members(user_id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  primary key (user_id, client_id)
);

create table public.event_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) default auth.uid(),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

-- ---------- helper functions (security definer, fixed search_path) ----------
create or replace function public.my_role() returns public.team_role
language sql stable security definer set search_path = public as $$
  select role from public.team_members where user_id = auth.uid()
$$;

create or replace function public.can_see_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    where tm.user_id = auth.uid() and (tm.all_clients or tm.role in ('owner','admin'))
  ) or exists (
    select 1 from public.client_access ca
    where ca.user_id = auth.uid() and ca.client_id = cid
  )
$$;

create or replace function public.can_act() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','admin','operator'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','admin'), false)
$$;

-- ---------- triggers ----------
-- After each event: refresh bot liveness and open a decision when needed.
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
    last_summary  = case when new.type <> 'heartbeat' then new.summary else b.last_summary end
  where b.id = new.bot_id;

  if new.type = 'decision_needed' then
    insert into public.decisions (event_id, bot_id, client_id, question, context, options, priority, due_at)
    values (
      new.id, new.bot_id, new.client_id,
      coalesce(new.payload #>> '{decision,question}', new.summary),
      new.detail,
      coalesce(new.payload #> '{decision,options}', '[]'::jsonb),
      coalesce((new.payload #>> '{decision,priority}')::smallint, 1),
      (new.payload #>> '{decision,due_at}')::timestamptz
    );
  end if;
  return new;
end $$;

create trigger events_after_insert after insert on public.events
for each row execute function public.on_event_inserted();

-- Keep bots.open_decisions in sync.
create or replace function public.refresh_open_decisions() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid uuid := coalesce(new.bot_id, old.bot_id);
begin
  update public.bots set open_decisions =
    (select count(*) from public.decisions d where d.bot_id = bid and d.state = 'open')
  where id = bid;
  return null;
end $$;

create trigger decisions_count after insert or update of state or delete on public.decisions
for each row execute function public.refresh_open_decisions();

-- Ensure note.client_id matches its event (never trust the client).
create or replace function public.set_note_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select client_id into new.client_id from public.events where id = new.event_id;
  new.user_id := auth.uid();
  return new;
end $$;
create trigger event_notes_set_client before insert on public.event_notes
for each row execute function public.set_note_client();

-- ---------- RPCs used by the UI ----------
create or replace function public.answer_decision(p_id uuid, p_answer_key text, p_note text default null, p_dismiss boolean default false)
returns public.decisions
language plpgsql security definer set search_path = public as $$
declare d public.decisions;
begin
  select * into d from public.decisions where id = p_id for update;
  if not found then raise exception 'decision not found'; end if;
  if not (public.can_act() and public.can_see_client(d.client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if d.state <> 'open' then raise exception 'decision already %', d.state; end if;
  update public.decisions set
    state = case when p_dismiss then 'dismissed' else 'answered' end,
    answer_key = p_answer_key, answer_note = p_note,
    answered_by = auth.uid(), answered_at = now()
  where id = p_id returning * into d;
  update public.events set status = 'resolved' where id = d.event_id;
  return d;
end $$;

create or replace function public.set_event_status(p_id uuid, p_status public.event_status)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select client_id into cid from public.events where id = p_id;
  if cid is null then raise exception 'event not found'; end if;
  if not (public.can_act() and public.can_see_client(cid)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.events set status = p_status where id = p_id;
end $$;

-- Create a bot key. Returns the plaintext key ONCE; only its sha256 is stored.
create or replace function public.create_bot_key(p_bot_id uuid, p_label text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_prefix text; v_secret text; v_key text;
begin
  -- allowed: team admins (UI), service role (functions), or a direct postgres session (seed / SQL editor)
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.bots where id = p_bot_id) then raise exception 'bot not found'; end if;
  v_prefix := encode(extensions.gen_random_bytes(4), 'hex');
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');
  v_key := 'rmsb_' || v_prefix || '_' || v_secret;
  insert into public.bot_keys (bot_id, prefix, key_hash, label)
  values (p_bot_id, v_prefix, encode(extensions.digest(v_key, 'sha256'), 'hex'), p_label);
  return v_key;
end $$;

create or replace function public.revoke_bot_key(p_key_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.bot_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
end $$;

-- ---------- KPI view (respects RLS of the caller via security_invoker) ----------
create or replace view public.client_daily_stats with (security_invoker = true) as
select
  e.client_id,
  (e.occurred_at at time zone c.timezone)::date as day,
  count(*) filter (where b.lane = 'cs'        and e.type = 'message_sent')                     as answered,
  count(*) filter (where b.lane = 'retention' and e.payload->>'outcome' in ('reordered','won_back')) as brought_back,
  count(*) filter (where b.lane = 'lead'      and e.payload->>'outcome' = 'lead_delivered')     as leads_delivered,
  count(*) filter (where e.payload->>'outcome' in ('order','reordered','won_back','upsell'))     as orders,
  count(*) filter (where e.type = 'error')                                                       as errors,
  count(*) filter (where e.type = 'decision_needed')                                             as decisions_opened
from public.events e
join public.bots b on b.id = e.bot_id
join public.clients c on c.id = e.client_id
group by 1, 2;
grant select on public.client_daily_stats to authenticated;

-- ---------- RLS ----------
alter table public.clients       enable row level security;
alter table public.bots          enable row level security;
alter table public.bot_keys      enable row level security;
alter table public.events        enable row level security;
alter table public.decisions     enable row level security;
alter table public.team_members  enable row level security;
alter table public.client_access enable row level security;
alter table public.event_notes   enable row level security;

create policy clients_select on public.clients for select to authenticated using (public.can_see_client(id));
create policy clients_admin  on public.clients for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy bots_select on public.bots for select to authenticated using (public.can_see_client(client_id));
create policy bots_admin  on public.bots for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- bot_keys: admins may list prefixes/metadata; key_hash column is not granted (see below).
create policy bot_keys_admin_select on public.bot_keys for select to authenticated using (public.is_admin());

-- events: read-only for the team; writes happen only through the ingest function (service role) or RPCs.
create policy events_select on public.events for select to authenticated using (public.can_see_client(client_id));

create policy decisions_select on public.decisions for select to authenticated using (public.can_see_client(client_id));

create policy team_select on public.team_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy team_admin  on public.team_members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy access_select on public.client_access for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy access_admin  on public.client_access for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy notes_select on public.event_notes for select to authenticated using (public.can_see_client(client_id));
create policy notes_insert on public.event_notes for insert to authenticated
  with check (public.can_act() and public.can_see_client(client_id));

-- Column-level hardening
revoke all on public.bot_keys from anon, authenticated;
grant select (id, bot_id, prefix, label, created_at, last_used_at, revoked_at) on public.bot_keys to authenticated;
revoke insert, update, delete on public.events, public.decisions from anon, authenticated;
revoke all on all tables in schema public from anon;
revoke execute on function public.create_bot_key(uuid, text) from public, anon;
grant execute on function public.create_bot_key(uuid, text) to authenticated, service_role;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.events, public.decisions, public.bots;
```

## 2. Demo seed (`supabase/seed.sql`)
Use this seed: 4 clients (all `is_demo = true`), 40 bots, about 3,000 events over 7 days, 8 open decisions, one stale bot, and one erroring bot. It prints 8 simulator keys at the end. Add a `scripts/reset-demo.sql` that deletes everything where `clients.is_demo` (events → decisions → bots → clients order).

```sql
-- RMS Ops Console: demo seed (safe to re-run on a fresh database; all demo rows have is_demo = true on clients)
-- 4 clients, 40 bots, ~7 days of events, open decisions. Uses fictional people and example.com addresses only.
do $$
declare
  c record; b record; i int; n int; t timestamptz; k int; ev_type public.event_type; lane text;
  bot_names text[] := array['Inbox','Chat','Reorder','Win-back','Post-purchase','Prospector','Qualifier','CRM Sync','Reviews','Ops Watch'];
  bot_lanes text[] := array['cs','cs','retention','retention','retention','lead','lead','ops','retention','ops'];
  cs_in  text[] := array['“Any update on my order?”','“Do you ship to Canada?”','“Can I swap this for a medium?”','“Is this one vegan?”','“Is this still in stock?”','“Where is my refund?”'];
  cs_out text[] := array['Shipped Tuesday, sent the tracking link.','Yes, 5 to 8 days and duties included.','Exchange label sent.','Yes, sent the full ingredient list.','Yes, 14 left, sent a checkout link.','Refund issued Monday, 3–5 business days.'];
  ret_in text[] := array['Reorder reminder: last ordered 34 days ago','Win-back: quiet for 90 days','Follow-up: a week after first order','Review ask: 10 days after delivery'];
  ret_out text[] := array['reordered','won_back','upsell','no_response'];
  lead_in text[] := array['Boutique gym with three locations','Wedding planner','Corporate gifting buyer','Reseller marketplace','Café group, 6 sites'];
  names text[] := array['Jane Doe','Sam Lee','Priya Shah','Marco Ruiz','Ava Chen','Leo Grant','Nora Kim','Omar Haddad'];
begin
  insert into public.clients (slug, name, plan, status, is_demo, accent_color) values
    ('fresh-bros','Fresh Bros','custom','active',true,'#0d7377'),
    ('rms-internal','RunMyStore (internal)','internal','active',true,'#ffffff'),
    ('northside-candle','Northside Candle Co. (demo)','run_the_store','active',true,'#0d7377'),
    ('peak-supplements','Peak Supplements (demo)','cs','onboarding',true,'#0d7377')
  on conflict (slug) do nothing;

  for c in select * from public.clients where is_demo order by created_at loop
    for i in 1..10 loop
      insert into public.bots (client_id, slug, name, lane, platform, expected_interval_minutes, enabled)
      values (c.id, lower(regexp_replace(bot_names[i],'[^A-Za-z]+','-','g')), bot_names[i], bot_lanes[i], 'assistant-platform',
              case when bot_lanes[i]='cs' then 15 when bot_lanes[i]='ops' then 30 else 120 end, not (c.slug='peak-supplements' and i>6))
      on conflict (client_id, slug) do nothing;
    end loop;
  end loop;

  for b in select bt.*, cl.slug as cslug from public.bots bt join public.clients cl on cl.id = bt.client_id where cl.is_demo and bt.enabled loop
    n := case b.lane when 'cs' then 110 when 'ops' then 40 else 50 end;
    for i in 1..n loop
      t := now() - (random() * interval '7 days');
      k := 1 + floor(random()*8)::int;
      if b.lane = 'cs' then
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, payload, links)
        values (b.id, b.client_id, b.slug||'-'||to_char(t,'YYYYMMDDHH24'), 'message_received',
                names[k]||' asked '||cs_in[1+(i % 6)], case when i % 3 = 0 then 'whatsapp' else 'email' end, 'inbound',
                names[k], lower(replace(names[k],' ','.'))||'@example.com', b.cslug||':t'||i, t, t, '{}'::jsonb, '[]'::jsonb);
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, payload, links)
        values (b.id, b.client_id, b.slug||'-'||to_char(t,'YYYYMMDDHH24'), 'message_sent',
                'Replied to '||names[k]||': '||cs_out[1+(i % 6)], case when i % 3 = 0 then 'whatsapp' else 'email' end, 'outbound',
                names[k], lower(replace(names[k],' ','.'))||'@example.com', b.cslug||':t'||i, t + interval '2 minutes', t + interval '2 minutes',
                '{}'::jsonb, '[{"label":"Thread","url":"https://example.com/thread"}]'::jsonb);
      elsif b.lane = 'retention' then
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, occurred_at, received_at, payload, amount_cents)
        values (b.id, b.client_id, b.slug||'-'||to_char(t,'YYYYMMDD'), 'message_sent',
                ret_in[1+(i % 4)]||' → '||names[k], 'email', 'outbound', names[k], lower(replace(names[k],' ','.'))||'@example.com', t, t,
                jsonb_build_object('outcome', ret_out[1+(i % 4)]), case when i % 4 in (0,1,2) then 2500 + floor(random()*9000)::int end);
      elsif b.lane = 'lead' then
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, close_lead_id, occurred_at, received_at, payload, links)
        values (b.id, b.client_id, b.slug||'-'||to_char(t,'YYYYMMDD'),
                case when i % 5 = 3 then 'action' else 'crm_write' end::public.event_type,
                case when i % 5 = 3 then 'Checked '||lead_in[1+(i % 5)]||': not a fit, skipped' else 'New lead: '||lead_in[1+(i % 5)]||', added to Close' end,
                'crm', case when i % 5 <> 3 then 'lead_demo'||i end, t, t,
                jsonb_build_object('outcome', case when i % 5 = 3 then 'skipped' else 'lead_delivered' end),
                case when i % 5 <> 3 then '[{"label":"Open in Close","url":"https://app.close.com/"}]'::jsonb else '[]'::jsonb end);
      else
        ev_type := case when i % 13 = 0 then 'error' when i % 7 = 0 then 'alert' when i % 2 = 0 then 'heartbeat' else 'action' end;
        insert into public.events (bot_id, client_id, run_id, type, severity, status, summary, channel, occurred_at, received_at)
        values (b.id, b.client_id, b.slug||'-'||to_char(t,'YYYYMMDDHH24'), ev_type,
                case ev_type when 'error' then 2 when 'alert' then 1 else 0 end,
                (case ev_type when 'error' then 'failed' else 'ok' end)::public.event_status,
                case ev_type when 'error' then 'Shopify API returned 429 while syncing orders'
                             when 'alert' then 'Inbox volume 3x normal in the last hour'
                             when 'heartbeat' then 'Alive'
                             else 'Synced 24 orders and 3 refunds' end,
                'internal', t, t);
      end if;
    end loop;
  end loop;

  -- open decisions (the trigger creates the decisions rows)
  for b in select bt.* from public.bots bt join public.clients cl on cl.id=bt.client_id where cl.is_demo and bt.lane='cs' and bt.enabled loop
    insert into public.events (bot_id, client_id, type, status, severity, summary, channel, direction, counterparty_name, counterparty_handle, amount_cents, occurred_at, received_at, payload)
    values (b.id, b.client_id, 'decision_needed', 'needs_review', 1,
            'Refund of $240 requested, over the $150 auto-limit', 'email', 'inbound', 'Sam Lee', 'sam.lee@example.com', 24000,
            now() - (random()*interval '6 hours'), now() - (random()*interval '6 hours'),
            '{"decision":{"question":"Approve a full $240 refund for order #1077?","options":[{"key":"approve","label":"Approve"},{"key":"partial","label":"Offer 50%"},{"key":"deny","label":"Deny"}],"priority":2}}'::jsonb);
  end loop;

  -- make one bot look stale and one look erroring right now
  update public.bots set last_seen_at = now() - interval '5 hours'
   where slug = 'reviews' and client_id = (select id from public.clients where slug='northside-candle');
  insert into public.events (bot_id, client_id, type, severity, status, summary, channel)
  select id, client_id, 'error', 3, 'failed', 'Gmail token expired, cannot read inbox', 'internal'
  from public.bots where slug='inbox' and client_id=(select id from public.clients where slug='fresh-bros');
end $$;

-- Demo keys for the simulator (printed once). Store them in .env.local as SIM_BOT_KEYS (comma-separated).
select b.slug, c.slug as client, public.create_bot_key(b.id, 'simulator') as key
from public.bots b join public.clients c on c.id=b.client_id
where c.slug in ('northside-candle','fresh-bros') and b.slug in ('inbox','reorder','prospector','ops-watch');
```

## 3. Edge Functions (`supabase/functions/…`)
Use these three files as-is (Deno, `npm:` specifiers). Deploy with `supabase functions deploy ingest --no-verify-jwt` and `supabase functions deploy bot-inbox --no-verify-jwt`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically on hosted Supabase. **If my project uses the newer `sb_secret_…` API keys instead of the legacy service-role JWT, check the current Supabase docs and adjust the env var**, then tell me.

`supabase/functions/_shared/auth.ts`
```ts
// Shared bot-key auth for RMS Ops Console Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export type BotCtx = {
  keyId: string;
  botId: string;
  clientId: string;
  botSlug: string;
  storeBodies: boolean;
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const KEY_RE = /^rmsb_([0-9a-f]{8})_([0-9a-f]{48})$/;

/** Returns the bot context for a valid, unrevoked key on an enabled bot, else null. */
export async function authBot(req: Request): Promise<BotCtx | null> {
  const key = (req.headers.get("x-bot-key") ?? "").trim();
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const { data, error } = await admin
    .from("bot_keys")
    .select("id, key_hash, revoked_at, bots!inner(id, slug, enabled, client_id, clients!inner(store_message_bodies, status))")
    .eq("prefix", m[1])
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // deno-lint-ignore no-explicit-any
  const bot = (data as any).bots;
  if (!bot?.enabled || bot.clients?.status === "churned") return null;
  if (!safeEqual(await sha256Hex(key), data.key_hash)) return null;
  // best-effort, non-blocking
  admin.from("bot_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return {
    keyId: data.id,
    botId: bot.id,
    clientId: bot.client_id,
    botSlug: bot.slug,
    storeBodies: !!bot.clients?.store_message_bodies,
  };
}
```

`supabase/functions/ingest/index.ts`
```ts
// POST /functions/v1/ingest  (deploy with --no-verify-jwt; auth is the x-bot-key header)
import { z } from "npm:zod@3";
import { admin, authBot, json } from "../_shared/auth.ts";

const EVENT_TYPES = ["action", "message_sent", "message_received", "crm_write", "alert", "error",
  "decision_needed", "run_started", "run_finished", "heartbeat"] as const;

const Link = z.object({ label: z.string().max(80), url: z.string().url().max(2000) });

const Event = z.object({
  type: z.enum(EVENT_TYPES),
  summary: z.string().trim().min(1).max(500),
  status: z.enum(["ok", "pending", "failed", "needs_review", "resolved"]).optional(),
  severity: z.number().int().min(0).max(3).optional(),
  run_id: z.string().max(200).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  channel: z.enum(["email", "whatsapp", "sms", "chat", "crm", "web", "phone", "internal", "other"]).optional(),
  direction: z.enum(["inbound", "outbound", "none"]).optional(),
  counterparty: z.object({ name: z.string().max(200).optional(), handle: z.string().max(320).optional() }).optional(),
  thread_ref: z.string().max(500).optional(),
  close_lead_id: z.string().max(100).optional(),
  close_activity_id: z.string().max(100).optional(),
  amount_cents: z.number().int().optional(),
  detail: z.string().max(20000).optional(),
  links: z.array(Link).max(10).optional(),
  payload: z.record(z.unknown()).optional(),
  decision: z.object({
    question: z.string().min(1).max(1000),
    options: z.array(z.object({ key: z.string().max(50), label: z.string().max(120) })).max(8).optional(),
    priority: z.number().int().min(0).max(3).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
  }).nullable().optional(),
  idempotency_key: z.string().max(300).optional(),
}).superRefine((e, ctx) => {
  if (e.type === "decision_needed" && !e.decision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision_needed requires a decision object", path: ["decision"] });
  }
});

const Body = z.union([Event, z.object({ events: z.array(Event).min(1).max(50) })]);
const BODY_KEYS = ["body", "text", "html", "message", "content"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  const bot = await authBot(req);
  if (!bot) return json(401, { ok: false, error: "invalid or revoked bot key" });

  const raw = await req.text();
  if (raw.length > 256_000) return json(413, { ok: false, error: "body over 256 KB" });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json(400, { ok: false, error: "invalid JSON" }); }
  const res = Body.safeParse(parsed);
  if (!res.success) return json(422, { ok: false, error: "invalid event", issues: res.error.issues });

  const list = "events" in res.data ? res.data.events : [res.data];
  if (list.some((e) => JSON.stringify(e.payload ?? {}).length > 32_000)) {
    return json(413, { ok: false, error: "payload over 32 KB" });
  }
  const now = Date.now();
  const rows = list.map((e) => {
    const payload: Record<string, unknown> = { ...(e.payload ?? {}) };
    let detail = e.detail ?? null;
    const isMessage = e.type === "message_sent" || e.type === "message_received";
    if (isMessage && !bot.storeBodies) { // privacy toggle: summaries + links only
      detail = null;
      for (const k of BODY_KEYS) delete payload[k];
    }
    if (e.decision) payload.decision = e.decision;
    let occurred = e.occurred_at ? Date.parse(e.occurred_at) : now;
    if (occurred > now + 5 * 60_000) occurred = now; // clamp clock skew
    return {
      bot_id: bot.botId, // always from the key, never from the body
      client_id: bot.clientId,
      type: e.type,
      status: e.status ?? (e.type === "decision_needed" ? "needs_review" : e.type === "error" ? "failed" : "ok"),
      severity: e.severity ?? (e.type === "error" ? 2 : e.type === "alert" ? 1 : 0),
      run_id: e.run_id ?? null,
      summary: e.summary,
      detail,
      channel: e.channel ?? null,
      direction: e.direction ?? "none",
      counterparty_name: e.counterparty?.name ?? null,
      counterparty_handle: e.counterparty?.handle ?? null,
      thread_ref: e.thread_ref ?? null,
      close_lead_id: e.close_lead_id ?? null,
      close_activity_id: e.close_activity_id ?? null,
      amount_cents: e.amount_cents ?? null,
      links: e.links ?? [],
      payload,
      idempotency_key: e.idempotency_key ?? null,
      occurred_at: new Date(occurred).toISOString(),
    };
  });

  const { data, error } = await admin
    .from("events")
    .upsert(rows, { onConflict: "bot_id,idempotency_key", ignoreDuplicates: true })
    .select("id, idempotency_key");
  if (error) {
    console.error("ingest insert failed", bot.botSlug, error);
    return json(500, { ok: false, error: "insert failed" });
  }
  const inserted = data ?? [];
  const duplicates = rows.length - inserted.length;
  return json(inserted.length ? 201 : 200, { ok: true, ids: inserted.map((r) => r.id), duplicate: duplicates > 0, duplicates });
});
```

`supabase/functions/bot-inbox/index.ts`
```ts
// GET /functions/v1/bot-inbox  (deploy with --no-verify-jwt). Returns answered/dismissed decisions not yet delivered.
import { admin, authBot, json } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return json(405, { ok: false, error: "GET only" });
  const bot = await authBot(req);
  if (!bot) return json(401, { ok: false, error: "invalid or revoked bot key" });

  const { data, error } = await admin
    .from("decisions")
    .update({ delivered_to_bot_at: new Date().toISOString() })
    .eq("bot_id", bot.botId)
    .in("state", ["answered", "dismissed"])
    .is("delivered_to_bot_at", null)
    .select("id, event_id, question, state, answer_key, answer_note, answered_at");
  if (error) return json(500, { ok: false, error: "lookup failed" });
  return json(200, { ok: true, decisions: data ?? [] });
});
```

**Ingest behaviors to keep:** a single event or `{"events":[…]}` (max 50); 256 KB body cap; 32 KB payload cap; zod validation that returns 422 with issues; dedupe on `(bot_id, idempotency_key)` (200 + `duplicate:true`); `occurred_at` clamped if it's more than 5 min in the future; body stripping when `store_message_bodies = false`; `decision` copied into `payload.decision` (the DB trigger creates the `decisions` row). Add a `supabase/functions/ingest/test.ts` (Deno test) covering: valid single, batch, duplicate, bad key → 401, bad shape → 422, `decision_needed` without a decision → 422, and body stripping.

## 4. Realtime feed
- Use Supabase Realtime **Postgres Changes** on `events` (INSERT), `decisions` (INSERT/UPDATE), and `bots` (UPDATE). RLS on these tables filters what each signed-in user receives. When a client is selected, add a `client_id=eq.<id>` filter.
- Build one `useLiveEvents({clientId?, botId?, lanes?, types?})` hook that: loads the latest 50 via a normal query, subscribes, prepends new rows (deduped by id), keeps a max of 500 in memory, exposes `paused` (while paused, new rows queue and a "+N new" pill appears), and exposes `connection` (`live` | `connecting` | `offline`). On reconnect it backfills anything newer than the newest id it has.
- Bot health is computed on the client every 30 s from `bots`: **erroring** = `last_error_at` within the last 60 min and newer than the last non-error event; **stale** = `now − last_seen_at > 2 × expected_interval_minutes`; **paused** = `enabled = false`; otherwise **live**.
- Scale note for the README: if viewers or volume grow a lot, switch to Realtime **Broadcast from the database** (`realtime.broadcast_changes` triggers + private channels). Don't build that now.

## 5. App structure and screens
Routes (App Router, server components for the initial data, client components for live parts):
- `/login`: magic link. `/no-access`.
- `/`: **Fleet overview.** At the top, a KPI strip for *today* in the viewer's timezone from `client_daily_stats`: Answered, Brought back, Leads delivered, Orders, Errors, Open decisions. Below it, bot cards grouped by client in a responsive grid (4/3/2/1 columns). Each card shows the name, the lane chip, a health dot, `last_summary` (2 lines), "seen 3m ago", a 24 h events sparkline, and an open-decisions badge. Clicking a card goes to the bot page. The right rail (sticky, 380 px, hidden below 1100 px and replaced by a tab) holds the **LiveFeed** component (section 6).
- `/feed`: full-height live ledger with a filter bar (client, bot, lane, type, status, channel, date range, text). Filters are stored in the URL query string. Infinite scroll. Clicking a row opens a side drawer with full details: payload JSON viewer, links, notes (add a note), "Mark resolved" (RPC `set_event_status`), and "Open in Close" when `close_lead_id` exists (`https://app.close.com/lead/<id>/`).
- `/bots/[id]`: header (health, cadence, client, last seen, key prefixes with **Create key** / **Revoke** for admins; a new key is shown once with a copy button and the ready-to-paste env block). Below that, a timeline grouped by `run_id` (collapsible; each run shows its duration and counts by type), plus a 7-day activity chart.
- `/inbox`: messages only (`message_sent` / `message_received`), grouped into conversations by `thread_ref` (falling back to `counterparty_handle`). Two panes: the conversation list (channel icon, counterparty, last line, time) and a chat-style thread view (inbound left, outbound right, bot name on each outbound message). It's read-only, so there's no reply-from-console in v1.
- `/decisions`: open decisions sorted by priority, then `due_at`, then age. Each card shows the question, context, the source event, the client/bot, and the option buttons plus an optional note. Shortcuts: `j`/`k` move, `1`–`8` pick an option, `n` focuses the note, `d` dismisses. Answering calls `answer_decision`. The card animates out, and the bot gets the answer on its next `bot-inbox` call. There's a tab for answered decisions with "delivered to bot at."
- `/clients` and `/clients/[slug]`: the client list with plan/status; the client page shows its bots, 7-day KPIs, a scoped LiveFeed, and a **Daily summary preview** (generated from yesterday's events: what was handled, who came back, which leads came in, what needs you). It mirrors the morning note RMS promises clients.
- `/search` + a global **⌘K** palette: Postgres full-text search on `events.fts` (`websearch_to_tsquery`) plus jump-to bot/client.
- `/settings`: clients (CRUD, including the `store_message_bodies` toggle with a warning), bots (CRUD, `expected_interval_minutes`, enable/disable), team (invite by email via a server action using the service key on the server only, set role/all_clients/client_access). Settings is visible to admins only.
- Global top bar: RMS logo (wordmark text "RMS" in italic Archivo if no asset), client switcher (persists in the URL), connection status pill, and user menu.

## 6. Design direction: match runmystore.com
Reproduce the homepage hero's **"Your store, running"** live card as the `LiveFeed` component, and carry its language across the whole app.
- **Tokens:** `--ink #1a1a1a` (app background), `--ink-2 #242424` (panels), `--ink-3 #333333` (borders/dividers), `--paper #ffffff`, `--mist #e9e9e9`, `--line #e2e2e2`, `--teal #0d7377` (the only accent color), `--teal-wash #e7f1f1`, `--muted #5c5c5c`, `--muted-dark rgba(255,255,255,.84)`. Radius 14 px. Skew −22°. Errors use a restrained red (`#c2410c` range) used sparingly. Teal stays the "needs you / live" color.
- **Type:** display is **Archivo Variable**, *italic, weight 800, width/stretch ~112%, letter-spacing −0.02em*, used for page titles and big numbers. Body is **Inter Variable** at 15–16 px for the app. Small labels are uppercase, letter-spacing .06–.12em, 0.7–0.8rem, weight 700. Load via `@fontsource-variable/archivo` (with the `wdth` axis + italic) and `@fontsource-variable/inter`, or `next/font/google` with `axes: ['wdth']`.
- **Panels:** `--ink-2` background, 1 px `--ink-3` border, a **5 px teal top border**, `border-radius: 6px 6px 14px 14px`, shadow `0 40px 80px -30px rgba(0,0,0,.7)` on hero panels only.
- **LiveFeed card anatomy:** the header has a 9 px teal dot with an expanding-ring `pulse` animation (2 s infinite), the title in Archivo 700, a right-aligned uppercase connection label ("LIVE · 38/40 BOTS" / "RECONNECTING"), and a pill **Pause/Play** button. Below it, pill tabs (`All`, `Customer Service`, `Retention`, `Lead Engine`, `Ops`). The selected pill is white with ink text; the others are transparent with an ink-3 border. **Rows** use a grid with areas `"who in tag" / "out out out"`: an uppercase white **WHO** label (bot name or lane), **IN** (trigger/context, 86% white, truncated), and **OUT** (the result, white, weight 600). Rows have a 3 px left border keyed to the lane (cs = teal, retention = white, lead = 45% white, ops = ink-3) and a background of `rgba(255,255,255,.07)` with radius `4px 8px 8px 4px`. **Tag chips** are uppercase pills: *Needs you* (teal on white text), *Order* / *Upsell* (white on ink), *Skipped* (ink-3), *Error* (red), *CRM* (outline). A **tally strip** at the bottom has 4 columns of italic Archivo 800 counters (1.6rem) under uppercase labels, with the last column set off by a 3 px teal left border. Each counter does a 0.4 s `tick` bump when it changes.
- **Mapping events to rows:** WHO = bot name. IN = `counterparty_name` + a short context, or the first clause of `summary`. OUT = `summary`. Tag comes from type/status/payload.outcome (`decision_needed` → Needs you, `error` → Error, `crm_write` → CRM, outcome `order`/`reordered`/`won_back` → Order, `upsell` → Upsell, `skipped` → Skipped).
- **Motion:** new rows enter from above (y −16 → 0, opacity 0 → 1, 0.55 s, `back.out(1.6)`; use GSAP or Framer Motion). Bot cards and panels lift 4 px on hover. Buttons are skewed parallelograms (a `::before` layer with `skewX(-22deg)`, teal fill, 6 px radius), shift 3 px right on hover, and their arrow nudges 4 px. **Under `prefers-reduced-motion`, turn all of that off.**
- **Brand flourish:** the "stripes" mark (5 skewed teal bars at 100/86/72/58/44% width, 3 px tall, 3 px gap) goes before section eyebrows and in empty states.
- **Copy voice:** plain, short, and second person, like the site ("Needs you", "Brought back", "Leads delivered"). Empty states say what will appear and how to make it appear (for example "No events yet. Paste the logging instruction into a bot and run it.").

## 7. Simulator (`scripts/simulate.ts`, run with `npx tsx scripts/simulate.ts`)
It reads `SIM_INGEST_URL` and `SIM_BOT_KEYS` (comma-separated, from the seed output) and POSTs realistic events through the **real ingest endpoint** every 2–5 s, rotating bots. The mix: CS question→reply pairs, retention outcomes, leads with `crm_write`, an occasional `alert`/`error`, and a `decision_needed` about once a minute. It uses idempotency keys and logs each response code. This is the end-to-end proof that ingest → DB → Realtime → UI works.

## 8. Bot snippet (put this in the README and on each bot's settings page)
```bash
# env on the bot: RMS_INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest
#                 RMS_INBOX_URL=https://<ref>.supabase.co/functions/v1/bot-inbox
#                 RMS_BOT_KEY=rmsb_xxxxxxxx_…
curl -sS -X POST "$RMS_INGEST_URL" \
  -H "x-bot-key: $RMS_BOT_KEY" -H "content-type: application/json" \
  -d '{"type":"message_sent","summary":"Replied to Jane about order #1042 tracking","channel":"email","direction":"outbound","counterparty":{"name":"Jane Doe","handle":"jane@example.com"},"thread_ref":"gmail:18c2f0a9b7","links":[{"label":"Thread","url":"https://mail.google.com/"}],"idempotency_key":"cs:gmail:18c2f0a9b7:r1"}'
# pick up answered decisions at the start of each run
curl -sS "$RMS_INBOX_URL" -H "x-bot-key: $RMS_BOT_KEY"
```
Also render the full **bot logging instruction** (the paragraph from `bot_event_contract.md` that I'll paste in) on the bot page, with the env block filled in for that bot.

## 9. Deploy steps (do them, and write them in the README)
1. `npx create-next-app@latest rms-ops --ts --tailwind --app --eslint`, then `supabase init`, `supabase login`, `supabase link --project-ref <ref>`.
2. `supabase db push`, then run `seed.sql` (SQL editor or `psql`) and save the printed simulator keys to `.env.local` (never commit them).
3. `supabase functions deploy ingest --no-verify-jwt` and `supabase functions deploy bot-inbox --no-verify-jwt`.
4. Supabase dashboard: Auth → turn off public sign-ups, enable email magic link, set Site URL + redirect URLs (localhost and the Vercel domain). Check that Realtime is on for `events`, `decisions`, `bots` (the migration adds them to `supabase_realtime`).
5. Create my owner account: invite `adam@…` (ask me which email), then `insert into team_members (user_id, display_name, role, all_clients) values ('<uid>','Adam','owner',true);`.
6. Vercel: import the repo and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the publishable key), plus a server-only `SUPABASE_SERVICE_ROLE_KEY` used only by the team-invite server action. Deploy, then add the custom domain (ask me which).
7. Run the simulator against production for 2 minutes and confirm the fleet grid and feed update live.
8. Run `scripts/reset-demo.sql` when I say "go live" (keep it as a separate, confirmed step).

## 10. Checkpoints (stop, show me, then continue)
1. **Backend:** migration + seed + both functions are deployed. Show curl results for: valid → 201, duplicate → 200, bad key → 401, bad shape → 422, and bot-inbox returning an answered decision. Show an RLS check: a scoped operator sees one client only.
2. **Live UI:** fleet overview + LiveFeed + decisions queue working against the seed, with the simulator running and rows animating in. Send me screenshots at 1440 px and 390 px.
3. **Everything else:** inbox, bot page with key create/revoke, client page with daily summary, search/⌘K, settings, and the Lighthouse accessibility score (≥ 95).
4. **Production:** deployed on Vercel at the domain, with a README covering setup, env vars, rotating a bot key, adding a client, adding a teammate, and the scale note.

## 11. Acceptance tests (automate what you can with Playwright)
- A new event POSTed with curl appears in the open browser feed in under 2 s, with no refresh.
- A paused feed shows "+N new" and doesn't reflow until Play.
- An operator assigned only to "Northside Candle Co." can't see Fresh Bros rows in any screen, API call, or realtime message.
- A revoked key gets 401 right away.
- With `store_message_bodies = false`, message `detail` and `payload.body` aren't stored.
- Answering a decision changes its source event to `resolved`, decrements the bot's badge live, and the bot receives the answer once.
- Under reduced motion there are no entrance or pulse animations.

When done, give me: the live URL, the repo path, what you changed from this spec and why, any open questions, and the exact paragraph to paste into each bot (from section 8 / the contract).
