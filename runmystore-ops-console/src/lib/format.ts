import { DEFAULT_TZ } from "@/lib/env";

export function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch { return tz; }
}
export function fmtTime(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDate(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso));
}
export function fmtDateTime(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDayHeading(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(iso));
}
/** Calendar day (YYYY-MM-DD) of an instant in a zone. */
export function dayKey(iso: string | Date, tz = DEFAULT_TZ): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** Start of a calendar day (YYYY-MM-DD) in a zone, as an ISO instant. */
export function dayStart(day: string, tz = DEFAULT_TZ): string {
  // Find the UTC instant whose local date/time in tz is day 00:00 by probing the offset.
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = tzOffsetMinutes(guess, tz);
  const t = new Date(guess.getTime() - offset * 60_000);
  const offset2 = tzOffsetMinutes(t, tz);
  return new Date(guess.getTime() - offset2 * 60_000).toISOString();
}
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h}h ago`;
  const d = Math.round(h / 24); return `${d}d ago`;
}
export function money(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
export function fmtInterval(min: number): string {
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}m`;
}
/** Wall clock for server components (one read per request, kept out of JSX). */
export function clock(): number { return Date.now(); }
export function plural(n: number, one: string, many = one + "s"): string { return `${n} ${n === 1 ? one : many}`; }
