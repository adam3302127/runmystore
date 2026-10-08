# Deploy checklist

Everything below is done once. Items marked **you** need the account owner; the rest can be run from the repo with the tokens.

## Status (Oct 8, 2026)
- [x] Supabase project `vtgvbxzmadnisovgexav` (East US): migrations 0001 + 0002 applied, seed loaded (5,085 events, 41 bots, 9 open decisions), `ingest` and `bot-inbox` deployed with `--no-verify-jwt`, curl checkpoint 201 / 200 duplicate / 401 / 422 / inbox 200.
- [x] Auth: public sign-ups off, magic link on, site URL `https://ops.runmystore.com`, redirect allow-list set. Google provider: off until a Google OAuth client id + secret exist.
- [x] Owner: `adam@runmystore.com` invited (check the inbox for the Supabase invite) and `team_members` row created as owner.
- [x] Vercel project `rms-ops-console` (root = this folder), production env vars set, deployed: https://rms-ops-console.vercel.app
- [ ] DNS at SiteGround for `ops.runmystore.com` (two records, see step 4). Until then use the vercel.app URL.
- [ ] Google sign-in (optional): create a Google OAuth client, add the id + secret under Authentication → Providers → Google, then set `NEXT_PUBLIC_GOOGLE_AUTH=1` on Vercel and redeploy.

## 1. Supabase project
- [ ] **you** Create the project (Free for the trial): https://supabase.com/dashboard → New project → `rms-ops-console`, generate a DB password and save it, region East US (N. Virginia).
- [ ] **you** Project Settings → General → copy the Project ID (`<ref>`). Project Settings → API Keys → copy the publishable key and reveal + copy the secret key.
- [ ] **you** https://supabase.com/dashboard/account/tokens → generate `claude-code` access token (lets the CLI link, push migrations and deploy functions).

```bash
cd runmystore-ops-console
export SUPABASE_ACCESS_TOKEN=<token>
npx supabase link --project-ref <ref> --password '<db password>'
npx supabase db push                       # applies 0001 + 0002
npx supabase db query --linked -f supabase/seed.sql     # or paste seed.sql in the SQL editor; save the printed keys to .env.local
npx supabase functions deploy ingest --no-verify-jwt
npx supabase functions deploy bot-inbox --no-verify-jwt
```

- [ ] Verify ingest with the printed care-pack key:
```bash
U=https://<ref>.supabase.co/functions/v1
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/ingest -H "x-bot-key: $K" -H "content-type: application/json" -d '{"type":"action","summary":"Deploy check","idempotency_key":"deploy:1"}'   # 201
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/ingest -H "x-bot-key: $K" -H "content-type: application/json" -d '{"type":"action","summary":"Deploy check","idempotency_key":"deploy:1"}'   # 200 duplicate
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/ingest -H "x-bot-key: rmsb_00000000_000000000000000000000000000000000000000000000000" -d '{}'   # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST $U/ingest -H "x-bot-key: $K" -H "content-type: application/json" -d '{"type":"nope"}'   # 422
curl -s $U/bot-inbox -H "x-bot-key: $K"   # {"ok":true,"decisions":[]}
```

## 2. Auth settings (dashboard → Authentication)
- [ ] Sign In / Providers → Email: enabled; **Allow new users to sign up: off** (invites still work). Keep "Confirm email" on.
- [ ] URL Configuration → Site URL `https://ops.runmystore.com`; Redirect URLs: `https://ops.runmystore.com/**`, `http://localhost:3000/**`, and the Vercel preview domain `https://*-<team>.vercel.app/**`.
- [ ] (Later, optional) Google provider if the team wants it. Off by default.
- [ ] Check Database → Publications → `supabase_realtime` lists `events`, `decisions`, `bots` (the migration adds them).

## 3. Owner account
- [ ] Authentication → Users → Invite user → owner email. Click the invite (or just sign in once from the app to create the auth user).
- [ ] SQL editor:
```sql
insert into public.team_members (user_id, display_name, role, all_clients)
select id, 'Adam', 'owner', true from auth.users where email = '<owner email>';
```

## 4. Vercel
- [ ] **you** https://vercel.com/signup → Continue with GitHub (the account that owns `adam3302127/runmystore`). Then https://vercel.com/account/tokens → `claude-code` token.
- [ ] Import the repo. **Root Directory: `runmystore-ops-console`.** Framework: Next.js (auto). Production branch: `main` (or the feature branch while on trial).
- [ ] Environment variables (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret, server-only), `NEXT_PUBLIC_SITE_URL=https://ops.runmystore.com`.
- [ ] Deploy. Open `/login`, request a link, sign in, see the fleet.
- [x] Domains → `ops.runmystore.com` added to the project. **you** DNS lives at SiteGround (ns1/ns2.siteground.net). Add two records: `CNAME ops → cname.vercel-dns.com` and `TXT _vercel → vc-domain-verify=ops.runmystore.com,5797ef4d11252a80f4e7` (the TXT proves you own the apex, since runmystore.com itself is not on Vercel). The certificate issues itself within minutes of the records resolving.

## 5. Prove it live
- [ ] `.env.local`: `SIM_INGEST_URL=https://<ref>.supabase.co/functions/v1/ingest`, `SIM_BOT_KEYS=<from the seed>` → `npm run simulate -- --minutes 2` while the fleet page is open: rows drop in, counters tick, a Needs you card appears within a minute.
- [ ] `BASE_URL=https://ops.runmystore.com DATABASE_URL=… npm run test:e2e` (acceptance tests against production; they create `*.test@example.com` team users, remove them after).
- [ ] Lighthouse accessibility on `/` ≥ 95.

## 6. Go live (separate, confirmed step)
- [ ] Run `scripts/reset-demo.sql` in the SQL editor. Add Fresh Bros as a real client (Demo data unticked) and its care-pack bot. Create its key, paste the env block + logging paragraph into the bot.
- [ ] Backfill: `npm run import -- --file care_flow_events.jsonl --client fresh-bros --bot care-pack`.
- [ ] Upgrade when ready (ask first): Supabase Pro $25/mo (free projects pause after 7 idle days), Vercel Pro $20/seat (Hobby is non-commercial).
