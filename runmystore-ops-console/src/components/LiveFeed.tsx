"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lane } from "@/lib/event-contract";
import type { Bot, Event } from "@/lib/types";
import { LANE_TABS } from "@/lib/feed-mapping";
import { useLiveEvents, type LiveOptions } from "@/lib/use-live-events";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dayKey, dayStart, addDays } from "@/lib/format";
import { useTimeZone } from "@/components/TimeZone";
import { useScopedHref } from "@/components/ClientScope";
import { FeedRow, reducedMotion } from "@/components/FeedRow";
import type { Connection } from "@/lib/realtime-status";

type Live = ReturnType<typeof useLiveEvents>;
export type Tally = { answered: number; brought_back: number; leads_delivered: number; orders: number };
const ZERO: Tally = { answered: 0, brought_back: 0, leads_delivered: 0, orders: 0 };

/** Today's counters for the tally strip, in the viewer's zone, refreshed when the feed moves. */
export function useTodayTally(clientId: string | undefined, version: number): Tally {
  const tz = useTimeZone();
  const [t, setT] = useState<Tally>(ZERO);
  useEffect(() => {
    let cancelled = false;
    const today = dayKey(new Date(), tz);
    const from = dayStart(today, tz), to = dayStart(addDays(today, 1), tz);
    const timer = setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("client_stats_range", { p_from: from, p_to: to });
      if (cancelled) return;
      const rows = ((data ?? []) as (Tally & { client_id: string })[]).filter((r) => !clientId || r.client_id === clientId);
      setT(rows.reduce((a, r) => ({ answered: a.answered + Number(r.answered), brought_back: a.brought_back + Number(r.brought_back),
        leads_delivered: a.leads_delivered + Number(r.leads_delivered), orders: a.orders + Number(r.orders) }), ZERO));
    }, version ? 1200 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clientId, tz, version]);
  return t;
}

function Counter({ label, value, last }: { label: string; value: number; last?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value || !ref.current || reducedMotion()) { prev.current = value; return; }
    prev.current = value;
    const el = ref.current; el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  }, [value]);
  return (
    <div className={last ? "last" : ""}><dt>{label}</dt><dd ref={ref} className="counter num">{value}</dd></div>
  );
}

const CONN_LABEL: Record<Connection, string> = { live: "Live", connecting: "Connecting", offline: "Reconnecting" };

/** The "Your store, running" card, fed by real events. Presentational; pass the hook result in. */
export function LiveFeedPanel({ live, bots, title, clientId, fleet, hero = true, maxRows = 40, className = "", fill = false }: {
  live: Live; bots: Bot[]; title: string; clientId?: string; fleet?: { live: number; total: number }; hero?: boolean; maxRows?: number; className?: string; fill?: boolean;
}) {
  const router = useRouter();
  const scoped = useScopedHref();
  const [lane, setLane] = useState<"all" | Lane>("all");
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const rows = useMemo(() => live.events.filter((e) => lane === "all" || botsById.get(e.bot_id)?.lane === lane).slice(0, maxRows), [live.events, lane, botsById, maxRows]);
  const tally = useTodayTally(clientId, live.events.length);
  const open = useCallback((e: Event) => router.push(scoped(`/feed?event=${e.id}`)), [router, scoped]);
  const conn = live.connection;
  return (
    <section className={`panel ${hero ? "hero" : ""} grid gap-3.5 p-4 sm:px-5 ${fill ? "min-h-0 flex-1" : ""} ${className}`} style={fill ? { gridTemplateRows: "auto auto minmax(0,1fr) auto" } : undefined} aria-label={title} data-testid="live-feed">
      <div className="flex items-center gap-2.5">
        <span className={`dot ${conn === "live" ? "live" : conn}`} aria-hidden="true" />
        <span className="title text-[0.95rem]">{title}</span>
        <span className="label ml-auto text-dim" role="status">{CONN_LABEL[conn]}{conn === "live" && fleet ? ` · ${fleet.live}/${fleet.total} bots` : ""}</span>
        <button type="button" className="pill sm" aria-pressed={live.paused} onClick={() => live.setPaused(!live.paused)} data-testid="feed-pause">
          {live.paused ? "Play" : "Pause"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter the feed by lane">
        {LANE_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="pill sm" aria-selected={lane === t.id} onClick={() => setLane(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className={`feed-scroll ${fill ? "min-h-0" : ""}`} style={fill ? undefined : { maxHeight: 520 }}>
        {live.paused && live.queued > 0 && (
          <button type="button" className="pill on sm mb-2 w-full justify-center" onClick={() => live.setPaused(false)} data-testid="feed-queued">
            +{live.queued} new · Play to show
          </button>
        )}
        <ol className="grid content-start gap-2" role="list" aria-live="polite" aria-relevant="additions" data-testid="feed-rows">
          {rows.map((e) => <FeedRow key={e.id} event={e} bot={botsById.get(e.bot_id)} fresh={(e as Event & { fresh?: boolean }).fresh} onOpen={open} />)}
        </ol>
        {!live.loading && rows.length === 0 && (
          <p className="py-10 text-center text-dim text-sm">No events yet. Paste the logging instruction into a bot and run it.</p>
        )}
      </div>
      <dl className="tally">
        <Counter label="Answered" value={tally.answered} />
        <Counter label="Brought back" value={tally.brought_back} />
        <Counter label="Leads delivered" value={tally.leads_delivered} />
        <Counter label="Orders from it" value={tally.orders} last />
      </dl>
    </section>
  );
}

/** Self-contained LiveFeed: hook + panel. */
export function LiveFeed(props: Omit<LiveOptions, "bots"> & { bots: Bot[]; title: string; fleet?: { live: number; total: number }; hero?: boolean; maxRows?: number; className?: string; fill?: boolean }) {
  const { title, fleet, hero, maxRows, className, fill, ...opts } = props;
  const live = useLiveEvents(opts);
  return <LiveFeedPanel live={live} bots={props.bots} title={title} clientId={props.clientId} fleet={fleet} hero={hero} maxRows={maxRows} className={className} fill={fill} />;
}
