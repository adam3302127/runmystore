import { supabaseServer } from "@/lib/supabase/server";
import { FleetPage } from "@/components/FleetPage";
import type { Bot, Client } from "@/lib/types";
import { clock } from "@/lib/format";

export default async function Home({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const nowMs = clock();
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }, { data: activity }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("bots").select("*").order("name"),
    supabase.rpc("bot_activity", { p_since: new Date(nowMs - 24 * 3600_000).toISOString(), p_bucket: "1 hour" }),
  ]);
  const scope = ((clients ?? []) as Client[]).find((c) => c.slug === client) ?? null;
  const visibleBots = ((bots ?? []) as Bot[]).filter((b) => !scope || b.client_id === scope.id);
  // 24 hourly buckets per bot, oldest first.
  const sparks: Record<string, number[]> = {};
  const start = Math.floor(nowMs / 3600_000) * 3600_000 - 23 * 3600_000;
  for (const row of (activity ?? []) as { bot_id: string; bucket: string; n: number }[]) {
    const idx = Math.floor((Date.parse(row.bucket) - start) / 3600_000);
    if (idx < 0 || idx > 23) continue;
    (sparks[row.bot_id] ??= new Array(24).fill(0))[idx] = Number(row.n);
  }
  return <FleetPage clients={(clients ?? []) as Client[]} bots={visibleBots} sparks={sparks} scope={scope} serverNow={nowMs} />;
}
