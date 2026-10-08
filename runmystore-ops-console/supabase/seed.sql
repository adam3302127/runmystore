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

-- ---------------------------------------------------------------------------------------------
-- Fresh Bros: the customer care-pack flow, 60 days of run-structured history.
-- Fictional people and example.com addresses only. Every event carries an idempotency key, so the
-- importer and the simulator never double-log against this seed.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_client uuid; v_bot uuid; d int; r int; runs int; t timestamptz; run text; k int; n int := 0;
  v_issue text; v_fix text; v_chan text; v_name text; v_handle text; v_order text; v_lead text; v_thread text;
  v_variant int; v_cost int; v_big int; v_total int; v_day0 timestamptz; v_fu timestamptz;
  names  text[] := array['Jane Doe','Sam Lee','Priya Shah','Marco Ruiz','Ava Chen','Leo Grant','Nora Kim','Omar Haddad','Tessa Byrne','Diego Alvarez'];
  issues text[] := array['my gummies arrived melted','the jar seal was broken','one pre-roll pack was missing from the box','the box came crushed','the vape cart leaked in the bag','it shipped to my old address'];
  fixes  text[] := array['replacement gummies plus a sample pre-roll','a replacement jar plus a sticker pack','the missing pre-roll pack plus a sample','a full re-ship in a padded box','a replacement cart plus a sample','a re-ship to the new address'];
  chans  text[] := array['email','email','whatsapp','sms'];
