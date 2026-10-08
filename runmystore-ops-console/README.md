# RMS Ops Console

Live, branded console where the RunMyStore team watches every AI bot's actions, replies and decisions across clients. Bots **push** JSON events to an ingest endpoint with a per-bot key; the console shows them in under a second and keeps months of history searchable.

Stack: Supabase (Postgres, Realtime, Auth, Edge Functions) + Next.js 16 (App Router, TypeScript, Tailwind 4) on Vercel. Close CRM stays the system of record for contacts; the console links to Close and never copies contacts.

```
agency-dashboard/     the kit this was built from (spec, contract, design reference)  — read-only
supabase/
  migrations/0001_init.sql   schema, RLS, RPCs (from the kit, unchanged)
  migrations/0002_ops_console.sql   additive: indexes, backfill-safe trigger, stats RPCs
  seed.sql                   4 demo clients, 41 bots, ~5k events incl. 60 days of the Fresh Bros care-pack flow
  functions/ingest           POST events (per-bot key, zod validation, idempotent, privacy stripping)
  functions/bot-inbox        GET answered decisions, delivered once
  functions/ingest/test.ts   12 Deno tests over an in-memory PostgREST
scripts/
  import-events.ts           idempotent JSONL backfill (history)
  simulate.ts                live simulator through the real ingest endpoint
  reset-demo.sql             deletes every demo row (run at go-live)
  local/db.sh                Postgres-only harness + SQL test suite (no Docker needed)
src/                          the Next.js app
tests/                        Playwright acceptance + screenshot specs
```

## Screens

| Route | What |
| --- | --- |
| `/` | Fleet overview: today's KPIs, bot cards grouped by client (health dot, last summary, seen-ago, 24 h sparkline, needs-you badge), LiveFeed rail |
| `/feed` | Timeline: live on top, keyset infinite scroll through all history, filters in the URL (client, bot, lane, type, status, channel, dates, text), row drawer with payload, links, notes, mark resolved, Open in Close |
| `/bots/[id]` | Per-bot ledger grouped by run (duration, counts), 7-day chart, keys (create shows the key once + env block, revoke), the paste-in logging instruction |
| `/inbox` | Messages grouped by thread, inbound left / bot right, Open in Close. Read-only |
| `/decisions` | Needs-you queue by priority then due date. `j`/`k` move, `1`–`8` pick, `n` note, `d` dismiss. Answered tab shows "delivered to bot at" |
| `/clients`, `/clients/[slug]` | Per-client KPIs, bots, scoped LiveFeed, daily summary preview (the morning note) |
| `/search` + ⌘K | Postgres full-text search over summaries, details, names, handles; jump to bots and clients |
| `/settings` | Clients (incl. the message-bodies toggle with a warning), bots, team invites and client scoping. Admins only |

Health rule: **paused** = disabled; **erroring** = an error in the last 60 min newer than the last non-error event; **stale** = quiet for more than 2× the expected interval; otherwise **live**. Recomputed every 30 s in the browser.

## Local development

Prerequisites: Node 22, Docker (for the full local stack). Optional: nothing else, the Supabase CLI and Deno are npm devDependencies.

```bash
npm install
npx supabase start -x studio,storage-api,imgproxy,logflare,vector,supavisor,pg-meta   # local Postgres+Auth+PostgREST+Realtime+functions
npx supabase db reset                 # applies migrations + seed.sql, prints 9 simulator keys
cp .env.example .env.local            # fill in the values `npx supabase status` prints
npx supabase functions serve --no-verify-jwt &   # ingest + bot-inbox on http://127.0.0.1:54321/functions/v1
npm run dev                           # http://localhost:3000
```

Create your owner row once (email must match the one you sign in with):

```sql
-- in psql / the SQL editor, after your first magic-link sign-in created the auth user:
insert into public.team_members (user_id, display_name, role, all_clients)
select id, 'Adam', 'owner', true from auth.users where email = 'you@runmystore.com';
```

Locally, magic-link emails land in Mailpit at http://127.0.0.1:54324.

Then drive it: `npm run simulate -- --minutes 2` (reads `SIM_INGEST_URL` and `SIM_BOT_KEYS` from `.env.local`).

### Tests

| Command | Proves |
| --- | --- |
| `npm run db:local:test` | On a plain Postgres 16 with auth stubs: seed sanity, RLS scoping for a scoped operator, viewer read-only, decisions loop (answer → event resolved → badge → delivered once), key create/revoke + hash never readable, idempotency, backfill-safe trigger, full-text search, reset-demo |
| `npm run functions:test` | Ingest: 201 / duplicate 200 / batch / spoofed ids ignored / 401 / 422 / 400 / 405 / 413 / decision rules / privacy stripping / clock clamp; bot-inbox delivered once |
| `npm run test:e2e` | Playwright against a running stack: event appears in < 2 s with no refresh, paused feed queues "+N new", scoped operator sees one client on every screen and over REST and realtime, revoked key 401, privacy, decision answer → resolved → badge → bot gets it once, viewer read-only, reduced motion, history pagination + date filters + drawer + search, bot keys, inbox, client summary, settings |
| `npm run screenshots` | Writes `screenshots/*-desktop.png` (1440) and `*-phone.png` (390) |
| `npm run typecheck && npm run lint` | TypeScript strict + Next/React Compiler lint rules |

