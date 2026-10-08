"use client";
import { useConnection } from "@/lib/realtime-status";

const LABEL = { live: "Live", connecting: "Connecting", offline: "Reconnecting" } as const;
export function ConnectionPill({ detail }: { detail?: string }) {
  const c = useConnection();
  return (
    <span className="label inline-flex items-center gap-2 text-dim" role="status" aria-live="polite">
      <span className={`dot ${c === "live" ? "live" : c}`} aria-hidden="true" />
      {LABEL[c]}{detail && c === "live" ? ` · ${detail}` : ""}
    </span>
  );
}
