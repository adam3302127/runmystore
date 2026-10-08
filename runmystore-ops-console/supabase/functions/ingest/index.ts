// POST /functions/v1/ingest  (deploy with --no-verify-jwt; auth is the x-bot-key header)
import { z } from "npm:zod@3";
import { admin, authBot, json } from "../_shared/auth.ts";

const EVENT_TYPES = ["action", "message_sent", "message_received", "crm_write", "alert", "error",
  "decision_needed", "run_started", "run_finished", "heartbeat"] as const;

const Link = z.object({ label: z.string().max(80), url: z.string().url().max(2000) });

const Event = z.object({
  type: z.enum(EVENT_TYPES),
  summary: z.string().trim().min(1).max(500),
  status: z.enum(["ok", "pending", "failed", "needs_review", "resolved"]).optional(),
  severity: z.number().int().min(0).max(3).optional(),
  run_id: z.string().max(200).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  channel: z.enum(["email", "whatsapp", "sms", "chat", "crm", "web", "phone", "internal", "other"]).optional(),
  direction: z.enum(["inbound", "outbound", "none"]).optional(),
  counterparty: z.object({ name: z.string().max(200).optional(), handle: z.string().max(320).optional() }).optional(),
  thread_ref: z.string().max(500).optional(),
  close_lead_id: z.string().max(100).optional(),
  close_activity_id: z.string().max(100).optional(),
  amount_cents: z.number().int().optional(),
  detail: z.string().max(20000).optional(),
  links: z.array(Link).max(10).optional(),
  payload: z.record(z.unknown()).optional(),
  decision: z.object({
    question: z.string().min(1).max(1000),
    options: z.array(z.object({ key: z.string().max(50), label: z.string().max(120) })).max(8).optional(),
    priority: z.number().int().min(0).max(3).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
  }).nullable().optional(),
  idempotency_key: z.string().max(300).optional(),
}).superRefine((e, ctx) => {
  if (e.type === "decision_needed" && !e.decision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "decision_needed requires a decision object", path: ["decision"] });
  }
});

const Body = z.union([Event, z.object({ events: z.array(Event).min(1).max(50) })]);
const BODY_KEYS = ["body", "text", "html", "message", "content"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  const bot = await authBot(req);
  if (!bot) return json(401, { ok: false, error: "invalid or revoked bot key" });

  const raw = await req.text();
  if (raw.length > 256_000) return json(413, { ok: false, error: "body over 256 KB" });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return json(400, { ok: false, error: "invalid JSON" }); }
  const res = Body.safeParse(parsed);
  if (!res.success) return json(422, { ok: false, error: "invalid event", issues: res.error.issues });

  const list = "events" in res.data ? res.data.events : [res.data];
  if (list.some((e) => JSON.stringify(e.payload ?? {}).length > 32_000)) {
    return json(413, { ok: false, error: "payload over 32 KB" });
  }
  const now = Date.now();
  const rows = list.map((e) => {
    const payload: Record<string, unknown> = { ...(e.payload ?? {}) };
    let detail = e.detail ?? null;
    const isMessage = e.type === "message_sent" || e.type === "message_received";
    if (isMessage && !bot.storeBodies) { // privacy toggle: summaries + links only
      detail = null;
      for (const k of BODY_KEYS) delete payload[k];
    }
    if (e.decision) payload.decision = e.decision;
    let occurred = e.occurred_at ? Date.parse(e.occurred_at) : now;
    if (occurred > now + 5 * 60_000) occurred = now; // clamp clock skew
    return {
      bot_id: bot.botId, // always from the key, never from the body
      client_id: bot.clientId,
      type: e.type,
      status: e.status ?? (e.type === "decision_needed" ? "needs_review" : e.type === "error" ? "failed" : "ok"),
      severity: e.severity ?? (e.type === "error" ? 2 : e.type === "alert" ? 1 : 0),
      run_id: e.run_id ?? null,
      summary: e.summary,
      detail,
      channel: e.channel ?? null,
      direction: e.direction ?? "none",
      counterparty_name: e.counterparty?.name ?? null,
      counterparty_handle: e.counterparty?.handle ?? null,
      thread_ref: e.thread_ref ?? null,
      close_lead_id: e.close_lead_id ?? null,
      close_activity_id: e.close_activity_id ?? null,
      amount_cents: e.amount_cents ?? null,
      links: e.links ?? [],
      payload,
      idempotency_key: e.idempotency_key ?? null,
      occurred_at: new Date(occurred).toISOString(),
    };
  });

  const { data, error } = await admin
    .from("events")
    .upsert(rows, { onConflict: "bot_id,idempotency_key", ignoreDuplicates: true })
    .select("id, idempotency_key");
  if (error) {
    console.error("ingest insert failed", bot.botSlug, error);
    return json(500, { ok: false, error: "insert failed" });
  }
  const inserted = data ?? [];
  const duplicates = rows.length - inserted.length;
  return json(inserted.length ? 201 : 200, { ok: true, ids: inserted.map((r) => r.id), duplicate: duplicates > 0, duplicates });
});