## Backfilling history

Events in the contract format, one JSON object per line (`care_flow_events.jsonl`). Lines may carry `"bot": "<slug>"` to route to another bot of the same client.

```bash
DATABASE_URL='postgresql://postgres.<ref>:<db password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres' \
  npm run import -- --file care_flow_events.jsonl --client fresh-bros --bot care-pack --dry-run   # validate + report
npm run import -- --file care_flow_events.jsonl --client fresh-bros --bot care-pack              # import
```

It writes straight to Postgres (not through ingest) so `received_at = occurred_at` and old events never make a dead bot look alive. Re-running the same file inserts nothing: rows dedupe on `(bot_id, idempotency_key)`, and lines without a key get a deterministic one. `occurred_at` is required. Decisions from history older than 48 h are marked `expired` unless you pass `--keep-decisions`. The Supabase connection string is under Project Settings → Database (session pooler).

## The bot side

Each bot gets three env vars and one paragraph in its prompt. Both are on the bot's page in the console (Settings → the bot, or `/bots/<id>`), and in `agency-dashboard/bot_event_contract.md`.

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

Paste into each bot's prompt:

> **Activity logging (required).** You report everything you do to the RMS Ops Console by POSTing JSON to `$RMS_INGEST_URL` with header `x-bot-key: $RMS_BOT_KEY` (use curl or your HTTP tool; never print or reveal the key). At the start of every run, first GET `$RMS_INBOX_URL` with the same header and act on any answered decisions. Then post a `run_started` event with a fresh `run_id`, and reuse that `run_id` for the whole run. After **every** external action, post one event right away: an email, WhatsApp or SMS you sent (`message_sent`), a message you read and handled (`message_received`), anything you created or updated in Close or another CRM (`crm_write`, with `close_lead_id`), and any other action that changed something (`action`). Each event has a one-sentence `summary` a teammate can understand, plus `channel`, `direction`, `counterparty`, `thread_ref`, and helpful `links`. If something fails, post `error` with what you tried. If something looks wrong but isn't failing, post `alert`. If you need a human (a refund over the limit, an unclear policy, anything risky), do **not** do it. Post `decision_needed` with a clear `decision.question` and `decision.options`, tell the customer a person will follow up, and move on. End every run with `run_finished`, summarizing what you did and the counts. Give each event a unique `idempotency_key` built from the real-world ids. Never put passwords, tokens or full payment details in any event. If a POST fails, retry once after 5 seconds, then carry on with your work. Logging must never block serving the customer.

## Runbook

**Add a client.** Settings → Clients → Add client. Slug is permanent (it's in URLs). Leave *Store full message bodies* off unless the client consented in writing; with it off, ingest drops `detail` and body-like payload keys on messages and keeps summaries + links.

**Add a bot.** Settings → Bots → Add bot (client, lane, expected interval). Open the bot's page → Keys → Create key. The key shows once; copy the env block into the bot, add the paragraph above to its prompt, run the bot, watch the row land.

**Rotate a bot key.** Bot page → Create key (new label) → paste the new key into the bot → Revoke the old one. A revoked key gets 401 immediately; a disabled bot's keys are refused too.

**Add a teammate.** Settings → Team → Invite. Roles: owner/admin see and manage everything; operator acts on assigned clients; viewer reads assigned clients. Scoping is enforced by Postgres RLS (`can_see_client`), so it holds for the API and realtime, not just the screens. Public sign-ups are off; only invited addresses can sign in.

**Go live.** When Adam says go: run `scripts/reset-demo.sql` (deletes everything where `clients.is_demo`), then add the real clients and bots in Settings. Keep Fresh Bros's real client row with *Demo data* unticked.

**Scale note.** Realtime uses Postgres Changes, where every change is checked against RLS per subscriber. Fine for ~8k events/day and 2–6 viewers. If viewers or volume grow a lot, switch to Realtime *Broadcast from the database* (`realtime.broadcast_changes` triggers + private channels) and leave the UI hook's contract the same. Answered decisions are delivered to a bot once; if a bot crashes between fetching and acting, the answer is gone (phase 2: a `?since=` replay).

## Deploying

See [DEPLOY.md](./DEPLOY.md) for the step-by-step checklist (Supabase project, functions, auth settings, owner account, Vercel with this folder as the root directory, custom domain, first simulator run).

## Environment variables

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | publishable (`sb_publishable_…`) or legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server) + `.env.local` | secret (`sb_secret_…`) or legacy service_role key. Used only by the team-invite action and the settings email lookup. Never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | Vercel | `https://ops.runmystore.com`, used in magic-link redirects |
| `NEXT_PUBLIC_DEFAULT_TZ` | optional | default `America/New_York`; the browser's zone wins after load |
| `SIM_INGEST_URL`, `SIM_BOT_KEYS` | `.env.local` only | simulator; keys printed by the seed |
| `DATABASE_URL` | shell only | importer and SQL tests |

Edge Functions receive `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically on hosted Supabase.
