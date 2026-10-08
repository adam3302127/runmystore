import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bot, Event } from "@/lib/types";
import { CHANNELS, EVENT_STATUSES, EVENT_TYPES, LANES } from "@/lib/event-contract";

export type Filters = {
  client?: string; bot?: string; lane?: string; type?: string; status?: string; channel?: string;
  from?: string; to?: string; q?: string;
};
export const FILTER_KEYS: (keyof Filters)[] = ["client", "bot", "lane", "type", "status", "channel", "from", "to", "q"];

export function cleanFilters(raw: Record<string, string | undefined>): Filters {
  const f: Filters = {};
  for (const k of FILTER_KEYS) { const v = raw[k]?.trim(); if (v) f[k] = v; }
  if (f.type && !(EVENT_TYPES as readonly string[]).includes(f.type)) delete f.type;
  if (f.status && !(EVENT_STATUSES as readonly string[]).includes(f.status)) delete f.status;
  if (f.channel && !(CHANNELS as readonly string[]).includes(f.channel)) delete f.channel;
  if (f.lane && !(LANES as readonly string[]).includes(f.lane)) delete f.lane;
  if (f.from && !/^\d{4}-\d{2}-\d{2}$/.test(f.from)) delete f.from;
  if (f.to && !/^\d{4}-\d{2}-\d{2}$/.test(f.to)) delete f.to;
  return f;
}

/** Applies filters to an events query. `fromIso`/`toIso` are the resolved day bounds in the viewer's zone. */
export function applyFilters(
  sb: SupabaseClient, f: Filters, ctx: { clientId?: string; bots: Bot[]; fromIso?: string; toIso?: string },
) {
  let q = sb.from("events").select("*");
  if (ctx.clientId) q = q.eq("client_id", ctx.clientId);
  if (f.bot) q = q.eq("bot_id", f.bot);
  else if (f.lane) {
    const ids = ctx.bots.filter((b) => b.lane === f.lane && (!ctx.clientId || b.client_id === ctx.clientId)).map((b) => b.id);
    q = q.in("bot_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (f.type) q = q.eq("type", f.type);
  if (f.status) q = q.eq("status", f.status);
  if (f.channel) q = q.eq("channel", f.channel);
  if (ctx.fromIso) q = q.gte("occurred_at", ctx.fromIso);
  if (ctx.toIso) q = q.lt("occurred_at", ctx.toIso);
  if (f.q) q = q.textSearch("fts", f.q, { type: "websearch", config: "english" });
  return q;
}

/** Keyset page: rows strictly older than (occurred_at, id). */
export async function fetchPage(
  sb: SupabaseClient, f: Filters, ctx: { clientId?: string; bots: Bot[]; fromIso?: string; toIso?: string },
  cursor: { occurred_at: string; id: string } | null, limit = 50,
): Promise<Event[]> {
  let q = applyFilters(sb, f, ctx);
  if (cursor) q = q.or(`occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`);
  const { data, error } = await q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as Event[];
}
