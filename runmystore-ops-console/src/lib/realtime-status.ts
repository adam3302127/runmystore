"use client";
import { useSyncExternalStore } from "react";

export type Connection = "live" | "connecting" | "offline";
let state: Connection = "connecting";
const listeners = new Set<() => void>();
export function setConnection(c: Connection) {
  if (c === state) return;
  state = c;
  for (const l of listeners) l();
}
export function useConnection(): Connection {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => "connecting" as Connection);
}
