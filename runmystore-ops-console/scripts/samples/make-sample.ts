// Writes scripts/samples/care_flow_events.sample.jsonl: 5 days of care-pack runs in the contract format,
// including one duplicate line and two invalid lines, so the importer's report has something to show.
import { writeFileSync } from "node:fs";
const names = ["Jane Doe", "Sam Lee", "Priya Shah", "Marco Ruiz", "Ava Chen"];
const lines: string[] = [];
const day = 24 * 3600_000;
const start = Date.UTC(2026, 6, 1, 13, 0, 0); // July 1, 2026 09:00 New York
for (let d = 0; d < 5; d++) {
  for (let r = 0; r < 3; r++) {
    const n = names[(d + r) % names.length], h = n.toLowerCase().replace(" ", ".") + "@example.com";
    const t0 = start + d * day + r * 2 * 3600_000;
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    const order = `FB-${9000 + d * 10 + r}`, run = `care-hist-${d}-${r}`, thread = `fb:care:${order}`;
    const ev = (o: Record<string, unknown>) => lines.push(JSON.stringify({ run_id: run, ...o }));
    ev({ type: "run_started", summary: `Care-pack run started: new complaint from ${n} on order #${order}`, channel: "internal", occurred_at: at(0), idempotency_key: `${run}:1` });
    ev({ type: "message_received", summary: `${n} wrote in: “the box came crushed”`, channel: "email", direction: "inbound", counterparty: { name: n, handle: h }, thread_ref: thread,
      detail: "Full text that should be stripped when bodies are off", payload: { body: "stripped", order_id: order }, occurred_at: at(20_000), idempotency_key: `${run}:2` });
    ev({ type: "action", summary: `Found order #${order} in WooCommerce: delivered 3 days earlier`, channel: "web", payload: { order_id: order }, occurred_at: at(45_000), idempotency_key: `${run}:3` });
    ev({ type: "crm_write", summary: `Logged the claim on ${n}’s Close lead and tagged it care-pack`, channel: "crm", close_lead_id: `lead_hist${d}${r}`, occurred_at: at(70_000),
      links: [{ label: "Open in Close", url: `https://app.close.com/lead/lead_hist${d}${r}/` }], idempotency_key: `${run}:4` });
    if (r === 2) {
      ev({ type: "decision_needed", summary: `Replacement for ${n} is $112.00, over the $75 care-pack limit`, channel: "email", direction: "inbound", counterparty: { name: n, handle: h }, thread_ref: thread, amount_cents: 11200,
        decision: { question: `Approve a $112.00 care pack for ${n}?`, options: [{ key: "approve", label: "Approve" }, { key: "deny", label: "Deny" }], priority: 2 }, occurred_at: at(120_000), idempotency_key: `${run}:5` });
      ev({ type: "run_finished", summary: `Paused: care pack for ${n} is waiting on a decision`, channel: "internal", occurred_at: at(130_000), idempotency_key: `${run}:6` });
    } else {
      ev({ type: "action", summary: `Created care pack CP-H${d}${r} in ShipStation: replacement plus a sample ($18.40 cost)`, channel: "web", amount_cents: 1840, payload: { care_pack_id: `CP-H${d}${r}`, outcome: "care_pack_sent" }, occurred_at: at(120_000), idempotency_key: `${run}:5` });
      ev({ type: "message_sent", summary: `Told ${n} a replacement ships today at no charge`, channel: "email", direction: "outbound", counterparty: { name: n, handle: h }, thread_ref: thread, occurred_at: at(180_000), idempotency_key: `${run}:6` });
      // one line without an idempotency key, to exercise the derived key
      ev({ type: "run_finished", summary: `Care pack sent to ${n}: 1 replacement, $18.40 cost, customer notified`, channel: "internal", occurred_at: at(190_000) });
    }
  }
}
lines.push(lines[1]); // exact duplicate
lines.push(JSON.stringify({ type: "message_sent", summary: "No time on this one", channel: "email" })); // missing occurred_at
lines.push('{"type":"nonsense","summary":"bad type","occurred_at":"2026-07-01T13:00:00Z"}'); // bad type
lines.push("not json at all");
writeFileSync(new URL("./care_flow_events.sample.jsonl", import.meta.url), lines.join("\n") + "\n");
console.log(`wrote ${lines.length} lines`);
