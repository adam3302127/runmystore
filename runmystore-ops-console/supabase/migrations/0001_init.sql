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
