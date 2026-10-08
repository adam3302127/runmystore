// Live event simulator: POSTs realistic events through the real ingest endpoint, rotating bots.
//
//   npx tsx scripts/simulate.ts [--minutes 2] [--min-ms 2000] [--max-ms 5000] [--once]
//
// Reads .env.local: SIM_INGEST_URL, SIM_BOT_KEYS (comma-separated "label=key" pairs, or bare keys),
// and optionally SIM_INBOX_URL (defaults to the ingest URL with /bot-inbox). Every event carries an
// idempotency key, and every response code is logged. Answered decisions are picked up every 30 s.
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });

type Sim = { label: string; key: string; kind: "care" | "cs" | "retention" | "lead" | "ops" | "generic" };
type Ev = Record<string, unknown>;

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const MINUTES = Number(flag("minutes", "0"));
const MIN_MS = Number(flag("min-ms", "2000"));
const MAX_MS = Number(flag("max-ms", "5000"));
const ONCE = argv.includes("--once");

const INGEST = process.env.SIM_INGEST_URL ?? "";
const INBOX = process.env.SIM_INBOX_URL ?? INGEST.replace(/\/ingest\/?$/, "/bot-inbox");
if (!INGEST || !process.env.SIM_BOT_KEYS) {
  console.error("Set SIM_INGEST_URL and SIM_BOT_KEYS in .env.local (SIM_BOT_KEYS=care-pack=rmsb_...,inbox=rmsb_...)");
  process.exit(2);
}
const sims: Sim[] = process.env.SIM_BOT_KEYS.split(",").map((s) => s.trim()).filter(Boolean).map((entry, i) => {
  const [label, key] = entry.includes("=") ? entry.split("=", 2) : [`bot-${i + 1}`, entry];
  const l = label.toLowerCase();
  const kind: Sim["kind"] = l.includes("care") ? "care" : l.includes("inbox") || l.includes("chat") ? "cs"
    : l.includes("reorder") || l.includes("win") ? "retention" : l.includes("prospect") || l.includes("qualif") ? "lead"
    : l.includes("ops") ? "ops" : "generic";
  return { label, key, kind };
});

const names = ["Jane Doe", "Sam Lee", "Priya Shah", "Marco Ruiz", "Ava Chen", "Leo Grant", "Nora Kim", "Omar Haddad"];
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const handle = (n: string) => n.toLowerCase().replace(" ", ".") + "@example.com";
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
let seq = 0;
const ikey = (s: Sim, what: string) => `sim:${s.label}:${Date.now()}:${++seq}:${what}`;
const runId = (s: Sim) => `${s.label}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastDecisionAt = 0;

function careRun(s: Sim): Ev[] {
  const n = pick(names), h = handle(n), order = `FB-${10000 + Math.floor(Math.random() * 9000)}`, run = runId(s), thread = `fb:care:${order}`;
  const ch = pick(["email", "email", "whatsapp", "sms"]);
  const issue = pick(["my gummies arrived melted", "the jar seal was broken", "one pre-roll pack was missing", "the box came crushed"]);
  const cost = 1200 + Math.floor(Math.random() * 2400);
  const wantsDecision = Date.now() - lastDecisionAt > 60_000 && Math.random() < 0.5;
  const base = [
    { type: "run_started", summary: `Care-pack run started: new complaint from ${n} on order #${order}`, channel: "internal", run_id: run, idempotency_key: ikey(s, "start") },
    { type: "message_received", summary: `${n} wrote in: “${issue}”`, channel: ch, direction: "inbound", counterparty: { name: n, handle: h }, thread_ref: thread, run_id: run,
      detail: "Full message text that the privacy toggle should strip.", payload: { body: "should be stripped" }, links: [{ label: "Thread", url: `https://example.com/threads/${order}` }], idempotency_key: ikey(s, "in") },
    { type: "action", summary: `Found order #${order} in WooCommerce: delivered 3 days ago, first claim on this order`, channel: "web", run_id: run, payload: { order_id: order }, idempotency_key: ikey(s, "lookup") },
    { type: "crm_write", summary: `Logged the claim on ${n}’s Close lead and tagged it care-pack`, channel: "crm", run_id: run, close_lead_id: `lead_sim${seq}`, counterparty: { name: n },
      links: [{ label: "Open in Close", url: `https://app.close.com/lead/lead_sim${seq}/` }], idempotency_key: ikey(s, "crm") },
  ];
  if (wantsDecision) {
    lastDecisionAt = Date.now();
    const big = 9000 + Math.floor(Math.random() * 8000);
    return [...base,
      { type: "decision_needed", summary: `Replacement for ${n} is ${money(big)}, over the $75 care-pack limit (second claim in 60 days)`, channel: ch, direction: "inbound",
        counterparty: { name: n, handle: h }, thread_ref: thread, run_id: run, amount_cents: big,
        decision: { question: `Approve a ${money(big)} care pack for ${n}? Second claim in 60 days, order #${order}.`,
          options: [{ key: "approve", label: "Approve" }, { key: "partial", label: "Replace, no extras" }, { key: "deny", label: "Deny, ask for photos" }], priority: 2 },
        idempotency_key: ikey(s, "decision") },
      { type: "message_sent", summary: `Told ${n} a person will confirm the replacement today`, channel: ch, direction: "outbound", counterparty: { name: n, handle: h }, thread_ref: thread, run_id: run, idempotency_key: ikey(s, "hold") },
      { type: "run_finished", summary: `Paused: care pack for ${n} is waiting on your decision`, channel: "internal", run_id: run, idempotency_key: ikey(s, "end") },
    ];
  }
  if (Math.random() < 0.08) {
    return [...base,
      { type: "error", summary: `ShipStation returned 500 creating care pack CP-${seq}, will retry next run`, channel: "internal", run_id: run, idempotency_key: ikey(s, "err") },
      { type: "run_finished", summary: `Run ended with 1 error: care pack for ${n} not created yet`, channel: "internal", run_id: run, idempotency_key: ikey(s, "end") },
    ];
  }
  return [...base,
    { type: "action", summary: `Created care pack CP-${seq} in ShipStation: replacement plus a sample (${money(cost)} cost)`, channel: "web", run_id: run, amount_cents: cost,
      payload: { care_pack_id: `CP-${seq}`, cost_cents: cost, outcome: "care_pack_sent" }, idempotency_key: ikey(s, "pack") },
    { type: "message_sent", summary: `Told ${n} a replacement ships today at no charge, tracking to follow`, channel: ch, direction: "outbound", counterparty: { name: n, handle: h }, thread_ref: thread, run_id: run, payload: { outcome: "care_pack_sent" }, idempotency_key: ikey(s, "out") },
    { type: "run_finished", summary: `Care pack sent to ${n}: 1 replacement, ${money(cost)} cost, customer notified`, channel: "internal", run_id: run, payload: { counts: { messages: 2, crm_writes: 1, care_packs: 1 } }, idempotency_key: ikey(s, "end") },
  ];
}

