import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { BotPage } from "@/components/BotPage";
import { DEFAULT_TZ } from "@/lib/env";
import { clock, dayKey } from "@/lib/format";
import type { Bot, BotKey, BotRun, Client } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("bots").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Bot" };
}

export default async function BotRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const supabase = await supabaseServer();
  const { data: bot } = await supabase.from("bots").select("*").eq("id", id).maybeSingle();
  if (!bot) notFound();
  const nowMs = clock();
  const since = new Date(nowMs - 7 * 24 * 3600_000).toISOString();
  const [{ data: client }, { data: keys }, { data: runs }, { data: activity }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", bot.client_id).maybeSingle(),
    viewer.isAdmin ? supabase.from("bot_keys").select("id,bot_id,prefix,label,created_at,last_used_at,revoked_at").eq("bot_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.rpc("bot_runs", { p_bot_id: id, p_limit: 30 }),
    supabase.rpc("bot_activity", { p_since: since, p_bucket: "1 hour", p_bot_id: id }),
  ]);
  if (!client) notFound();
  // Roll hourly buckets into days in the console's default zone (the chart is a shape, not a report).
  const days: Record<string, { n: number; errors: number }> = {};
  for (let i = 6; i >= 0; i--) days[dayKey(new Date(nowMs - i * 24 * 3600_000), DEFAULT_TZ)] = { n: 0, errors: 0 };
  for (const r of (activity ?? []) as { bucket: string; n: number; errors: number }[]) {
    const k = dayKey(r.bucket, DEFAULT_TZ); if (days[k]) { days[k].n += Number(r.n); days[k].errors += Number(r.errors); }
  }
  return <BotPage bot={bot as Bot} client={client as Client} keys={(keys ?? []) as BotKey[]} runs={(runs ?? []) as BotRun[]} activity={Object.entries(days).map(([day, v]) => ({ day, ...v }))} isAdmin={viewer.isAdmin} serverNow={nowMs} />;
}
