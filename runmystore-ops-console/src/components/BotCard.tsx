"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Bot } from "@/lib/types";
import { LANE_SHORT } from "@/lib/types";
import { botHealth, HEALTH_LABEL } from "@/lib/health";
import { ago, fmtInterval } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { useScopedHref } from "@/components/ClientScope";

/** Re-renders every 30 s so "seen 3m ago" and the health dot stay honest without a refresh. */
export function useClock(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function BotCard({ bot, spark, now }: { bot: Bot; spark: number[]; now: number }) {
  const scoped = useScopedHref();
  const health = botHealth(bot, now);
  return (
    <Link href={scoped(`/bots/${bot.id}`)} className="card grid gap-3 p-4 no-underline" data-testid="bot-card" data-health={health}>
      <div className="flex items-start gap-2.5">
        <span className={`dot ${health} mt-1.5`} aria-hidden="true" />
        <span className="grid min-w-0 flex-1">
          <span className="title text-[1.02rem] truncate">{bot.name}</span>
          <span className="lane-chip">{LANE_SHORT[bot.lane]} · {HEALTH_LABEL[health]}</span>
        </span>
        {bot.open_decisions > 0 && <span className="tag you" data-testid="open-decisions">{bot.open_decisions} needs you</span>}
      </div>
      <p className="clamp-2 text-sm text-muted-dark" style={{ color: "var(--muted-dark)" }}>{bot.last_summary ?? "No events yet. Paste the logging instruction into this bot and run it."}</p>
      <div className="flex items-end justify-between gap-3">
        <span className="text-xs text-dim">seen {ago(bot.last_seen_at, now)} · every {fmtInterval(bot.expected_interval_minutes)}</span>
        <Sparkline points={spark} width={96} height={24} />
      </div>
    </Link>
  );
}
