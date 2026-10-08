import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { Timeline } from "@/components/Timeline";
import { Eyebrow } from "@/components/Stripes";
import { cleanFilters, fetchPage } from "@/lib/event-query";
import { DEFAULT_TZ } from "@/lib/env";
import { addDays, dayStart } from "@/lib/format";
import type { Bot, Client } from "@/lib/types";

export const metadata: Metadata = { title: "Timeline" };

export default async function FeedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const filters = cleanFilters(raw);
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("bots").select("*").order("name"),
  ]);
  const clientId = ((clients ?? []) as Client[]).find((c) => c.slug === filters.client)?.id;
  const initial = await fetchPage(supabase, filters, {
    clientId, bots: (bots ?? []) as Bot[],
    fromIso: filters.from ? dayStart(filters.from, DEFAULT_TZ) : undefined,
    toIso: filters.to ? dayStart(addDays(filters.to, 1), DEFAULT_TZ) : undefined,
  }, null);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <Eyebrow>Ledger</Eyebrow>
        <h1 className="display text-4xl">Everything, in order.</h1>
        <p className="text-sm text-dim">Live on top, months of history below. Filters live in the URL, so a link is a saved view.</p>
      </div>
      <Timeline filters={filters} bots={(bots ?? []) as Bot[]} clients={(clients ?? []) as Client[]} initial={initial} />
    </div>
  );
}
