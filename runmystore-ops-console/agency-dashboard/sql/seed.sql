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
