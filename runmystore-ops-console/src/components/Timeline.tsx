"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Bot, Client, Event } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchPage, type Filters } from "@/lib/event-query";
import { useLiveEvents } from "@/lib/use-live-events";
import { FeedRow } from "@/components/FeedRow";
import { FilterBar } from "@/components/FilterBar";
import { Empty } from "@/components/Stripes";
import { Time, useTimeZone } from "@/components/TimeZone";
import { addDays, dayKey, dayStart, fmtDayHeading } from "@/lib/format";
import { useScopedHref } from "@/components/ClientScope";
import type { Lane, EventType } from "@/lib/event-contract";

export function Timeline({ filters, bots, clients, initial, showFilters = true, showClient = true, title }: {
  filters: Filters; bots: Bot[]; clients: Client[]; initial: Event[]; showFilters?: boolean; showClient?: boolean; title?: string;
}) {
  const tz = useTimeZone();
  const router = useRouter();
  const scoped = useScopedHref();
  const clientId = clients.find((c) => c.slug === filters.client)?.id;
  const fromIso = filters.from ? dayStart(filters.from, tz) : undefined;
  const toIso = filters.to ? dayStart(addDays(filters.to, 1), tz) : undefined;
  const historical = !!toIso && toIso <= new Date().toISOString();
  const [older, setOlder] = useState<Event[]>(initial);
  const [done, setDone] = useState(initial.length < 50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const filtersKey = JSON.stringify(filters);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  // Live layer: only when the view includes "now" (no upper date bound in the past).
  const live = useLiveEvents({
    clientId, botId: filters.bot, bots, enabled: !historical,
    lanes: filters.lane ? [filters.lane as Lane] : undefined,
    types: filters.type ? [filters.type as EventType] : undefined,
    limit: 0,
  });
  // The server gave the first page; when the filters change client-side, reload the first page.
  const firstKey = useRef(filtersKey);
  useEffect(() => {
    if (firstKey.current === filtersKey) return;
    firstKey.current = filtersKey;
    let cancelled = false;
    setLoading(true); setOlder([]); setDone(false);
    fetchPage(supabaseBrowser(), filters, { clientId, bots, fromIso, toIso }, null).then((rows) => {
      if (cancelled) return;
      setOlder(rows); setDone(rows.length < 50); setLoading(false);
    }).catch((e) => { if (!cancelled) { setError(String(e.message ?? e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filtersKey, filters, clientId, bots, fromIso, toIso]);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    const last = older[older.length - 1];
    setLoading(true);
    try {
      const rows = await fetchPage(supabaseBrowser(), filters, { clientId, bots, fromIso, toIso }, last ? { occurred_at: last.occurred_at, id: last.id } : null);
      setOlder((prev) => { const seen = new Set(prev.map((e) => e.id)); return [...prev, ...rows.filter((r) => !seen.has(r.id))]; });
      if (rows.length < 50) setDone(true);
    } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
  }, [loading, done, older, filters, clientId, bots, fromIso, toIso]);

  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // Merge: live (newest, filtered, in-memory) above the paged history, deduped.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Event[] = [];
    const matchesStatus = (e: Event) => (!filters.status || e.status === filters.status) && (!filters.channel || e.channel === filters.channel) && (!fromIso || e.occurred_at >= fromIso);
    for (const e of [...live.events.filter(matchesStatus), ...older]) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } }
    return out;
  }, [live.events, older, filters.status, filters.channel, fromIso]);
  const groups = useMemo(() => {
    const g: { day: string; label: string; rows: Event[] }[] = [];
    for (const e of rows) {
      const day = dayKey(e.occurred_at, tz);
      if (!g.length || g[g.length - 1].day !== day) g.push({ day, label: fmtDayHeading(e.occurred_at, tz), rows: [] });
      g[g.length - 1].rows.push(e);
    }
    return g;
  }, [rows, tz]);
  const open = useCallback((e: Event) => { const sp = new URLSearchParams(window.location.search); sp.set("event", e.id); router.replace(`${window.location.pathname}?${sp}`, { scroll: false }); }, [router]);

  return (
    <div className="grid gap-4" data-testid="timeline">
      {showFilters && <FilterBar filters={filters} bots={bots} clients={clients} showClient={showClient} />}
      <div className="flex items-center justify-between gap-3 text-xs text-dim">
        <span>{title ?? "Timeline"} · {historical ? "history" : live.connection === "live" ? "live, newest first" : "connecting"}{live.queued ? ` · +${live.queued} new` : ""}</span>
        {!historical && <button type="button" className="pill sm" aria-pressed={live.paused} onClick={() => live.setPaused(!live.paused)}>{live.paused ? `Play${live.queued ? ` (+${live.queued})` : ""}` : "Pause"}</button>}
      </div>
      {groups.map((g) => (
        <section key={g.day} className="grid gap-2" aria-label={g.label}>
          <h2 className="label sticky top-[68px] z-10 bg-ink py-1 text-dim">{g.label}</h2>
          <ol className="grid gap-2" role="list" aria-live={g === groups[0] && !historical ? "polite" : undefined}>
            {g.rows.map((e) => (
              <FeedRow key={e.id} event={e} bot={botsById.get(e.bot_id)} fresh={(e as Event & { fresh?: boolean }).fresh} onOpen={open}
                showTime={<span className="ml-2 text-xs text-dim"><Time iso={e.occurred_at} /></span>} />
            ))}
          </ol>
        </section>
      ))}
      {error && <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{error}</p>}
      {!loading && rows.length === 0 && <Empty title="Nothing here">{Object.keys(filters).length ? "Loosen the filters, or widen the dates." : "No events yet. Paste the logging instruction into a bot and run it."}</Empty>}
      <div ref={sentinel} className="py-4 text-center text-xs text-dim" aria-live="polite">{loading ? "Loading older events…" : done && rows.length ? `That's everything (${rows.length} shown).` : ""}</div>
      <p className="sr-only"><a href={scoped("/feed")}>Timeline</a></p>
    </div>
  );
}
