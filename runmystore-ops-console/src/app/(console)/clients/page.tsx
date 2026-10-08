import type { Metadata } from "next";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Eyebrow, Empty } from "@/components/Stripes";
import { fleetSummary } from "@/lib/health";
import type { Bot, Client, ClientStats } from "@/lib/types";
import { PLAN_LABEL } from "@/lib/types";
import { clock } from "@/lib/format";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const supabase = await supabaseServer();
  const nowMs = clock();
  const since = new Date(nowMs - 7 * 24 * 3600_000).toISOString();
  const [{ data: clients }, { data: bots }, { data: stats }] = await Promise.all([
    supabase.from("clients").select("*").order("name"), supabase.from("bots").select("*"),
    supabase.rpc("client_stats_range", { p_from: since, p_to: new Date(nowMs + 60_000).toISOString() }),
  ]);
  const byClient = new Map(((stats ?? []) as ClientStats[]).map((s) => [s.client_id, s]));
  const list = (clients ?? []) as Client[];
  return (
    <div className="grid gap-5">
      <div className="grid gap-1"><Eyebrow>Clients</Eyebrow><h1 className="display text-4xl">Every store we run.</h1></div>
      {list.length === 0 && <Empty title="No clients yet">Add one under Settings.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const cb = ((bots ?? []) as Bot[]).filter((b) => b.client_id === c.id); const f = fleetSummary(cb); const s = byClient.get(c.id);
          return (
            <Link key={c.id} href={`/clients/${c.slug}`} className="card grid gap-3 p-4 no-underline" style={c.accent_color ? { borderTop: `4px solid ${c.accent_color}` } : undefined}>
              <div className="flex items-start gap-3">
                <span className="grid min-w-0 flex-1"><span className="title text-lg truncate">{c.name}</span><span className="lane-chip">{c.plan ? PLAN_LABEL[c.plan] ?? c.plan : "no plan"} · {c.status}{c.is_demo ? " · demo" : ""}</span></span>
                {cb.reduce((a, b) => a + b.open_decisions, 0) > 0 && <span className="tag you">{cb.reduce((a, b) => a + b.open_decisions, 0)} needs you</span>}
              </div>
              <p className="text-sm text-dim">{cb.length} bots · {f.live} live{f.stale ? ` · ${f.stale} stale` : ""}{f.erroring ? ` · ${f.erroring} erroring` : ""}{f.paused ? ` · ${f.paused} paused` : ""}</p>
              <dl className="grid grid-cols-4 gap-2 text-center">
                {[["Answered", s?.answered], ["Back", s?.brought_back], ["Leads", s?.leads_delivered], ["Orders", s?.orders]].map(([l, v]) => (
                  <div key={String(l)}><dt className="label text-dim" style={{ fontSize: "0.62rem" }}>{l}</dt><dd className="counter num text-2xl">{Number(v ?? 0)}</dd></div>
                ))}
              </dl>
              <p className="text-xs text-dim">last 7 days</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
