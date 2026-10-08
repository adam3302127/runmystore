// The bot event contract (v1), shared by the importer, the simulator and the UI types.
// Mirrors the validation in supabase/functions/ingest/index.ts; keep the two in step.
import { z } from "zod";

export const EVENT_TYPES = ["action", "message_sent", "message_received", "crm_write", "alert", "error",
  "decision_needed", "run_started", "run_finished", "heartbeat"] as const;
export const EVENT_STATUSES = ["ok", "pending", "failed", "needs_review", "resolved"] as const;
export const CHANNELS = ["email", "whatsapp", "sms", "chat", "crm", "web", "phone", "internal", "other"] as const;
export const DIRECTIONS = ["inbound", "outbound", "none"] as const;
export const LANES = ["cs", "retention", "lead", "ops", "other"] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Channel = (typeof CHANNELS)[number];
export type Lane = (typeof LANES)[number];

export const LinkSchema = z.object({ label: z.string().max(80), url: z.url().max(2000) });

export const DecisionSchema = z.object({
  question: z.string().min(1).max(1000),
  options: z.array(z.object({ key: z.string().max(50), label: z.string().max(120) })).max(8).optional(),
  priority: z.number().int().min(0).max(3).optional(),
  due_at: z.iso.datetime({ offset: true }).optional(),
});

export const BotEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  summary: z.string().trim().min(1).max(500),
  status: z.enum(EVENT_STATUSES).optional(),
  severity: z.number().int().min(0).max(3).optional(),
  run_id: z.string().max(200).optional(),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  channel: z.enum(CHANNELS).optional(),
  direction: z.enum(DIRECTIONS).optional(),
  counterparty: z.object({ name: z.string().max(200).optional(), handle: z.string().max(320).optional() }).optional(),
  thread_ref: z.string().max(500).optional(),
  close_lead_id: z.string().max(100).optional(),
  close_activity_id: z.string().max(100).optional(),
  amount_cents: z.number().int().optional(),
  detail: z.string().max(20000).optional(),
  links: z.array(LinkSchema).max(10).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  decision: DecisionSchema.nullable().optional(),
  idempotency_key: z.string().max(300).optional(),
}).superRefine((e, ctx) => {
  if (e.type === "decision_needed" && !e.decision) {
    ctx.addIssue({ code: "custom", message: "decision_needed requires a decision object", path: ["decision"] });
  }
});
export type BotEvent = z.infer<typeof BotEventSchema>;

/** Payload keys the ingest function drops on messages when a client keeps bodies off. */
export const BODY_KEYS = ["body", "text", "html", "message", "content"] as const;

export type EventRow = {
  bot_id: string; client_id: string; type: EventType; status: EventStatus; severity: number;
  run_id: string | null; summary: string; detail: string | null; channel: Channel | null;
  direction: (typeof DIRECTIONS)[number]; counterparty_name: string | null; counterparty_handle: string | null;
  thread_ref: string | null; close_lead_id: string | null; close_activity_id: string | null;
  amount_cents: number | null; links: z.infer<typeof LinkSchema>[]; payload: Record<string, unknown>;
  idempotency_key: string | null; occurred_at: string;
};

/** Same normalisation the ingest function applies. `now` lets callers pin the clock. */
export function toEventRow(e: BotEvent, ctx: { botId: string; clientId: string; storeBodies: boolean }, now = Date.now()): EventRow {
  const payload: Record<string, unknown> = { ...(e.payload ?? {}) };
  let detail = e.detail ?? null;
  const isMessage = e.type === "message_sent" || e.type === "message_received";
  if (isMessage && !ctx.storeBodies) {
    detail = null;
    for (const k of BODY_KEYS) delete payload[k];
  }
  if (e.decision) payload.decision = e.decision;
  let occurred = e.occurred_at ? Date.parse(e.occurred_at) : now;
  if (occurred > now + 5 * 60_000) occurred = now;
  return {
    bot_id: ctx.botId,
    client_id: ctx.clientId,
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
}
