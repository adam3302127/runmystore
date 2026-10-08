import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { requireViewer } from "@/lib/viewer";
import { DecisionsQueue } from "@/components/DecisionsQueue";
import { Eyebrow } from "@/components/Stripes";
import type { Bot, Client, Decision, Event } from "@/lib/types";

export const metadata: Metadata = { title: "Needs you" };

export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ client?: string; bot?: string }> }) {
  const { client, bot } = await searchParams;
  const viewer = await requireViewer();
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("*").order("name"), supabase.from("bots").select("*").order("name"),
  ]);
  const scope = ((clients ?? []) as Client[]).find((c) => c.slug === client) ?? null;
  let openQ = supabase.from("decisions").select("*").eq("state", "open").order("priority", { ascending: false }).order("due_at", { ascending: true, nullsFirst: false }).order("created_at").limit(200);
  let doneQ = supabase.from("decisions").select("*").neq("state", "open").order("answered_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(60);
  if (scope) { openQ = openQ.eq("client_id", scope.id); doneQ = doneQ.eq("client_id", scope.id); }
  if (bot) { openQ = openQ.eq("bot_id", bot); doneQ = doneQ.eq("bot_id", bot); }
  const [{ data: open }, { data: done }] = await Promise.all([openQ, doneQ]);
  const ids = [...(open ?? []), ...(done ?? [])].map((d) => d.event_id);
  const { data: events } = ids.length ? await supabase.from("events").select("*").in("id", ids) : { data: [] };
  const byId = new Map(((events ?? []) as Event[]).map((e) => [e.id, e]));
  const wrap = (d: Decision) => ({ d, e: byId.get(d.event_id) ?? null });
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <Eyebrow>Needs you</Eyebrow>
        <h1 className="display text-4xl">Your calls, in order.</h1>
        <p className="text-sm text-dim">Highest priority first, then the soonest due. The bot picks up your answer on its next run.</p>
      </div>
      <DecisionsQueue open={((open ?? []) as Decision[]).map(wrap)} answered={((done ?? []) as Decision[]).map(wrap)} bots={(bots ?? []) as Bot[]} clients={(clients ?? []) as Client[]} scope={scope} canAct={viewer.canAct} filterBot={bot} />
    </div>
  );
}
