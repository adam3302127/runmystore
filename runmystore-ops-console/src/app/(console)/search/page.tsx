import type { Metadata } from "next";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Timeline } from "@/components/Timeline";
import { Eyebrow } from "@/components/Stripes";
import { cleanFilters, fetchPage } from "@/lib/event-query";
import { DEFAULT_TZ } from "@/lib/env";
import { addDays, dayStart } from "@/lib/format";
import type { Bot, Client } from "@/lib/types";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const filters = cleanFilters(raw);
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("*").order("name"), supabase.from("bots").select("*").order("name"),
  ]);
  const term = (filters.q ?? "").toLowerCase();
  const botHits = term ? ((bots ?? []) as Bot[]).filter((b) => b.name.toLowerCase().includes(term) || b.slug.includes(term)).slice(0, 6) : [];
  const clientHits = term ? ((clients ?? []) as Client[]).filter((c) => c.name.toLowerCase().includes(term) || c.slug.includes(term)).slice(0, 4) : [];
  const clientId = ((clients ?? []) as Client[]).find((c) => c.slug === filters.client)?.id;
  const initial = filters.q ? await fetchPage(supabase, filters, { clientId, bots: (bots ?? []) as Bot[],
    fromIso: filters.from ? dayStart(filters.from, DEFAULT_TZ) : undefined, toIso: filters.to ? dayStart(addDays(filters.to, 1), DEFAULT_TZ) : undefined }, null) : [];
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <Eyebrow>Search</Eyebrow>
        <h1 className="display text-4xl">Find anything a bot did.</h1>
        <p className="text-sm text-dim">Full-text over summaries, details, names and handles. Use quotes for a phrase, a minus to exclude. <kbd>⌘K</kbd> works from anywhere.</p>
      </div>
      {(botHits.length > 0 || clientHits.length > 0) && (
        <div className="flex flex-wrap gap-2" aria-label="Jump to">
          {clientHits.map((c) => <Link key={c.id} href={`/clients/${c.slug}`} className="pill sm">Client · {c.name}</Link>)}
          {botHits.map((b) => <Link key={b.id} href={`/bots/${b.id}`} className="pill sm">Bot · {b.name}</Link>)}
        </div>
      )}
      {filters.q ? <Timeline filters={filters} bots={(bots ?? []) as Bot[]} clients={(clients ?? []) as Client[]} initial={initial} title={`Results for “${filters.q}”`} />
        : <SearchOnly bots={(bots ?? []) as Bot[]} clients={(clients ?? []) as Client[]} filters={filters} />}
    </div>
  );
}

import { FilterBar } from "@/components/FilterBar";
function SearchOnly({ bots, clients, filters }: { bots: Bot[]; clients: Client[]; filters: ReturnType<typeof cleanFilters> }) {
  return <FilterBar filters={filters} bots={bots} clients={clients} />;
}
