import type { Bot } from "@/lib/types";

export type Health = "live" | "stale" | "erroring" | "paused";
export const HEALTH_LABEL: Record<Health, string> = { live: "Live", stale: "Stale", erroring: "Erroring", paused: "Paused" };

/** Spec rule: paused = disabled; erroring = error in last 60 min and newer than the last non-error event;
 *  stale = quiet for more than 2x the expected interval; otherwise live. */
export function botHealth(b: Pick<Bot, "enabled" | "last_error_at" | "last_event_at" | "last_seen_at" | "expected_interval_minutes">, now = Date.now()): Health {
  if (!b.enabled) return "paused";
  if (b.last_error_at) {
    const err = Date.parse(b.last_error_at);
    const lastOk = b.last_event_at ? Date.parse(b.last_event_at) : 0;
    if (now - err < 60 * 60_000 && err >= lastOk) return "erroring";
  }
  if (!b.last_seen_at) return "stale";
  if (now - Date.parse(b.last_seen_at) > 2 * b.expected_interval_minutes * 60_000) return "stale";
  return "live";
}
export function fleetSummary(bots: Pick<Bot, "enabled" | "last_error_at" | "last_event_at" | "last_seen_at" | "expected_interval_minutes">[], now = Date.now()) {
  const counts = { live: 0, stale: 0, erroring: 0, paused: 0 };
  for (const b of bots) counts[botHealth(b, now)]++;
  return { ...counts, total: bots.length, enabled: bots.filter((b) => b.enabled).length };
}
