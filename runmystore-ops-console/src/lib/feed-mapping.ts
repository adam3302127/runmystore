import type { Event } from "@/lib/types";
import type { Lane } from "@/lib/event-contract";
import { CLOSE_BASE } from "@/lib/env";

export type Tag = { kind: "you" | "order" | "upsell" | "skip" | "error" | "crm" | "alert"; label: string } | null;

/** Chip shown on a feed row, derived from type/status/payload.outcome (spec section 6). */
export function eventTag(e: Pick<Event, "type" | "status" | "payload">): Tag {
  const outcome = typeof e.payload?.outcome === "string" ? (e.payload.outcome as string) : null;
  if (e.type === "decision_needed") return e.status === "resolved" ? { kind: "crm", label: "Answered" } : { kind: "you", label: "Needs you" };
  if (e.type === "error") return { kind: "error", label: "Error" };
  if (e.type === "alert") return { kind: "alert", label: "Alert" };
  if (outcome === "order" || outcome === "reordered" || outcome === "won_back") return { kind: "order", label: "Order" };
  if (outcome === "upsell") return { kind: "upsell", label: "Upsell" };
  if (outcome === "skipped") return { kind: "skip", label: "Skipped" };
  if (e.type === "crm_write") return { kind: "crm", label: "CRM" };
  return null;
}
export function tagClass(t: Tag): string {
  if (!t) return "tag";
  switch (t.kind) {
    case "you": return "tag you";
    case "skip": return "tag skip";
    case "error": return "tag error";
    case "crm": return "tag crm";
    case "alert": return "tag muted";
    default: return "tag";
  }
}
/** First clause of a summary, for the IN slot when there is no counterparty. */
function firstClause(s: string): string {
  const m = s.split(/[:,;]| → | - /)[0];
  return m.length < s.length ? m.trim() : s.slice(0, 48);
}
export type FeedRowModel = { who: string; in: string; out: string; tag: Tag; lane: Lane; isError: boolean };
export function toRow(e: Event, bot?: { name: string; lane: Lane }): FeedRowModel {
  const lane = bot?.lane ?? "other";
  const who = bot?.name ?? "Bot";
  let inText: string;
  if (e.counterparty_name) {
    const ctx = e.type === "message_received" ? "wrote in" : e.type === "message_sent" ? `${e.channel ?? "message"} out`
      : e.type === "decision_needed" ? "needs a call" : e.type === "crm_write" ? "in Close" : firstClause(e.summary);
    inText = `${e.counterparty_name} · ${ctx}`;
  } else if (e.run_id && (e.type === "run_started" || e.type === "run_finished")) {
    inText = `Run ${e.run_id}`;
  } else {
    inText = firstClause(e.summary);
  }
  return { who, in: inText, out: e.summary, tag: eventTag(e), lane, isError: e.type === "error" };
}
export function closeLeadUrl(id: string | null | undefined): string | null {
  return id ? `${CLOSE_BASE}/lead/${encodeURIComponent(id)}/` : null;
}
export const LANE_TABS: { id: "all" | Lane; label: string }[] = [
  { id: "all", label: "All" }, { id: "cs", label: "Customer Service" }, { id: "retention", label: "Retention" }, { id: "lead", label: "Lead Engine" }, { id: "ops", label: "Ops" },
];