function csPair(s: Sim): Ev[] {
  const n = pick(names), h = handle(n), ch = pick(["email", "whatsapp", "chat"]), thread = `${s.label}:t${seq}`;
  const qa = pick([
    ["“Any update on my order?”", "Shipped Tuesday, sent the tracking link."], ["“Do you ship to Canada?”", "Yes, 5 to 8 days and duties included."],
    ["“Can I swap this for a medium?”", "Exchange label sent."], ["“Is this still in stock?”", "Yes, 14 left, sent a checkout link."],
  ]);
  const wantsDecision = Date.now() - lastDecisionAt > 60_000 && Math.random() < 0.3;
  const evs: Ev[] = [
    { type: "message_received", summary: `${n} asked ${qa[0]}`, channel: ch, direction: "inbound", counterparty: { name: n, handle: h }, thread_ref: thread, idempotency_key: ikey(s, "in") },
  ];
  if (wantsDecision) {
    lastDecisionAt = Date.now();
    evs.push({ type: "decision_needed", summary: "Refund of $240 requested, over the $150 auto-limit", channel: ch, direction: "inbound", counterparty: { name: n, handle: h }, thread_ref: thread, amount_cents: 24000,
      decision: { question: `Approve a full $240 refund for ${n}'s order #${1000 + seq}?`, options: [{ key: "approve", label: "Approve" }, { key: "partial", label: "Offer 50%" }, { key: "deny", label: "Deny" }], priority: 2 }, idempotency_key: ikey(s, "decision") });
  } else {
    evs.push({ type: "message_sent", summary: `Replied to ${n}: ${qa[1]}`, channel: ch, direction: "outbound", counterparty: { name: n, handle: h }, thread_ref: thread,
      payload: qa[0].includes("stock") ? { outcome: "order" } : {}, idempotency_key: ikey(s, "out") });
  }
  return evs;
}

function retention(s: Sim): Ev[] {
  const n = pick(names), outcome = pick(["reordered", "won_back", "upsell", "no_response", "no_response"]);
  const why = pick(["Reorder reminder: last ordered 34 days ago", "Win-back: quiet for 90 days", "Follow-up: a week after first order"]);
  return [{ type: "message_sent", summary: `${why} → ${n}${outcome === "no_response" ? "" : `, ${outcome.replace("_", " ")}`}`, channel: "email", direction: "outbound",
    counterparty: { name: n, handle: handle(n) }, payload: { outcome }, amount_cents: outcome === "no_response" ? undefined : 2500 + Math.floor(Math.random() * 9000), idempotency_key: ikey(s, outcome) }];
}

