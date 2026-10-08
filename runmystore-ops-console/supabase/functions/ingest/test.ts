// deno test --allow-net --allow-env --allow-read   (run from supabase/functions)
// Exercises the real ingest + bot-inbox handlers against an in-memory PostgREST.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { FakePostgrest, loadHandler, makeKey } from "../_shared/testing.ts";

const pg = new FakePostgrest();
const url = await pg.start();
Deno.env.set("SUPABASE_URL", url);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");

const BOT_A = "11111111-1111-4111-8111-111111111111"; // bodies off (default)
const BOT_B = "22222222-2222-4222-8222-222222222222"; // bodies on
const BOT_C = "33333333-3333-4333-8333-333333333333"; // disabled
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const keyA = makeKey(), keyB = makeKey(), keyRevoked = makeKey(), keyDisabled = makeKey();
pg.keys.push(
  { ...keyA, bot: { id: BOT_A, slug: "care-pack", enabled: true, client_id: CLIENT, store_message_bodies: false } },
  { ...keyB, bot: { id: BOT_B, slug: "inbox", enabled: true, client_id: CLIENT, store_message_bodies: true } },
  { ...keyRevoked, revoked: true, bot: { id: BOT_A, slug: "care-pack", enabled: true, client_id: CLIENT, store_message_bodies: false } },
  { ...keyDisabled, bot: { id: BOT_C, slug: "old", enabled: false, client_id: CLIENT, store_message_bodies: false } },
);

const ingest = await loadHandler(new URL("./index.ts", import.meta.url).href);
const inbox = await loadHandler(new URL("../bot-inbox/index.ts", import.meta.url).href);

function post(key: string | null, body: unknown, raw = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-bot-key"] = key;
  return ingest(new Request(`${url}/functions/v1/ingest`, { method: "POST", headers, body: raw ? (body as string) : JSON.stringify(body) }));
}
const valid = {
  type: "message_sent", summary: "Replied to Jane about order #1042 tracking", channel: "email", direction: "outbound",
  counterparty: { name: "Jane Doe", handle: "jane@example.com" }, thread_ref: "gmail:18c2f0a9b7",
  links: [{ label: "Thread", url: "https://mail.google.com/" }], idempotency_key: "cs:gmail:18c2f0a9b7:r1",
};

Deno.test("valid single event -> 201 with one id, bot/client stamped from the key", async () => {
  const res = await post(keyA.key, valid);
  const body = await res.json();
  assertEquals(res.status, 201);
  assertEquals(body.ok, true);
  assertEquals(body.ids.length, 1);
  assertEquals(body.duplicate, false);
  const row = pg.events.at(-1);
  assertEquals(row.bot_id, BOT_A);
  assertEquals(row.client_id, CLIENT);
  assertEquals(row.counterparty_name, "Jane Doe");
  assertEquals(row.status, "ok");
});

Deno.test("duplicate idempotency key -> 200 duplicate:true, nothing stored twice", async () => {
  const before = pg.events.length;
  const res = await post(keyA.key, valid);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.duplicate, true);
  assertEquals(body.duplicates, 1);
  assertEquals(body.ids.length, 0);
  assertEquals(pg.events.length, before);
});

Deno.test("batch of events -> 201, mixed duplicates reported", async () => {
  const res = await post(keyA.key, { events: [
    { ...valid, idempotency_key: "b:1" }, { ...valid, idempotency_key: "b:2", type: "action", summary: "Did a thing" }, valid,
  ] });
  const body = await res.json();
  assertEquals(res.status, 201);
  assertEquals(body.ids.length, 2);
  assertEquals(body.duplicates, 1);
});

Deno.test("a body that spoofs bot_id/client_id is ignored (server derives them from the key)", async () => {
  const res = await post(keyB.key, { ...valid, idempotency_key: "spoof:1", bot_id: BOT_A, client_id: "someone-else" });
  assertEquals(res.status, 201);
  const row = pg.events.at(-1);
  assertEquals(row.bot_id, BOT_B);
  assertEquals(row.client_id, CLIENT);
});

Deno.test("bad key -> 401 (malformed, unknown prefix, revoked, disabled bot)", async () => {
  for (const k of ["nope", "rmsb_00000000_" + "0".repeat(48), keyRevoked.key, keyDisabled.key, null]) {
    const res = await post(k, valid);
    assertEquals(res.status, 401, `key ${k}`);
    await res.body?.cancel();
  }
});

Deno.test("bad shape -> 422 with zod issues", async () => {
  const res = await post(keyA.key, { type: "nonsense", summary: "" });
  const body = await res.json();
  assertEquals(res.status, 422);
  assert(Array.isArray(body.issues) && body.issues.length >= 1);
});

