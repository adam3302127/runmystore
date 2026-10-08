import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { Inbox } from "@/components/Inbox";
import { Eyebrow } from "@/components/Stripes";
import type { Bot, Client, Event } from "@/lib/types";
import { clock } from "@/lib/format";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("*").order("name"), supabase.from("bots").select("*").order("name"),
  ]);
  const scope = ((clients ?? []) as Client[]).find((c) => c.slug === client) ?? null;
  let q = supabase.from("events").select("*").in("type", ["message_sent", "message_received"]).order("occurred_at", { ascending: false }).limit(400);
  if (scope) q = q.eq("client_id", scope.id);
  const { data: messages } = await q;
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <Eyebrow>Inbox</Eyebrow>
        <h1 className="display text-4xl">Every conversation, one place.</h1>
        <p className="text-sm text-dim">Email, WhatsApp, SMS and chat, grouped by thread. Contacts stay in Close; open them there.</p>
      </div>
      <Inbox initial={(messages ?? []) as Event[]} bots={(bots ?? []) as Bot[]} clients={(clients ?? []) as Client[]} scope={scope} serverNow={clock()} />
    </div>
  );
}
