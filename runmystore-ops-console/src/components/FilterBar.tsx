"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Bot, Client } from "@/lib/types";
import { CHANNEL_LABEL, LANE_LABEL, TYPE_LABEL } from "@/lib/types";
import { CHANNELS, EVENT_STATUSES, EVENT_TYPES, LANES } from "@/lib/event-contract";
import { FILTER_KEYS, type Filters } from "@/lib/event-query";

export function FilterBar({ filters, bots, clients, showText = true, showClient = true }: { filters: Filters; bots: Bot[]; clients: Client[]; showText?: boolean; showClient?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q ?? "");
  const set = (patch: Partial<Filters>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) sp.set(k, v); else sp.delete(k); }
    sp.delete("event");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  const clear = () => { const sp = new URLSearchParams(params.toString()); for (const k of FILTER_KEYS) if (k !== "client") sp.delete(k); setQ(""); router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`); };
  const active = FILTER_KEYS.filter((k) => k !== "client" && filters[k]).length;
  const clientId = clients.find((c) => c.slug === filters.client)?.id;
  const botOptions = bots.filter((b) => !clientId || b.client_id === clientId);
  return (
    <form className="card grid gap-3 p-3 sm:p-4" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || undefined }); }} aria-label="Filters" data-testid="filter-bar">
      {showText && (
        <div className="flex gap-2">
          <input className="input" type="search" placeholder="Search summaries, names, handles… (quotes for phrases, minus to exclude)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search text" />
          <button type="submit" className="btn sm">Search</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {showClient && (
          <select className="select" aria-label="Client" value={filters.client ?? ""} onChange={(e) => set({ client: e.target.value || undefined, bot: undefined })}>
            <option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        <select className="select" aria-label="Bot" value={filters.bot ?? ""} onChange={(e) => set({ bot: e.target.value || undefined })}>
          <option value="">All bots</option>{botOptions.map((b) => <option key={b.id} value={b.id}>{b.name}{!clientId ? ` · ${clients.find((c) => c.id === b.client_id)?.name ?? ""}` : ""}</option>)}
        </select>
        <select className="select" aria-label="Lane" value={filters.lane ?? ""} onChange={(e) => set({ lane: e.target.value || undefined })}>
          <option value="">All lanes</option>{LANES.map((l) => <option key={l} value={l}>{LANE_LABEL[l]}</option>)}
        </select>
        <select className="select" aria-label="Type" value={filters.type ?? ""} onChange={(e) => set({ type: e.target.value || undefined })}>
          <option value="">All types</option>{EVENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select className="select" aria-label="Status" value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">Any status</option>{EVENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select className="select" aria-label="Channel" value={filters.channel ?? ""} onChange={(e) => set({ channel: e.target.value || undefined })}>
          <option value="">Any channel</option>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </select>
        <input className="input" type="date" aria-label="From date" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        <input className="input" type="date" aria-label="To date" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
      </div>
      {active > 0 && <div><button type="button" className="pill sm" onClick={clear}>Clear {active} filter{active > 1 ? "s" : ""}</button></div>}
    </form>
  );
}
