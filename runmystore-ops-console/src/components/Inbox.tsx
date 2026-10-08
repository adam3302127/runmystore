"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Bot, Client, Event } from "@/lib/types";
import { CHANNEL_LABEL } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLiveEvents } from "@/lib/use-live-events";
import { closeLeadUrl } from "@/lib/feed-mapping";
import { Time } from "@/components/TimeZone";
import { Empty } from "@/components/Stripes";
import { ago } from "@/lib/format";
import { useClock } from "@/components/BotCard";

type Thread = { key: string; who: string; handle: string | null; channel: string | null; last: Event; count: number; botName: string; clientName: string; closeId: string | null; hasDecision: boolean };
const threadKey = (e: Event) => e.thread_ref ?? e.counterparty_handle ?? e.id;

function ChannelIcon({ ch }: { ch: string | null }) {
  const glyph = ch === "whatsapp" ? "W" : ch === "sms" ? "S" : ch === "chat" ? "C" : ch === "phone" ? "P" : "@";
  return <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-ink-3 text-xs font-bold" aria-label={ch ? CHANNEL_LABEL[ch as keyof typeof CHANNEL_LABEL] : "message"} title={ch ?? ""}>{glyph}</span>;
}

export function Inbox({ initial, bots, clients, scope, serverNow }: { initial: Event[]; bots: Bot[]; clients: Client[]; scope: Client | null; serverNow: number }) {
  const now = useClock(serverNow);
  const params = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const selected = params.get("thread");
  const live = useLiveEvents({ clientId: scope?.id, bots, types: ["message_sent", "message_received"], limit: 0 });
  const [thread, setThread] = useState<Event[]>([]);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const all = useMemo(() => { const seen = new Set<string>(); return [...live.events, ...initial].filter((e) => !seen.has(e.id) && seen.add(e.id)); }, [live.events, initial]);
  const threads = useMemo(() => {
    const m = new Map<string, Thread>();
    for (const e of all) {
      const k = threadKey(e);
      const t = m.get(k);
      if (t) { t.count++; if (e.occurred_at > t.last.occurred_at) t.last = e; if (e.close_lead_id) t.closeId ??= e.close_lead_id; if (e.type === "decision_needed") t.hasDecision = true; continue; }
      m.set(k, { key: k, who: e.counterparty_name ?? e.counterparty_handle ?? "Unknown", handle: e.counterparty_handle, channel: e.channel, last: e, count: 1,
        botName: botsById.get(e.bot_id)?.name ?? "Bot", clientName: clientsById.get(e.client_id)?.name ?? "", closeId: e.close_lead_id, hasDecision: false });
    }
    return [...m.values()].sort((a, b) => (a.last.occurred_at < b.last.occurred_at ? 1 : -1));
  }, [all, botsById, clientsById]);
  const current = threads.find((t) => t.key === selected) ?? null;

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const sb = supabaseBrowser();
    const base = sb.from("events").select("*").in("type", ["message_sent", "message_received", "decision_needed"]).order("occurred_at").limit(300);
    const q = current.last.thread_ref ? base.eq("thread_ref", current.last.thread_ref) : base.eq("counterparty_handle", current.last.counterparty_handle ?? "").is("thread_ref", null);
    q.then(({ data }: { data: unknown }) => { if (!cancelled) setThread(((data ?? []) as Event[])); });
    return () => { cancelled = true; };
  }, [current?.key, current?.last.thread_ref, current?.last.counterparty_handle, all.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (key: string | null) => { const sp = new URLSearchParams(params.toString()); if (key) sp.set("thread", key); else sp.delete("thread"); router.replace(`${pathname}?${sp}`, { scroll: false }); };
  const close = closeLeadUrl(current?.closeId ?? thread.find((e) => e.close_lead_id)?.close_lead_id);

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]" data-testid="inbox">
      <section className={`card grid content-start ${current ? "hidden lg:grid" : ""}`} aria-label="Conversations" style={{ maxHeight: "calc(100vh - 200px)", overflow: "auto" }}>
        <div className="flex items-center justify-between border-b border-ink-3 p-3"><h2 className="title">Conversations</h2><span className="text-xs text-dim">{threads.length}{live.queued ? ` · +${live.queued}` : ""}</span></div>
        {threads.length === 0 && <Empty title="No conversations yet">Messages show here the moment a bot logs a message_sent or message_received.</Empty>}
        <ul role="list">
          {threads.map((t) => (
            <li key={t.key}>
              <button type="button" className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-ink-3 p-3 text-left hover:bg-white/5 ${t.key === selected ? "bg-white/10" : ""}`} onClick={() => select(t.key)} aria-current={t.key === selected ? "true" : undefined}>
                <ChannelIcon ch={t.channel} />
                <span className="grid min-w-0">
                  <span className="flex items-center gap-2 truncate"><span className="font-semibold">{t.who}</span>{t.hasDecision && <span className="tag you">needs you</span>}</span>
                  <span className="truncate text-sm text-dim">{t.last.direction === "outbound" ? "↗ " : "↙ "}{t.last.summary}</span>
                  <span className="truncate text-xs text-faint">{t.botName}{scope ? "" : ` · ${t.clientName}`} · {t.count} msg</span>
                </span>
                <span className="text-xs text-dim">{ago(t.last.occurred_at, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card grid content-start" aria-label="Thread" style={{ minHeight: 420 }}>
        {!current && <Empty title="Pick a conversation">Inbound on the left, the bot&apos;s replies on the right. Read-only: bots answer from the accounts your clients own.</Empty>}
        {current && (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-3 p-3">
              <button type="button" className="pill sm lg:hidden" onClick={() => select(null)}>← Back</button>
              <ChannelIcon ch={current.channel} />
              <div className="grid min-w-0 flex-1"><span className="font-semibold">{current.who}</span><span className="truncate text-xs text-dim">{current.handle ?? current.last.thread_ref} · {current.botName}</span></div>
              {close && <a className="btn sm" href={close} target="_blank" rel="noreferrer">Open in Close <span className="arrow" aria-hidden="true">→</span></a>}
            </div>
            <ol className="flex flex-col gap-2 p-3" role="list" aria-live="polite">
              {(thread.length && threadKey(thread[0]) === current.key ? thread : all.filter((e) => threadKey(e) === current.key).slice().reverse()).map((e) => (
                <li key={e.id} className={`msg ${e.direction === "outbound" ? "out" : "in"} grid gap-0.5`}>
                  {e.direction === "outbound" && <span className="label opacity-80">{botsById.get(e.bot_id)?.name ?? "Bot"}</span>}
                  {e.type === "decision_needed" && <span className="tag you justify-self-start">Needs you</span>}
                  <span>{e.detail ?? e.summary}</span>
                  <span className="text-[11px] opacity-70"><Time iso={e.occurred_at} mode="datetime" /> · <button type="button" className="underline" onClick={() => { const sp = new URLSearchParams(params.toString()); sp.set("event", e.id); router.replace(`${pathname}?${sp}`, { scroll: false }); }}>details</button></span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
