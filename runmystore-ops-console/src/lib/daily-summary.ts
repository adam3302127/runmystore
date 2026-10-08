import type { Bot, Event } from "@/lib/types";

export type DailySummary = {
  day: string; handled: number; replies: number; broughtBack: string[]; leads: string[]; carePacks: number; errors: string[]; needsYou: string[]; orders: number; events: number;
};
/** The morning note RMS promises clients, built from one day of events. */
export function dailySummary(day: string, events: Event[], bots: Bot[]): DailySummary {
  const lane = new Map(bots.map((b) => [b.id, b.lane]));
  const s: DailySummary = { day, handled: 0, replies: 0, broughtBack: [], leads: [], carePacks: 0, errors: [], needsYou: [], orders: 0, events: events.length };
  const seenErr = new Set<string>();
  for (const e of events) {
    const outcome = typeof e.payload?.outcome === "string" ? e.payload.outcome : null;
    if (e.type === "message_received") s.handled++;
    if (e.type === "message_sent" && lane.get(e.bot_id) === "cs") s.replies++;
    if (outcome === "reordered" || outcome === "won_back") { if (e.counterparty_name && !s.broughtBack.includes(e.counterparty_name)) s.broughtBack.push(e.counterparty_name); }
    if (outcome === "lead_delivered") s.leads.push(e.summary.replace(/^New lead: /, "").replace(/, added to Close$/, ""));
    if (outcome === "care_pack_sent" && e.type === "action") s.carePacks++;
    if (outcome && ["order", "reordered", "won_back", "upsell"].includes(outcome)) s.orders++;
    if (e.type === "error" && !seenErr.has(e.summary)) { seenErr.add(e.summary); s.errors.push(e.summary); }
    if (e.type === "decision_needed" && e.status !== "resolved") s.needsYou.push(e.summary);
  }
  return s;
}
