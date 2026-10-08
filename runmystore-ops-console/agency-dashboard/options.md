# RMS Ops Console: options

*Prepared Oct 7, 2026, for Adam Rahman. Internal team console for a fleet of about 40 client bots.*

## The constraint everything is designed around
The assistant platform has no public read API, so nothing can pull bot activity from outside. **Every bot has to push its own events.** Each run can make HTTP calls, so after each step it POSTs one small JSON event (the contract is in `bot_event_contract.md`) to an ingest endpoint. Everything else (live feed, ledger, inbox, decisions, client views) gets built from that one stream of events.

Sizing assumption: 40 bots × ~200 events/day ≈ 8k events/day ≈ 240k/month, under 1 GB/year of rows. That's small for any of the options below.

---

## Option A. Supabase + Next.js on Vercel, with Close linked, not mirrored (recommended)
- **How bots feed it:** `POST https://<project>.supabase.co/functions/v1/ingest` with a per-bot key in the `x-bot-key` header. The Edge Function checks the key's hash, stamps `bot_id`/`client_id` on the server (a bot can't spoof another client), and inserts the event. An optional `GET /bot-inbox` lets a bot pick up your answers to its "decision needed" questions on its next run, which closes the loop.
- **Live updates:** Supabase Realtime (Postgres Changes on `events`, `decisions`, `bots`). New rows appear in the browser in under a second, filtered by RLS.
- **Multi-client separation:** each event carries a `client_id`, and RLS uses `can_see_client(client_id)`. Owners and admins see every client. Operators see only the clients assigned to them in `client_access`. The same rules can later support a read-only client portal.
- **Close:** stays the system of record for contacts. Bots write to Close directly, then log a `crm_write` event with `close_lead_id`, and the console deep-links to Close. There's no contact sync to build or break. Phase 2 (optional): a Close webhook into the same events table, so human edits in Close also show up in the ledger.
- **Monthly cost:** Supabase Pro $25 (includes $10 compute credit, which covers one Micro project, 5M realtime messages, 2M Edge Function calls, and 8 GB disk) plus Vercel Pro ~$20/seat (Hobby is for non-commercial use only). **About $45–70/mo** all in, $0 to prototype on free tiers.
- **Build time:** v1 in **3–5 working days** with Claude Code, plus about a week of polish and getting all 40 bots to log properly.
- **Pros:** fully branded to RMS, truly live, cheap, you own the data and the code, real RLS, and it can grow into a client portal or a public "live" homepage widget.
- **Cons:** it's custom code, so someone (Claude Code plus you) maintains it. Auth, deploy, and keys are on you.

## Option B. Close as the single source
- **How bots feed it:** bots write everything into Close as Notes or Custom Activities on leads. The dashboard reads Close's REST API and gets live updates from Close webhooks.
- **Live updates:** Close webhooks would go into... a store you'd still have to build. Otherwise you're polling a rate-limited API.
- **Multi-client separation:** weak. Either one Close org per client (40 bots across N orgs, N API keys) or one org with custom fields and no row-level guarantees.
- **Monthly cost:** Close seats you already pay for, plus hosting (~$20).
- **Build time:** 1–2 weeks, mostly fighting the API's shape.
- **Pros:** one place for contacts and activity history, and salespeople already live in Close.
- **Cons:** heartbeats, errors, decisions, and runs aren't contacts and fill Close with noise. Rate limits are a problem at 8k events/day. Nothing is live without building option A's store anyway. You're tied to Close's data model.

## Option C. No-code or low-code (Airtable + Interfaces, or Softr on Airtable)
- **How bots feed it:** POST to the Airtable REST API (a personal access token per base) or an Airtable webhook automation.
- **Live updates:** Interfaces refresh on their own every few seconds. That works, but it's not a streaming feed.
- **Multi-client separation:** per-base or per-interface permissions, or Softr user groups. This is coarse, and anyone with base access can see everything.
- **Monthly cost:** Airtable Team ~$20–24/seat plus Softr ~$50–170. Roughly **$80–200/mo** for a small team (verify current prices).
- **Build time:** **1–2 days.**
- **Pros:** fastest, non-developers can edit it, good enough to prove the event contract.
- **Cons:** Airtable's API limit (~5 requests/sec per base) is tight for 40 bots pushing at once. Branding is generic, there's no real animated feed, and you'll outgrow it.

