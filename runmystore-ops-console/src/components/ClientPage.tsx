"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Bot, Client, ClientStats } from "@/lib/types";
import { PLAN_LABEL } from "@/lib/types";
import { fleetSummary } from "@/lib/health";
import { useLiveEvents } from "@/lib/use-live-events";
import { LiveFeedPanel } from "@/components/LiveFeed";
import { BotCard, useClock } from "@/components/BotCard";
import { Eyebrow, Empty } from "@/components/Stripes";
import type { DailySummary } from "@/lib/daily-summary";
import { useScopedHref } from "@/components/ClientScope";

export function ClientPage({ client, bots: initial, sparks, week, summary, summaryDayLabel }: {
  client: Client; bots: Bot[]; sparks: Record<string, number[]>; week: ClientStats | null; summary: DailySummary; summaryDayLabel: string;
}) {
  const [bots, setBots] = useState(initial);
  const now = useClock();
  const scoped = useScopedHref();
  const onBotUpdate = useCallback((b: Bot) => setBots((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...b } : x))), []);
  const live = useLiveEvents({ clientId: client.id, bots, onBotUpdate });
  const fleet = useMemo(() => fleetSummary(bots, now), [bots, now]);
  const kpis = [
    { label: "Answered", v: week?.answered ?? 0 }, { label: "Brought back", v: week?.brought_back ?? 0 }, { label: "Leads delivered", v: week?.leads_delivered ?? 0 },
    { label: "Orders", v: week?.orders ?? 0 }, { label: "Errors", v: week?.errors ?? 0 }, { label: "Decisions", v: week?.decisions_opened ?? 0 },
  ];
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <Eyebrow>Client</Eyebrow>
          <h1 className="display text-4xl sm:text-5xl">{client.name}</h1>
          <p className="text-sm text-dim">{client.plan ? PLAN_LABEL[client.plan] ?? client.plan : "No plan"} · {client.status} · {client.timezone} · {client.store_message_bodies ? "message bodies on" : "summaries only"}{client.close_lead_id ? <> · <a className="underline" href={`https://app.close.com/lead/${client.close_lead_id}/`} target="_blank" rel="noreferrer">Close ↗</a></> : null}</p>
        </div>
        <div className="flex gap-2"><Link className="pill sm" href={scoped(`/feed?client=${client.slug}`)}>Timeline</Link><Link className="pill sm" href={scoped(`/inbox?client=${client.slug}`)}>Inbox</Link><Link className="pill sm" href={scoped(`/decisions?client=${client.slug}`)}>Needs you</Link></div>
      </header>
      <section className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Last seven days">
        {kpis.map((k) => <div key={k.label}><p className="label text-dim">{k.label}</p><p className="counter num text-3xl">{k.v}</p></div>)}
        <p className="col-span-full -mt-1 text-xs text-dim">Last 7 days · {week?.events ?? 0} events</p>
      </section>
      <div className="shell with-rail">
        <div className="grid gap-8">
          <section className="grid gap-3" aria-label="Bots">
            <div className="flex items-center gap-3"><h2 className="title text-lg">Bots</h2><span className="text-xs text-dim">{fleet.live} live · {fleet.stale} stale · {fleet.erroring} erroring · {fleet.paused} paused</span></div>
            {bots.length === 0 && <Empty title="No bots yet">Add this client&apos;s bots under Settings.</Empty>}
            <div className="bot-grid">{bots.map((b) => <BotCard key={b.id} bot={b} spark={sparks[b.id] ?? new Array(24).fill(0)} now={now} />)}</div>
          </section>
          <section className="panel p-5 grid gap-3" aria-label="Daily summary preview" data-testid="daily-summary">
            <div className="flex items-baseline justify-between gap-3"><h2 className="title text-lg">Daily summary</h2><span className="text-xs text-dim">{summaryDayLabel} · preview of the morning note</span></div>
            {summary.events === 0 ? <p className="text-sm text-dim">Nothing happened that day. Once the bots run, this reads like a note from your ops team.</p> : (
              <div className="grid gap-3 text-[0.95rem] leading-relaxed">
                <p>Good morning. Yesterday your store ran {bots.length} bots through <strong>{summary.events} actions</strong>.</p>
                <ul className="grid gap-1.5 pl-5" style={{ listStyle: "disc" }}>
                  <li><strong>Handled:</strong> {summary.handled} customer messages came in and {summary.replies} replies went out{summary.carePacks ? `, including ${summary.carePacks} care pack${summary.carePacks > 1 ? "s" : ""} shipped at no charge` : ""}.</li>
                  <li><strong>Who came back:</strong> {summary.broughtBack.length ? summary.broughtBack.join(", ") : "no win-backs yesterday"}{summary.orders ? ` · ${summary.orders} order${summary.orders > 1 ? "s" : ""} from it` : ""}.</li>
                  <li><strong>Leads:</strong> {summary.leads.length ? summary.leads.slice(0, 5).join("; ") + (summary.leads.length > 5 ? ` and ${summary.leads.length - 5} more` : "") : "none new"}.</li>
                  <li><strong>Needs you:</strong> {summary.needsYou.length ? summary.needsYou.slice(0, 3).join("; ") : "nothing waiting"}.</li>
                  {summary.errors.length > 0 && <li><strong>Watch:</strong> {summary.errors.slice(0, 3).join("; ")}.</li>}
                </ul>
              </div>
            )}
          </section>
        </div>
        <aside className="rail" aria-label="Live feed">
          <LiveFeedPanel live={live} bots={bots} title={`${client.name}, running`} clientId={client.id} fleet={{ live: fleet.live, total: fleet.enabled }} fill />
        </aside>
      </div>
    </div>
  );
}