begin
  select id into v_client from public.clients where slug = 'fresh-bros';
  if v_client is null then return; end if;

  insert into public.bots (client_id, slug, name, lane, platform, description, expected_interval_minutes)
  values (v_client, 'care-pack', 'Care Pack', 'cs', 'assistant-platform',
          'Reads damaged, missing and late-order complaints, checks the order, logs it in Close, ships a care pack under the auto-limit and asks you above it.', 30)
  on conflict (client_id, slug) do nothing;
  select id into v_bot from public.bots where client_id = v_client and slug = 'care-pack';

  -- Midnight today in New York, as an absolute instant.
  v_day0 := (date_trunc('day', now() at time zone 'America/New_York')) at time zone 'America/New_York';

  for d in reverse 59..0 loop
    runs := 3 + ((d * 7) % 4);
    for r in 1..runs loop
      n := n + 1;
      t := v_day0 - make_interval(days => d) + make_interval(hours => 9 + ((n * 5) % 12), mins => (n * 17) % 60);
      if t > now() - interval '10 minutes' then continue; end if;
      k := 1 + (n % 10);
      v_name := names[k]; v_handle := lower(replace(v_name, ' ', '.')) || '@example.com';
      v_issue := issues[1 + (n % 6)]; v_fix := fixes[1 + (n % 6)]; v_chan := chans[1 + (n % 4)];
      v_order := 'FB-' || (10000 + n * 3); v_lead := 'lead_fbdemo' || k; v_thread := 'fb:care:' || v_order;
      run := 'care-' || to_char(t at time zone 'UTC', 'YYYYMMDD-HH24MI');
      v_cost := 1200 + ((n * 37) % 2400); v_big := 9000 + ((n * 53) % 8000); v_total := 4800 + ((n * 91) % 9000);
      v_variant := case when n % 9 = 0 then 1 when n % 13 = 0 then 2 else 0 end;

      insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, idempotency_key)
      values (v_bot, v_client, run, 'run_started', 'Care-pack run started: new complaint from ' || v_name || ' on order #' || v_order, 'internal', t, t, run || ':1');

      insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, links, idempotency_key)
      values (v_bot, v_client, run, 'message_received', v_name || ' wrote in: “' || v_issue || '”', v_chan, 'inbound', v_name, v_handle, v_thread,
              t + interval '20 seconds', t + interval '20 seconds',
              jsonb_build_array(jsonb_build_object('label', 'Thread', 'url', 'https://example.com/threads/' || v_order)), run || ':2');

      insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, payload, amount_cents, idempotency_key)
      values (v_bot, v_client, run, 'action',
              'Found order #' || v_order || ' in WooCommerce: delivered ' || to_char((t - interval '3 days') at time zone 'America/New_York', 'Mon DD') || ', $' || to_char(v_total / 100.0, 'FM999990.00') || ', first claim on this order',
              'web', t + interval '45 seconds', t + interval '45 seconds',
              jsonb_build_object('order_id', v_order, 'order_total_cents', v_total, 'delivered_on', to_char((t - interval '3 days') at time zone 'America/New_York', 'YYYY-MM-DD'), 'prior_claims', case when v_variant = 1 then 1 else 0 end),
              v_total, run || ':3');

      insert into public.events (bot_id, client_id, run_id, type, summary, channel, close_lead_id, close_activity_id, counterparty_name, occurred_at, received_at, links, idempotency_key)
      values (v_bot, v_client, run, 'crm_write', 'Logged the claim on ' || v_name || '’s Close lead and tagged it care-pack', 'crm', v_lead, 'acti_fbdemo' || n, v_name,
              t + interval '70 seconds', t + interval '70 seconds',
              jsonb_build_array(jsonb_build_object('label', 'Open in Close', 'url', 'https://app.close.com/lead/' || v_lead || '/')), run || ':4');

      if v_variant = 0 then
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, payload, amount_cents, links, idempotency_key)
        values (v_bot, v_client, run, 'action', 'Created care pack CP-' || n || ' in ShipStation: ' || v_fix || ' ($' || to_char(v_cost / 100.0, 'FM999990.00') || ' cost)',
                'web', t + interval '2 minutes', t + interval '2 minutes',
                jsonb_build_object('care_pack_id', 'CP-' || n, 'items', v_fix, 'cost_cents', v_cost, 'outcome', 'care_pack_sent'), v_cost,
                jsonb_build_array(jsonb_build_object('label', 'ShipStation order', 'url', 'https://example.com/shipstation/CP-' || n)), run || ':5');
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, payload, idempotency_key)
        values (v_bot, v_client, run, 'message_sent', 'Told ' || v_name || ' a replacement ships today at no charge, tracking to follow', v_chan, 'outbound', v_name, v_handle, v_thread,
                t + interval '3 minutes', t + interval '3 minutes', jsonb_build_object('outcome', 'care_pack_sent'), run || ':6');
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, payload, idempotency_key)
        values (v_bot, v_client, run, 'run_finished', 'Care pack sent to ' || v_name || ': 1 replacement, $' || to_char(v_cost / 100.0, 'FM999990.00') || ' cost, customer notified', 'internal',
                t + interval '3 minutes 10 seconds', t + interval '3 minutes 10 seconds',
                jsonb_build_object('counts', jsonb_build_object('messages', 2, 'crm_writes', 1, 'care_packs', 1, 'errors', 0)), run || ':7');

        -- Follow-up five days later on every third run: a check-in, a reply, and sometimes a reorder.
        v_fu := t + interval '5 days 2 hours';
        if n % 3 = 0 and v_fu + interval '45 minutes' < now() then
          insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, idempotency_key)
          values (v_bot, v_client, run || '-fu', 'message_sent', 'Checked in with ' || v_name || ' five days after the care pack landed', v_chan, 'outbound', v_name, v_handle, v_thread, v_fu, v_fu, run || ':fu1');
          insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, payload, amount_cents, idempotency_key)
          values (v_bot, v_client, run || '-fu', 'message_received',
                  case when n % 6 = 0 then v_name || ' replied: “All good, and I just reordered the gummies”' else v_name || ' replied: “Got it, thank you, all good”' end,
                  v_chan, 'inbound', v_name, v_handle, v_thread, v_fu + interval '41 minutes', v_fu + interval '41 minutes',
                  case when n % 6 = 0 then jsonb_build_object('outcome', 'reordered') else jsonb_build_object('outcome', 'resolved') end,
                  case when n % 6 = 0 then v_total else null end, run || ':fu2');
        end if;

      elsif v_variant = 1 then
        insert into public.events (bot_id, client_id, run_id, type, status, severity, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, amount_cents, occurred_at, received_at, payload, links, idempotency_key)
        values (v_bot, v_client, run, 'decision_needed', 'needs_review', 1,
                'Replacement for ' || v_name || ' is $' || to_char(v_big / 100.0, 'FM999990.00') || ', over the $75 care-pack limit (second claim in 60 days)',
                v_chan, 'inbound', v_name, v_handle, v_thread, v_big, t + interval '2 minutes', t + interval '2 minutes',
                jsonb_build_object('decision', jsonb_build_object(
                  'question', 'Approve a $' || to_char(v_big / 100.0, 'FM999990.00') || ' care pack for ' || v_name || '? Second claim in 60 days, order #' || v_order || '.',
                  'options', jsonb_build_array(jsonb_build_object('key','approve','label','Approve'), jsonb_build_object('key','partial','label','Replace, no extras'), jsonb_build_object('key','deny','label','Deny, ask for photos')),
                  'priority', 2)),
                jsonb_build_array(jsonb_build_object('label', 'Open in Close', 'url', 'https://app.close.com/lead/' || v_lead || '/'), jsonb_build_object('label', 'Thread', 'url', 'https://example.com/threads/' || v_order)),
                run || ':5');
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, direction, counterparty_name, counterparty_handle, thread_ref, occurred_at, received_at, idempotency_key)
        values (v_bot, v_client, run, 'message_sent', 'Told ' || v_name || ' a person will confirm the replacement today', v_chan, 'outbound', v_name, v_handle, v_thread,
                t + interval '2 minutes 30 seconds', t + interval '2 minutes 30 seconds', run || ':6');
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, payload, idempotency_key)
        values (v_bot, v_client, run, 'run_finished', 'Paused: care pack for ' || v_name || ' is waiting on your decision', 'internal',
                t + interval '2 minutes 40 seconds', t + interval '2 minutes 40 seconds',
                jsonb_build_object('counts', jsonb_build_object('messages', 2, 'crm_writes', 1, 'care_packs', 0, 'decisions', 1)), run || ':7');

      else
        insert into public.events (bot_id, client_id, run_id, type, status, severity, summary, channel, occurred_at, received_at, payload, idempotency_key)
        values (v_bot, v_client, run, 'error', 'failed', 2, 'ShipStation returned 500 creating care pack CP-' || n || ', will retry next run', 'internal',
                t + interval '2 minutes', t + interval '2 minutes', jsonb_build_object('care_pack_id', 'CP-' || n, 'http_status', 500), run || ':5');
        insert into public.events (bot_id, client_id, run_id, type, summary, channel, occurred_at, received_at, payload, idempotency_key)
        values (v_bot, v_client, run, 'run_finished', 'Run ended with 1 error: care pack for ' || v_name || ' not created yet', 'internal',
                t + interval '2 minutes 10 seconds', t + interval '2 minutes 10 seconds',
                jsonb_build_object('counts', jsonb_build_object('messages', 1, 'crm_writes', 1, 'care_packs', 0, 'errors', 1)), run || ':6');
      end if;
    end loop;
  end loop;

  -- Decisions older than a day were answered at the time; recent ones stay open for the demo.
  update public.decisions dd set
    state = 'answered',
    answer_key = case when (extract(epoch from dd.created_at)::int % 3) = 0 then 'partial' else 'approve' end,
    answer_note = 'Carrier damage confirmed from the photos, approved.',
    answered_at = dd.created_at + interval '47 minutes',
    delivered_to_bot_at = dd.created_at + interval '1 hour 2 minutes'
  where dd.bot_id = v_bot and dd.created_at < now() - interval '1 day';
  update public.events e set status = 'resolved'
  from public.decisions dd where dd.event_id = e.id and dd.bot_id = v_bot and dd.state = 'answered';
end $$;

-- Demo keys for the simulator (printed once). Store them in .env.local as SIM_BOT_KEYS (comma-separated).
select b.slug, c.slug as client, public.create_bot_key(b.id, 'simulator') as key
from public.bots b join public.clients c on c.id=b.client_id
where (c.slug in ('northside-candle','fresh-bros') and b.slug in ('inbox','reorder','prospector','ops-watch'))
   or (c.slug = 'fresh-bros' and b.slug = 'care-pack')
order by c.slug, b.slug;
