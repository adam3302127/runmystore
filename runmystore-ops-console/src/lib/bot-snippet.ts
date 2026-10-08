/** The paragraph bots paste into their prompt (bot_event_contract.md), plus the env block for one bot. */
export function ingestUrls() {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://<project-ref>.supabase.co").replace(/\/$/, "");
  return { ingest: `${base}/functions/v1/ingest`, inbox: `${base}/functions/v1/bot-inbox` };
}
export function envBlock(key: string) {
  const u = ingestUrls();
  return `RMS_INGEST_URL=${u.ingest}\nRMS_INBOX_URL=${u.inbox}\nRMS_BOT_KEY=${key}`;
}
export function curlSnippet(key: string) {
  const u = ingestUrls();
  return `curl -sS -X POST "${u.ingest}" \\
  -H "x-bot-key: ${key}" -H "content-type: application/json" \\
  -d '{"type":"message_sent","summary":"Replied to Jane about order #1042 tracking","channel":"email","direction":"outbound","counterparty":{"name":"Jane Doe","handle":"jane@example.com"},"thread_ref":"gmail:18c2f0a9b7","links":[{"label":"Thread","url":"https://mail.google.com/"}],"idempotency_key":"cs:gmail:18c2f0a9b7:r1"}'
# pick up answered decisions at the start of each run
curl -sS "${u.inbox}" -H "x-bot-key: ${key}"`;
}
export const LOGGING_INSTRUCTION = `Activity logging (required). You report everything you do to the RMS Ops Console by POSTing JSON to $RMS_INGEST_URL with header x-bot-key: $RMS_BOT_KEY (use curl or your HTTP tool; never print or reveal the key). At the start of every run, first GET $RMS_INBOX_URL with the same header and act on any answered decisions. Then post a run_started event with a fresh run_id, and reuse that run_id for the whole run. After every external action, post one event right away: an email, WhatsApp or SMS you sent (message_sent), a message you read and handled (message_received), anything you created or updated in Close or another CRM (crm_write, with close_lead_id), and any other action that changed something (action). Each event has a one-sentence summary a teammate can understand, plus channel, direction, counterparty, thread_ref, and helpful links. If something fails, post error with what you tried. If something looks wrong but isn't failing, post alert. If you need a human (a refund over the limit, an unclear policy, anything risky), do not do it. Post decision_needed with a clear decision.question and decision.options, tell the customer a person will follow up, and move on. End every run with run_finished, summarizing what you did and the counts. Give each event a unique idempotency_key built from the real-world ids. Never put passwords, tokens or full payment details in any event. If a POST fails, retry once after 5 seconds, then carry on with your work. Logging must never block serving the customer.`;
