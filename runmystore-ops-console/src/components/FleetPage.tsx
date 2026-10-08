"use client";
import { useCallback, useMemo, useState } from "react";
import type { Bot, Client } from "@/lib/types";
import { fleetSummary } from "@/lib/health";
import { useLiveEvents } from "@/lib/use-live-events";
import { LiveFeedPanel } from "@/components/LiveFeed";
import { BotCard, useClock } from "@/components/BotCard";
import { KpiStrip } from "@/components/KpiStrip";
import { Eyebrow, Empty } from "@/components/Stripes";
import { useScopedHref } from "@/components/ClientScope";
import Link from "next/link";

export function FleetPage({ clients, bots: initial, sparks, scope }: { clients: Client[]; bots: Bot[]; sparks: Record<string, number[]>; scope: Client | null }) {
  const [bots, setBots] = useState(initial);
  const now = useClock();
  const scoped = useScopedHref();
  const onBotUpdate = useCallback((b: Bot) => setBots((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...b } : x))), []);
  const live = useLiveEvents({ clientId: scope?.id, bots, onBotUpdate });
  const fleet = useMemo(() => fleetSummary(bots, now), [bots, now]);
  const openDecisions = bots.reduce((a, b) => a + b.open_decisions, 0);
  const groups = clients.map((c) => ({ client: c, bots: bots.filter((b) => b.client_id === c.id) })).filter((g) => g.bots.length);
  const [tab, setTab] = useState<"fleet" | "feed">("fleet");
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <Eyebrow>{scope ? scope.name : "Fleet"}</Eyebrow>
          <h1 className="display text-4xl sm:text-5xl">{scope ? "Their store, running." : "Every bot, running."}</h1>
        </div>
        <p className="text-sm text-dim">{fleet.live} live · {fleet.stale} stale · {fleet.erroring} erroring · {fleet.paused} paused</p>
      </div>
      <KpiStrip clientId={scope?.id} openDecisions={openDecisions} version={live.events.length} />
      <div className="flex gap-1.5 min-[1100px]:hidden" role="tablist" aria-label="Fleet or live feed">
        <button type="button" role="tab" className="pill" aria-selected={tab === "fleet"} onClick={() => setTab("fleet")}>Bots</button>
        <button type="button" role="tab" className="pill" aria-selected={tab === "feed"} onClick={() => setTab("feed")}>Live feed{live.queued ? ` (+${live.queued})` : ""}</button>
      </div>
      <div className="shell with-rail">
        <div className={`grid gap-8 ${tab === "feed" ? "hidden min-[1100px]:grid" : ""}`}>
          {groups.length === 0 && <Empty title="No bots yet">Add a client and its bots under Settings, then paste each bot&apos;s logging instruction.</Empty>}
          {groups.map((g) => (
            <section key={g.client.id} className="grid gap-3" aria-label={g.client.name}>
              <div className="flex items-center gap-3">
                <h2 className="title text-lg"><Link href={scoped(`/clients/${g.client.slug}`)} className="no-underline hover:underline">{g.client.name}</Link></h2>
                <span className="text-xs text-dim">{g.bots.length} bots{g.client.status !== "active" ? ` · ${g.client.status}` : ""}</span>
              </div>
              <div className="bot-grid">
                {g.bots.map((b) => <BotCard key={b.id} bot={b} spark={sparks[b.id] ?? new Array(24).fill(0)} now={now} />)}
              </div>
            </section>
          ))}
        </div>
        <aside className={`rail ${tab === "fleet" ? "hidden min-[1100px]:flex" : ""}`} aria-label="Live feed">
          <LiveFeedPanel live={live} bots={bots} title={scope ? `${scope.name}, running` : "Fleet, running"} clientId={scope?.id} fleet={{ live: fleet.live, total: fleet.enabled }} fill />
        </aside>
      </div>
    </div>
  );
}
