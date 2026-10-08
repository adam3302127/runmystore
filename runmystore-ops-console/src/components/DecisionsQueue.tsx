"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Bot, Client, Decision, Event } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLiveEvents } from "@/lib/use-live-events";
import { answerDecision } from "@/app/actions";
import { Time } from "@/components/TimeZone";
import { Empty } from "@/components/Stripes";
import { closeLeadUrl } from "@/lib/feed-mapping";
import { ago, money } from "@/lib/format";
import { useScopedHref } from "@/components/ClientScope";
import { reducedMotion } from "@/components/FeedRow";
import { useClock } from "@/components/BotCard";

type Item = { d: Decision; e: Event | null };
const PRIORITY = ["Low", "Normal", "High", "Urgent"];

function sortItems(a: Item, b: Item) {
  if (b.d.priority !== a.d.priority) return b.d.priority - a.d.priority;
  if (a.d.due_at !== b.d.due_at) { if (!a.d.due_at) return 1; if (!b.d.due_at) return -1; return a.d.due_at < b.d.due_at ? -1 : 1; }
  return a.d.created_at < b.d.created_at ? -1 : 1;
}

export function DecisionsQueue({ open: initialOpen, answered: initialAnswered, bots, clients, scope, canAct, filterBot, serverNow }: {
  open: Item[]; answered: Item[]; bots: Bot[]; clients: Client[]; scope: Client | null; canAct: boolean; filterBot?: string; serverNow: number;
}) {
  const [items, setItems] = useState<Item[]>(() => [...initialOpen].sort(sortItems));
  const [answered, setAnswered] = useState<Item[]>(initialAnswered);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const [cursor, setCursor] = useState(0);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const scoped = useScopedHref();
  const now = useClock(serverNow);
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const clientsById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const onDecision = useCallback(async (d: Decision, kind: "INSERT" | "UPDATE") => {
    if (filterBot && d.bot_id !== filterBot) return;
    if (kind === "INSERT" && d.state === "open") {
      const { data: e } = await supabaseBrowser().from("events").select("*").eq("id", d.event_id).maybeSingle();
      setItems((prev) => prev.some((x) => x.d.id === d.id) ? prev : [...prev, { d, e: (e as Event) ?? null }].sort(sortItems));
    } else if (kind === "UPDATE" && d.state !== "open") {
      setItems((prev) => { const hit = prev.find((x) => x.d.id === d.id); if (hit) setAnswered((a) => [{ d, e: hit.e }, ...a.filter((x) => x.d.id !== d.id)]); return prev.filter((x) => x.d.id !== d.id); });
    } else if (kind === "UPDATE") {
      setAnswered((a) => a.map((x) => (x.d.id === d.id ? { ...x, d } : x)));
    }
  }, [filterBot]);
  useLiveEvents({ clientId: scope?.id, bots, limit: 0, onDecision });

  const visible = items.filter((x) => !leaving.has(x.d.id));
  const current = visible[Math.min(cursor, Math.max(0, visible.length - 1))];

  const act = useCallback((item: Item, key: string | null, dismiss = false) => {
    if (!canAct || pending) return;
    const note = notes[item.d.id]?.trim() || null;
    start(async () => {
      const r = await answerDecision(item.d.id, key, note, dismiss);
      if (!r.ok) { setErr(r.error); return; }
      setErr(null);
      const finish = () => {
        setItems((prev) => prev.filter((x) => x.d.id !== item.d.id));
        setAnswered((a) => [{ d: { ...item.d, state: dismiss ? "dismissed" : "answered", answer_key: key, answer_note: note, answered_at: new Date().toISOString() }, e: item.e }, ...a]);
        setLeaving((s) => { const n = new Set(s); n.delete(item.d.id); return n; });
      };
      if (reducedMotion()) finish();
      else { setLeaving((s) => new Set(s).add(item.d.id)); setTimeout(finish, 350); }
    });
  }, [canAct, pending, notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      if (tab !== "open" || !current) return;
      if (e.key === "j") setCursor((c) => Math.min(visible.length - 1, c + 1));
      else if (e.key === "k") setCursor((c) => Math.max(0, c - 1));
      else if (/^[1-8]$/.test(e.key)) { const opt = current.d.options[Number(e.key) - 1]; if (opt) act(current, opt.key); }
      else if (e.key === "n") { e.preventDefault(); noteRefs.current[current.d.id]?.focus(); }
      else if (e.key === "d") act(current, null, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, current, visible.length, act]);

  return (
    <div className="grid gap-4" data-testid="decisions">
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        <button type="button" role="tab" className="pill" aria-selected={tab === "open"} onClick={() => setTab("open")}>Open <span className="num">· {visible.length}</span></button>
        <button type="button" role="tab" className="pill" aria-selected={tab === "answered"} onClick={() => setTab("answered")}>Answered</button>
        <p className="ml-auto hidden text-xs text-dim sm:block"><kbd>j</kbd> <kbd>k</kbd> move · <kbd>1</kbd>–<kbd>8</kbd> pick · <kbd>n</kbd> note · <kbd>d</kbd> dismiss</p>
      </div>
      {err && <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{err}</p>}
      {tab === "open" && (
        <ol className="grid gap-3" role="list" aria-live="polite">
          {visible.length === 0 && <Empty title="Nothing needs you">When a bot hits a limit or an unclear policy, it asks here and tells the customer a person will follow up.</Empty>}
          {items.map((it, i) => {
            const bot = botsById.get(it.d.bot_id); const client = clientsById.get(it.d.client_id);
            const isCur = current?.d.id === it.d.id; const close = closeLeadUrl(it.e?.close_lead_id);
            const overdue = it.d.due_at && Date.parse(it.d.due_at) < now;
            return (
              <li key={it.d.id} className={`panel ${isCur ? "" : "quiet"} grid gap-3 p-4 ${leaving.has(it.d.id) ? "fade-out" : ""}`} data-testid="decision-card" aria-current={isCur ? "true" : undefined} onClick={() => setCursor(visible.findIndex((v) => v.d.id === it.d.id))} tabIndex={-1}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
                  <span className={`tag ${it.d.priority >= 2 ? "you" : "muted"}`}>{PRIORITY[it.d.priority]}</span>
                  <span className="font-semibold text-white">{bot?.name ?? "Bot"}</span>
                  {!scope && <span>· {client?.name}</span>}
                  <span>· asked {ago(it.d.created_at, now)}</span>
                  {it.d.due_at && <span className={overdue ? "font-semibold" : ""} style={overdue ? { color: "#f5a37a" } : undefined}>· due <Time iso={it.d.due_at} mode="datetime" /></span>}
                  {it.e?.amount_cents != null && <span className="font-semibold text-white">· {money(it.e.amount_cents)}</span>}
                  <span className="ml-auto num">#{i + 1}</span>
                </div>
                <h2 className="title text-lg leading-snug">{it.d.question}</h2>
                {it.d.context && <p className="whitespace-pre-wrap text-sm text-dim">{it.d.context}</p>}
                {it.e && (
                  <p className="text-sm text-dim">
                    Source: <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); const sp = new URLSearchParams(window.location.search); sp.set("event", it.e!.id); window.history.replaceState(null, "", `?${sp}`); window.dispatchEvent(new PopStateEvent("popstate")); }}>{it.e.summary}</button>
                    {it.e.counterparty_name && <> · {it.e.counterparty_name}</>}
                    {close && <> · <a href={close} target="_blank" rel="noreferrer" className="underline">Open in Close ↗</a></>}
                    {it.e.thread_ref && <> · <Link href={scoped(`/inbox?thread=${encodeURIComponent(it.e.thread_ref)}`)} className="underline">thread</Link></>}
                  </p>
                )}
                {canAct ? (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      {it.d.options.map((o, idx) => (
                        <button key={o.key} type="button" className={`btn sm ${idx > 0 ? "ghost" : ""}`} disabled={pending} onClick={(e) => { e.stopPropagation(); act(it, o.key); }} data-testid={`answer-${o.key}`}>
                          <kbd className="mr-1">{idx + 1}</kbd>{o.label}
                        </button>
                      ))}
                      {it.d.options.length === 0 && <button type="button" className="btn sm" disabled={pending} onClick={() => act(it, "ack")}>Acknowledge</button>}
                      <button type="button" className="pill sm" disabled={pending} onClick={(e) => { e.stopPropagation(); act(it, null, true); }}><kbd className="mr-1">d</kbd>Dismiss</button>
                    </div>
                    <textarea ref={(el) => { noteRefs.current[it.d.id] = el; }} className="textarea" rows={1} placeholder="Optional note for the bot (n)" value={notes[it.d.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [it.d.id]: e.target.value }))} aria-label="Note" onClick={(e) => e.stopPropagation()} />
                  </div>
                ) : <p className="text-xs text-dim">Viewers can read decisions; operators and admins answer them.</p>}
              </li>
            );
          })}
        </ol>
      )}
      {tab === "answered" && (
        <ol className="grid gap-2" role="list">
          {answered.length === 0 && <Empty title="No answers yet" />}
          {answered.map((it) => (
            <li key={it.d.id} className="card grid gap-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
                <span className={`tag ${it.d.state === "dismissed" ? "skip" : it.d.state === "expired" ? "muted" : ""}`}>{it.d.state}{it.d.answer_key ? `: ${it.d.options.find((o) => o.key === it.d.answer_key)?.label ?? it.d.answer_key}` : ""}</span>
                <span className="font-semibold text-white">{botsById.get(it.d.bot_id)?.name}</span>
                {it.d.answered_at && <span>· answered <Time iso={it.d.answered_at} mode="datetime" /></span>}
                <span className="ml-auto">{it.d.delivered_to_bot_at ? <>delivered to bot <Time iso={it.d.delivered_to_bot_at} mode="datetime" /></> : it.d.state === "expired" ? "expired before an answer" : "waiting for the bot's next run"}</span>
              </div>
              <p className="font-semibold">{it.d.question}</p>
              {it.d.answer_note && <p className="text-dim">“{it.d.answer_note}”</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