Deno.test("invalid JSON -> 400, GET -> 405, oversized body -> 413", async () => {
  const bad = await post(keyA.key, "{not json", true);
  assertEquals(bad.status, 400); await bad.body?.cancel();
  const get = await ingest(new Request(`${url}/functions/v1/ingest`, { method: "GET", headers: { "x-bot-key": keyA.key } }));
  assertEquals(get.status, 405); await get.body?.cancel();
  const big = await post(keyA.key, { ...valid, idempotency_key: "big", detail: "x".repeat(300_000) });
  assertEquals(big.status, 413); await big.body?.cancel();
});

Deno.test("decision_needed without a decision -> 422; with one -> stored in payload.decision, status needs_review", async () => {
  const missing = await post(keyA.key, { type: "decision_needed", summary: "Refund over limit", idempotency_key: "d:0" });
  assertEquals(missing.status, 422); await missing.body?.cancel();
  const ok = await post(keyA.key, {
    type: "decision_needed", summary: "Refund of $240 requested, over the $150 auto-limit", idempotency_key: "d:1",
    decision: { question: "Approve a full $240 refund?", options: [{ key: "approve", label: "Approve" }, { key: "deny", label: "Deny" }], priority: 2 },
  });
  assertEquals(ok.status, 201); await ok.body?.cancel();
  const row = pg.events.at(-1);
  assertEquals(row.status, "needs_review");
  assertEquals(row.payload.decision.question, "Approve a full $240 refund?");
  assertEquals(row.payload.decision.options.length, 2);
});

Deno.test("privacy: store_message_bodies=false strips detail and body-like payload keys on messages only", async () => {
  const msg = { ...valid, idempotency_key: "p:1", detail: "full email text", payload: { body: "hi", html: "<p>hi</p>", order_id: "1042" } };
  const r1 = await post(keyA.key, msg); assertEquals(r1.status, 201); await r1.body?.cancel();
  const stripped = pg.events.at(-1);
  assertEquals(stripped.detail, null);
  assertEquals(stripped.payload.body, undefined);
  assertEquals(stripped.payload.html, undefined);
  assertEquals(stripped.payload.order_id, "1042");
  // non-message types keep their detail even when bodies are off
  const r2 = await post(keyA.key, { type: "action", summary: "Checked order", detail: "kept", idempotency_key: "p:2" });
  assertEquals(r2.status, 201); await r2.body?.cancel();
  assertEquals(pg.events.at(-1).detail, "kept");
  // bodies on for bot B: detail stays
  const r3 = await post(keyB.key, { ...msg, idempotency_key: "p:3" });
  assertEquals(r3.status, 201); await r3.body?.cancel();
  assertEquals(pg.events.at(-1).detail, "full email text");
  assertEquals(pg.events.at(-1).payload.body, "hi");
});

Deno.test("occurred_at more than 5 minutes in the future is clamped to now; defaults applied", async () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const res = await post(keyA.key, { type: "error", summary: "Gmail token expired", occurred_at: future, idempotency_key: "t:1" });
  assertEquals(res.status, 201); await res.body?.cancel();
  const row = pg.events.at(-1);
  assert(Date.parse(row.occurred_at) <= Date.now() + 1000, "not clamped");
  assertEquals(row.status, "failed");
  assertEquals(row.severity, 2);
  assertMatch(row.occurred_at, /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test("bot-inbox: returns answered decisions once, 401 on bad key, 405 on POST", async () => {
  pg.decisions.push(
    { id: "dec1", event_id: "ev1", bot_id: BOT_A, question: "Approve?", state: "answered", answer_key: "approve", answer_note: "ok", answered_at: new Date().toISOString(), delivered_to_bot_at: null },
    { id: "dec2", event_id: "ev2", bot_id: BOT_A, question: "Open one", state: "open", answer_key: null, answer_note: null, answered_at: null, delivered_to_bot_at: null },
    { id: "dec3", event_id: "ev3", bot_id: BOT_B, question: "Other bot", state: "answered", answer_key: "deny", answer_note: null, answered_at: new Date().toISOString(), delivered_to_bot_at: null },
  );
  const get = (key: string, method = "GET") => inbox(new Request(`${url}/functions/v1/bot-inbox`, { method, headers: { "x-bot-key": key } }));
  const first = await get(keyA.key);
  const b1 = await first.json();
  assertEquals(first.status, 200);
  assertEquals(b1.decisions.map((d: { id: string }) => d.id), ["dec1"]);
  assertEquals(b1.decisions[0].answer_key, "approve");
  const second = await get(keyA.key);
  assertEquals((await second.json()).decisions.length, 0);
  assert(pg.decisions[0].delivered_to_bot_at, "not marked delivered");
  const bad = await get(keyRevoked.key); assertEquals(bad.status, 401); await bad.body?.cancel();
  const postRes = await get(keyA.key, "POST"); assertEquals(postRes.status, 405); await postRes.body?.cancel();
});

Deno.test({ name: "shutdown fake postgrest", fn: async () => { await pg.stop(); }, sanitizeOps: false, sanitizeResources: false });
