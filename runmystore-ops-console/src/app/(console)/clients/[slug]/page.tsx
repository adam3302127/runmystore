import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ClientPage } from "@/components/ClientPage";
import { dailySummary } from "@/lib/daily-summary";
import { addDays, clock, dayKey, dayStart, fmtDayHeading } from "@/lib/format";
import type { Bot, Client, ClientStats, Event } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("clients").select("name").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Client" };
}

export default async function ClientRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const { data: client } = await supabase.from("clients").select("*").eq("slug", slug).maybeSingle();
  if (!client) notFound();
  const c = client as Client;
  const nowMs = clock();
  const yesterday = addDays(dayKey(new Date(nowMs), c.timezone), -1);
  const yFrom = dayStart(yesterday, c.timezone), yTo = dayStart(addDays(yesterday, 1), c.timezone);
  const [{ data: bots }, { data: week }, { data: activity }, { data: yEvents }] = await Promise.all([
    supabase.from("bots").select("*").eq("client_id", c.id).order("name"),
    supabase.rpc("client_stats_range", { p_from: new Date(nowMs - 7 * 24 * 3600_000).toISOString(), p_to: new Date(nowMs + 60_000).toISOString() }),
    supabase.rpc("bot_activity", { p_since: new Date(nowMs - 24 * 3600_000).toISOString(), p_bucket: "1 hour" }),
    supabase.from("events").select("*").eq("client_id", c.id).gte("occurred_at", yFrom).lt("occurred_at", yTo).order("occurred_at").limit(2000),
  ]);
  const sparks: Record<string, number[]> = {};
  const start = Math.floor(nowMs / 3600_000) * 3600_000 - 23 * 3600_000;
  for (const row of (activity ?? []) as { bot_id: string; bucket: string; n: number }[]) {
    const idx = Math.floor((Date.parse(row.bucket) - start) / 3600_000);
    if (idx >= 0 && idx <= 23) (sparks[row.bot_id] ??= new Array(24).fill(0))[idx] = Number(row.n);
  }
  const bl = (bots ?? []) as Bot[];
  return <ClientPage client={c} bots={bl} sparks={sparks} week={((week ?? []) as ClientStats[]).find((s) => s.client_id === c.id) ?? null}
    summary={dailySummary(yesterday, (yEvents ?? []) as Event[], bl)} summaryDayLabel={fmtDayHeading(yFrom, c.timezone)} serverNow={nowMs} />;
}