## Option D. Hybrid: Supabase backend now, Retool UI first, custom Next.js later
- **How bots feed it:** identical to A (same Edge Function, same schema, same keys).
- **Live updates:** Retool tables polling every 5–10 s (Retool can't subscribe to Supabase Realtime natively).
- **Multi-client separation:** RLS in Supabase, plus Retool groups. Retool usually connects with one database user, so RLS is easy to bypass unless you set it up carefully.
- **Monthly cost:** Supabase $25 + Retool Team $10–12 per builder and $5–7 per user per month. **About $50–80/mo** for 3–5 people.
- **Build time:** backend 1–2 days, Retool screens 1–2 days. Custom UI later.
- **Pros:** live data in about 3 days, and the backend carries over unchanged when you switch to A.
- **Cons:** not branded, not truly live, and you build the screens twice.

| | A Supabase + Next.js | B Close-only | C Airtable/Softr | D Supabase + Retool |
|---|---|---|---|---|
| Truly live | Yes (<1 s) | No | ~Near (refresh) | Polling |
| Client separation | RLS (strong) | Weak | Coarse | RLS (if careful) |
| Branded to RMS | Fully | Partly | No | No |
| $/mo | ~$45–70 | ~$20 + Close | ~$80–200 | ~$50–80 |
| Time to v1 | 3–5 days | 1–2 wks | 1–2 days | ~3 days |
| Reversibility | High (Postgres, your code) | Low | Medium (CSV export) | High |

## Recommendation: Option A
It's the only option that is live, strongly separated per client, branded, and cheap at the same time. The backend (schema plus ingest endpoint) is the durable asset: it serves A, D, and a future client portal without changes. Keep Close as the system of record for contacts and link to it rather than copying it. **Fallback:** if you need something on screen this week, build A's backend first and add a Retool screen (D) for a few days. Nothing gets thrown away.

**Checkpoints / toggles**
1. **Day 1 checkpoint:** schema + ingest live, one real bot posting. If it's not working, stop and fix the contract before building any screens.
2. **Day 3 checkpoint:** fleet grid + live feed + decisions queue working with seed data, plus 5 real bots.
3. **Toggle `clients.store_message_bodies`** (default off): store a summary + link only, or full message text too. The homepage promises clients that "every conversation stays in accounts you own", so default to summaries plus links, and turn bodies on only per client with consent.
4. **Decision date, end of week 2:** decide whether to add a Close webhook (phase 2) and a client-facing portal.

---

## Proposed data model (Postgres / Supabase)
| Table | Purpose | Key columns |
|---|---|---|
| `clients` | Each business/workspace | id, slug, name, plan (cs/retention/lead/run_the_store/custom), status, timezone, close_lead_id, store_message_bodies bool, accent_color |
| `bots` | One row per bot | id, client_id, slug, name, lane (cs/retention/lead/ops/other), platform, expected_interval_minutes, enabled, last_seen_at, last_event_at, last_error_at, last_summary, open_decisions |
| `bot_keys` | Per-bot API keys (only hashes are stored) | id, bot_id, prefix, key_hash (sha256), label, last_used_at, revoked_at |
| `events` | The ledger (append-only) | id, bot_id, client_id, run_id, type, status, severity 0–3, summary, detail, channel, direction, counterparty_name, counterparty_handle, thread_ref, close_lead_id, close_activity_id, amount_cents, links jsonb, payload jsonb, idempotency_key, occurred_at, received_at, fts (search) |
| `decisions` | Things that need a human | id, event_id, bot_id, client_id, question, context, options jsonb, priority, due_at, state (open/answered/dismissed/expired), answer_key, answer_note, answered_by, answered_at, delivered_to_bot_at |
| `team_members` | Who can log in | user_id, display_name, role (owner/admin/operator/viewer), all_clients bool |
| `client_access` | Scopes operators to clients | user_id, client_id |
| `event_notes` | Team comments on events | id, event_id, client_id, user_id, body, created_at |
| view `client_daily_stats` | Tally strip / KPIs | client_id, day, answered, brought_back, leads_delivered, orders, errors, decisions_opened |

Event types: `action, message_sent, message_received, crm_write, alert, error, decision_needed, run_started, run_finished, heartbeat`.

## Key screens
1. **Fleet overview (home):** a KPI strip for today (answered / brought back / leads delivered / orders / errors / open decisions), then a grid of bot cards grouped by client. Each card has a health dot (live / stale / erroring / paused), the last summary, minutes since last seen, a 24 h sparkline, and a decisions badge. The right rail holds the **live feed** (the homepage module, but real).
2. **Per-bot timeline / ledger:** events grouped by `run_id`, with expandable payload JSON, links, and notes. Header shows health, cadence, and keys (create/revoke).
3. **Unified inbox:** `message_sent` / `message_received` grouped by thread (thread_ref or counterparty), with channel icons (email / WhatsApp / SMS / chat) and an "Open in Close" link.
4. **Decisions queue:** open items sorted by priority and due time. Answer with one click or a note, using keyboard shortcuts. The answer goes back to the bot via `/bot-inbox`.
5. **Client view:** one client's bots, KPIs, feed, and a "daily summary" preview (the same note the homepage promises clients).
6. **Search & filter:** ⌘K palette plus a full search page with full-text search on summary/detail/counterparty, and filters by client, bot, type, status, channel, and date. Filters are saved in the URL.
7. **Settings:** clients, bots, keys, and team/access.

## Adapting the homepage "Your store, running" module
The hero card on runmystore.com already looks like an ops console. The console should reuse it exactly as the **LiveFeed** component:
- **Card:** `#242424` panel, 5 px teal (`#0d7377`) top border, 6/14 px radius, deep shadow, pulsing teal dot.
- **Header:** title "Your store, running" becomes "Fleet, running" (or the client name). The "Simulated day" label becomes a live connection state ("Live · 38/40 bots", "Reconnecting…"). The Pause button freezes the feed while new events queue up with a "+12 new" pill.
- **Pill tabs:** All three / Customer Service / Retention / Lead Engine become **lane** filters, plus a client switcher.
- **Rows:** keep the 3-part structure. The uppercase **WHO** label holds the bot or lane, **IN** holds the trigger or context (muted, truncated), **OUT** holds the result (bold white). The left border color shows the lane, and a tag chip marks *Needs you* (teal), *Order*, *Upsell*, *Skipped*, plus new *Error* and *CRM*. Rows drop in from above (GSAP `back.out(1.6)`, 0.55 s), or just appear when reduced motion is on.
- **Tally strip:** the same italic Archivo counters (Answered / Brought back / Leads delivered / Orders from it) with a small bump on change, now real counts for today.
- **Later (decision for you):** a client-consented, anonymized version of the real feed could replace the fictional one on the public homepage. That would require changing the "Fictional activity" disclaimer, which is a marketing/legal call.
