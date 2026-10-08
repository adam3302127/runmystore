# Bot event contract (v1)

Every bot pushes events to the RMS Ops Console. The bot never reads from the console, except for picking up answered decisions.

**Endpoint:** `POST $RMS_INGEST_URL` (for example `https://<project-ref>.supabase.co/functions/v1/ingest`)
**Headers:** `x-bot-key: $RMS_BOT_KEY` and `content-type: application/json`
**Body:** one event object, or `{"events":[...]}` with up to 50 events.
**Response:** `201 {"ok":true,"ids":[...]}`. A duplicate `idempotency_key` returns `200` with `"duplicate":true`. A bad key returns `401`. A bad shape returns `422` with the reasons.

The server sets `bot_id`, `client_id` and `received_at` from the key. Never send them yourself.

## Event shape
```json
{
  "type": "message_sent",
  "summary": "Replied to Jane about order #1042 tracking",
  "status": "ok",
  "severity": 0,
  "run_id": "2026-10-07T19:40:00Z-cs-bot",
  "occurred_at": "2026-10-07T23:40:12Z",
  "channel": "email",
  "direction": "outbound",
  "counterparty": { "name": "Jane Doe", "handle": "jane@example.com" },
  "thread_ref": "gmail:18c2f0a9b7",
  "close_lead_id": "lead_abc123",
  "amount_cents": 4200,
  "detail": "Optional longer text: what was asked and what was answered.",
  "links": [{ "label": "Gmail thread", "url": "https://mail.google.com/..." }],
  "payload": { "order_id": "1042", "tracking": "1Z..." },
  "decision": null,
  "idempotency_key": "cs-bot:gmail:18c2f0a9b7:reply1"
}
```

| Field | Required | Values / notes |
|---|---|---|
| `type` | yes | `action`, `message_sent`, `message_received`, `crm_write`, `alert`, `error`, `decision_needed`, `run_started`, `run_finished`, `heartbeat` |
| `summary` | yes | One plain sentence, 500 characters or fewer, written for a teammate |
| `status` | no | `ok` (default), `pending`, `failed`, `needs_review`, `resolved` |
| `severity` | no | 0 info (default), 1 notice, 2 warning, 3 critical |
| `run_id` | no but recommended | Same value for every event in one run |
| `occurred_at` | no | ISO-8601 with a zone. Defaults to the time the server receives it |
| `channel` | for messages | `email`, `whatsapp`, `sms`, `chat`, `crm`, `web`, `phone`, `internal`, `other` |
| `direction` | for messages | `inbound`, `outbound`, `none` |
| `counterparty` | for messages | `{name, handle}`, where handle is an email or phone number |
| `thread_ref` | for messages | Stable id of the thread or conversation |
| `close_lead_id` / `close_activity_id` | for `crm_write` | The id of whatever was written in Close |
| `amount_cents` | optional | Order value, refund amount, and so on |
| `links` | optional | Up to 10 `{label, url}` |
| `payload` | optional | Any JSON up to 32 KB. Never put passwords, tokens or full card numbers here |
| `decision` | for `decision_needed` | `{"question": "...", "options": [{"key":"approve","label":"Approve refund"},{"key":"deny","label":"Deny"}], "priority": 0-3, "due_at": "ISO"}` |
| `idempotency_key` | recommended | Unique per real-world action, so a retry never double-logs |

**Picking up answers:** `GET $RMS_INBOX_URL` (`.../functions/v1/bot-inbox`) with the same `x-bot-key` header returns `{"decisions":[{"id","question","answer_key","answer_note","answered_at","event_id"}]}`. These are decisions a human has answered and the bot hasn't collected yet. They're marked delivered once returned.

## Paste this into each bot's prompt
> **Activity logging (required).** You report everything you do to the RMS Ops Console by POSTing JSON to `$RMS_INGEST_URL` with header `x-bot-key: $RMS_BOT_KEY` (use curl or your HTTP tool; never print or reveal the key). At the start of every run, first GET `$RMS_INBOX_URL` with the same header and act on any answered decisions. Then post a `run_started` event with a fresh `run_id`, and reuse that `run_id` for the whole run. After **every** external action, post one event right away: an email, WhatsApp or SMS you sent (`message_sent`), a message you read and handled (`message_received`), anything you created or updated in Close or another CRM (`crm_write`, with `close_lead_id`), and any other action that changed something (`action`). Each event has a one-sentence `summary` a teammate can understand, plus `channel`, `direction`, `counterparty`, `thread_ref`, and helpful `links`. If something fails, post `error` with what you tried. If something looks wrong but isn't failing, post `alert`. If you need a human (a refund over the limit, an unclear policy, anything risky), do **not** do it. Post `decision_needed` with a clear `decision.question` and `decision.options`, tell the customer a person will follow up, and move on. End every run with `run_finished`, summarizing what you did and the counts. Give each event a unique `idempotency_key` built from the real-world ids. Never put passwords, tokens or full payment details in any event. If a POST fails, retry once after 5 seconds, then carry on with your work. Logging must never block serving the customer.

## Example (curl)
```bash
curl -sS -X POST "$RMS_INGEST_URL" \
  -H "x-bot-key: $RMS_BOT_KEY" -H "content-type: application/json" \
  -d '{"type":"decision_needed","summary":"Customer asked for a $240 refund, over the $150 auto-limit","channel":"email","direction":"inbound","counterparty":{"name":"Sam Lee","handle":"sam@example.com"},"thread_ref":"gmail:18c2f0aa01","amount_cents":24000,"decision":{"question":"Approve a full $240 refund for order #1077?","options":[{"key":"approve","label":"Approve"},{"key":"partial","label":"Offer 50%"},{"key":"deny","label":"Deny"}],"priority":2},"idempotency_key":"cs-bot:gmail:18c2f0aa01:refund-ask"}'
```
