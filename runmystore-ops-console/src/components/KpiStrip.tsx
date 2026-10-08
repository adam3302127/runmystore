"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dayKey, dayStart, addDays } from "@/lib/format";
import { useTimeZone, ZoneLabel } from "@/components/TimeZone";
import type { ClientStats } from "@/lib/types";

const ZERO = { answered: 0, brought_back: 0, leads_delivered: 0, orders: 0, errors: 0, decisions_opened: 0, events: 0 };
type K = typeof ZERO;

export function KpiStrip({ clientId, openDecisions, version = 0 }: { clientId?: string; openDecisions: number; version?: number }) {
  const tz = useTimeZone();
  const [k, setK] = useState<K>(ZERO);
  useEffect(() => {
    let cancelled = false;
    const today = dayKey(new Date(), tz);
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("client_stats_range", { p_from: dayStart(today, tz), p_to: dayStart(addDays(today, 1), tz) });
      if (cancelled) return;
      const rows = ((data ?? []) as ClientStats[]).filter((r) => !clientId || r.client_id === clientId);
      setK(rows.reduce((a, r) => ({ answered: a.answered + +r.answered, brought_back: a.brought_back + +r.brought_back, leads_delivered: a.leads_delivered + +r.leads_delivered,
        orders: a.orders + +r.orders, errors: a.errors + +r.errors, decisions_opened: a.decisions_opened + +r.decisions_opened, events: a.events + +r.events }), ZERO));
    }, version ? 1500 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [clientId, tz, version]);
  const items: { label: string; value: number; tone?: "red" | "teal" }[] = [
    { label: "Answered", value: k.answered }, { label: "Brought back", value: k.brought_back }, { label: "Leads delivered", value: k.leads_delivered },
    { label: "Orders", value: k.orders }, { label: "Errors", value: k.errors, tone: k.errors ? "red" : undefined }, { label: "Open decisions", value: openDecisions, tone: openDecisions ? "teal" : undefined },
  ];
  return (
    <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Today's numbers" data-testid="kpi-strip">
      {items.map((it) => (
        <div key={it.label} className={it.tone === "teal" ? "pl-3" : ""} style={it.tone === "teal" ? { borderLeft: "3px solid var(--teal)" } : undefined}>
          <p className="label text-dim">{it.label}</p>
          <p className="counter num text-3xl" style={it.tone === "red" ? { color: "#f5a37a" } : undefined}>{it.value}</p>
        </div>
      ))}
      <p className="col-span-full text-xs text-dim -mt-1">Today, <ZoneLabel /> · {k.events} events so far</p>
    </section>
  );
}