function lead(s: Sim): Ev[] {
  const who = pick(["Boutique gym with three locations", "Wedding planner", "Corporate gifting buyer", "Reseller marketplace", "Café group, 6 sites"]);
  if (Math.random() < 0.3) return [{ type: "action", summary: `Checked ${who}: not a fit, skipped`, channel: "crm", payload: { outcome: "skipped" }, idempotency_key: ikey(s, "skip") }];
  return [{ type: "crm_write", summary: `New lead: ${who}, added to Close`, channel: "crm", close_lead_id: `lead_sim${seq}`, payload: { outcome: "lead_delivered" },
    links: [{ label: "Open in Close", url: `https://app.close.com/lead/lead_sim${seq}/` }], idempotency_key: ikey(s, "lead") }];
}

function ops(s: Sim): Ev[] {
  const r = Math.random();
  if (r < 0.08) return [{ type: "error", summary: "Shopify API returned 429 while syncing orders", channel: "internal", idempotency_key: ikey(s, "err") }];
  if (r < 0.18) return [{ type: "alert", summary: "Inbox volume 3x normal in the last hour", channel: "internal", idempotency_key: ikey(s, "alert") }];
  if (r < 0.5) return [{ type: "heartbeat", summary: "Alive", channel: "internal", idempotency_key: ikey(s, "hb") }];
  return [{ type: "action", summary: `Synced ${10 + Math.floor(Math.random() * 30)} orders and ${Math.floor(Math.random() * 4)} refunds`, channel: "internal", idempotency_key: ikey(s, "sync") }];
}

function generate(s: Sim): Ev[] {
  switch (s.kind) {
    case "care": return careRun(s);
    case "cs": return csPair(s);
    case "retention": return retention(s);
    case "lead": return lead(s);
    case "ops": return ops(s);
    default: return [{ type: "action", summary: "Did a routine task", channel: "internal", idempotency_key: ikey(s, "task") }];
  }
}

const stamp = () => new Date().toTimeString().slice(0, 8);
async function send(s: Sim, ev: Ev, attempt = 1): Promise<void> {
  try {
    const res = await fetch(INGEST, { method: "POST", headers: { "x-bot-key": s.key, "content-type": "application/json" }, body: JSON.stringify(ev) });
    const body = await res.json().catch(() => ({}));
    const extra = body.duplicate ? " duplicate" : res.status >= 400 ? ` ${JSON.stringify(body).slice(0, 120)}` : "";
    console.log(`${stamp()}  ${res.status}  ${s.label.padEnd(11)} ${String(ev.type).padEnd(17)} ${String(ev.summary).slice(0, 80)}${extra}`);
  } catch (e) {
    console.log(`${stamp()}  ERR  ${s.label.padEnd(11)} ${String(ev.type).padEnd(17)} ${(e as Error).message}${attempt === 1 ? " (retrying in 5 s)" : ""}`);
    if (attempt === 1) { await sleep(5000); return send(s, ev, 2); }
  }
}

async function pollInbox() {
  for (const s of sims) {
    try {
      const res = await fetch(INBOX, { headers: { "x-bot-key": s.key } });
      const body = await res.json();
      for (const d of body.decisions ?? []) console.log(`${stamp()}  INBOX ${s.label.padEnd(10)} decision ${d.id} → ${d.state}${d.answer_key ? ` (${d.answer_key})` : ""}${d.answer_note ? ` "${d.answer_note}"` : ""}`);
    } catch (e) { console.log(`${stamp()}  INBOX ${s.label} failed: ${(e as Error).message}`); }
  }
}

async function main() {
  console.log(`simulating ${sims.length} bot(s) → ${INGEST}${MINUTES ? ` for ${MINUTES} min` : ""}`);
  const until = MINUTES ? Date.now() + MINUTES * 60_000 : Infinity;
  const inboxTimer = setInterval(pollInbox, 30_000);
  let i = 0;
  do {
    const s = sims[i++ % sims.length];
    for (const ev of generate(s)) { await send(s, ev); await sleep(300 + Math.random() * 700); }
    if (ONCE && i >= sims.length) break;
    await sleep(MIN_MS + Math.random() * Math.max(0, MAX_MS - MIN_MS));
  } while (Date.now() < until);
  clearInterval(inboxTimer);
  await pollInbox();
}
main().catch((e) => { console.error(e); process.exit(1); });
