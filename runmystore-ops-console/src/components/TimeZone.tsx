"use client";
import { createContext, useContext, useSyncExternalStore } from "react";
import { DEFAULT_TZ } from "@/lib/env";
import { fmtDate, fmtDateTime, fmtTime, tzLabel } from "@/lib/format";

const Ctx = createContext<string>(DEFAULT_TZ);
const noop = () => () => {};
const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ; } catch { return DEFAULT_TZ; } };
/** Viewer time zone: the server renders in the default zone, the browser switches to its own at hydration. */
export function TimeZoneProvider({ children }: { children: React.ReactNode }) {
  const tz = useSyncExternalStore(noop, browserTz, () => DEFAULT_TZ);
  return <Ctx.Provider value={tz}>{children}</Ctx.Provider>;
}
export function useTimeZone() { return useContext(Ctx); }

export function Time({ iso, mode = "time", className }: { iso: string; mode?: "time" | "date" | "datetime"; className?: string }) {
  const tz = useTimeZone();
  const text = mode === "time" ? fmtTime(iso, tz) : mode === "date" ? fmtDate(iso, tz) : fmtDateTime(iso, tz);
  return <time dateTime={iso} title={`${fmtDateTime(iso, tz)} ${tzLabel(tz)}`} className={className} suppressHydrationWarning>{text}</time>;
}
export function ZoneLabel({ className }: { className?: string }) {
  const tz = useTimeZone();
  return <span className={className} suppressHydrationWarning>{tzLabel(tz)}</span>;
}
