"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Bot, BotKey, BotRun, Client, Event } from "@/lib/types";
import { LANE_LABEL, TYPE_LABEL } from "@/lib/types";
import { botHealth, HEALTH_LABEL } from "@/lib/health";
import { ago, fmtInterval, plural } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLiveEvents } from "@/lib/use-live-events";
import { useClock } from "@/components/BotCard";
import { FeedRow } from "@/components/FeedRow";
import { Time } from "@/components/TimeZone";
import { Eyebrow, Empty } from "@/components/Stripes";
import { CopyButton } from "@/components/CopyButton";
import { createBotKey, revokeBotKey } from "@/app/actions";
import { curlSnippet, envBlock, LOGGING_INSTRUCTION } from "@/lib/bot-snippet";
import { useScopedHref } from "@/components/ClientScope";

export function BotPage({ bot: initial, client, keys: initialKeys, runs: initialRuns, activity, isAdmin }: {
  bot: Bot; client: Client; keys: BotKey[]; runs: BotRun[]; activity: { day: string; n: number; errors: number }[]; isAdmin: boolean;
}) {
  const [bot, setBot] = useState(initial);
  const now = useClock();
  const scoped = useScopedHref();
  const params = useSearchParams();
  const onBotUpdate = useCallback((b: Bot) => { if (b.id === bot.id) setBot((p) => ({ ...p, ...b })); }, [bot.id]);
  const live = useLiveEvents({ botId: bot.id, bots: [bot], onBotUpdate, limit: 20 });
  const health = botHealth(bot, now);
  const [runs, setRuns] = useState(initialRuns);
  const [runsDone, setRunsDone] = useState(initialRuns.length < 30);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(params.get("run") ? [params.get("run")!] : []));
  const [runEvents, setRunEvents] = useState<Record<string, Event[]>>({});
  const [loadingRuns, setLoadingRuns] = useState(false);
  const maxN = Math.max(1, ...activity.map((a) => a.n));

  const toggle = useCallback(async (runId: string) => {
    setExpanded((s) => { const n = new Set(s); if (n.has(runId)) n.delete(runId); else n.add(runId); return n; });
    if (!runEvents[runId]) {
      const { data } = await supabaseBrowser().from("events").select("*").eq("bot_id", bot.id).eq("run_id", runId).order("occurred_at").limit(500);
      setRunEvents((m) => ({ ...m, [runId]: (data ?? []) as Event[] }));
    }
  }, [bot.id, runEvents]);
  const initialRun = params.get("run");
  useEffect(() => {
    if (!initialRun) return;
    let cancelled = false;
    supabaseBrowser().from("events").select("*").eq("bot_id", bot.id).eq("run_id", initialRun).order("occurred_at").limit(500)
      .then(({ data }: { data: unknown }) => { if (!cancelled) setRunEvents((m) => (m[initialRun] ? m : { ...m, [initialRun]: (data ?? []) as Event[] })); });
    return () => { cancelled = true; };
  }, [bot.id, initialRun]);

  const moreRuns = async () => {
    if (loadingRuns || runsDone) return;
    setLoadingRuns(true);
    const last = runs[runs.length - 1];
    const { data } = await supabaseBrowser().rpc("bot_runs", { p_bot_id: bot.id, p_before: last?.started_at ?? null, p_limit: 30 });
    const rows = (data ?? []) as BotRun[];
    setRuns((r) => [...r, ...rows.filter((x) => !r.some((y) => y.run_id === x.run_id))]);
    if (rows.length < 30) setRunsDone(true);
    setLoadingRuns(false);
  };
  // Fresh live events that belong to an expanded run get appended to it.
  const liveByRun = useMemo(() => { const m: Record<string, Event[]> = {}; for (const e of live.events) if (e.run_id) (m[e.run_id] ??= []).push(e); return m; }, [live.events]);

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <Eyebrow><Link href={scoped(`/clients/${client.slug}`)} className="no-underline hover:underline">{client.name}</Link></Eyebrow>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="display text-4xl sm:text-5xl flex items-center gap-3"><span className={`dot ${health}`} style={{ width: 14, height: 14 }} aria-hidden="true" />{bot.name}</h1>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="pill sm" aria-label="Health">{HEALTH_LABEL[health]}</span>
            <span className="pill sm">{LANE_LABEL[bot.lane]}</span>
            <span className="pill sm">every {fmtInterval(bot.expected_interval_minutes)}</span>
            <span className="pill sm">seen {ago(bot.last_seen_at, now)}</span>
            {bot.open_decisions > 0 && <Link href={scoped(`/decisions?bot=${bot.id}`)} className="tag you self-center">{bot.open_decisions} needs you</Link>}
          </div>
        </div>
        {bot.description && <p className="max-w-3xl text-dim">{bot.description}</p>}
        {!bot.enabled && <p className="text-sm text-dim">This bot is paused: its key is refused at the door until an admin enables it again.</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-6">
          <section className="card p-4 grid gap-3" aria-label="Seven-day activity">
            <div className="flex items-baseline justify-between"><h2 className="title">Last 7 days</h2><span className="text-xs text-dim">{activity.reduce((a, b) => a + b.n, 0)} events · {activity.reduce((a, b) => a + b.errors, 0)} errors</span></div>
            <svg viewBox="0 0 700 120" className="w-full" role="img" aria-label="Events per day for the last seven days">
              {activity.map((a, i) => {
                const h = Math.max(2, (a.n / maxN) * 90); const x = i * 100 + 10;
                return (
                  <g key={a.day}>
                    <rect x={x} y={100 - h} width={80} height={h} fill="#0d7377" rx="4" />
                    {a.errors > 0 && <rect x={x} y={100 - Math.max(2, (a.errors / maxN) * 90)} width={80} height={Math.max(2, (a.errors / maxN) * 90)} fill="#c2410c" rx="4" />}
                    <text x={x + 40} y={114} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,.6)">{a.day.slice(5)}</text>
                    <text x={x + 40} y={96 - h} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{a.n}</text>
                  </g>
                );
              })}
            </svg>
          </section>

          <section className="grid gap-3" aria-label="Runs">
            <div className="flex items-baseline justify-between"><h2 className="title">Runs</h2><span className="text-xs text-dim">newest first · click a run to open it</span></div>
            {runs.length === 0 && <Empty title="No runs yet">Runs appear once this bot posts a run_started event. Paste the logging instruction below into its prompt.</Empty>}
            <ol className="grid gap-2" role="list">
              {runs.map((r) => {
                const open = expanded.has(r.run_id);
                const evs = [...(runEvents[r.run_id] ?? []), ...(liveByRun[r.run_id] ?? []).filter((e) => !(runEvents[r.run_id] ?? []).some((x) => x.id === e.id))];
                const mins = Math.max(0, Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60_000));
                return (
                  <li key={r.run_id} className="card">
                    <button type="button" className="grid w-full gap-1 p-3 text-left sm:grid-cols-[1fr_auto] sm:items-center" aria-expanded={open} onClick={() => toggle(r.run_id)}>
                      <span className="grid min-w-0">
                        <span className="truncate font-semibold text-sm">{r.run_id}</span>
                        <span className="text-xs text-dim"><Time iso={r.started_at} mode="datetime" /> · {mins < 1 ? "under a minute" : `${mins} min`}{r.finished ? "" : " · no run_finished"}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5 text-xs">
                        <span className="tag muted">{plural(Number(r.events), "event")}</span>
                        {Number(r.messages) > 0 && <span className="tag muted">{plural(Number(r.messages), "message")}</span>}
                        {Number(r.crm_writes) > 0 && <span className="tag crm">CRM ×{r.crm_writes}</span>}
                        {Number(r.decisions) > 0 && <span className="tag you">needs you ×{r.decisions}</span>}
                        {Number(r.errors) > 0 && <span className="tag error">{plural(Number(r.errors), "error")}</span>}
                      </span>
                    </button>
                    {open && (
                      <ol className="grid gap-1.5 border-t border-ink-3 p-3" role="list">
                        {evs.length === 0 && <li className="text-xs text-dim">Loading…</li>}
                        {evs.map((e) => <FeedRow key={e.id} event={e} bot={bot} onOpen={(ev) => { const sp = new URLSearchParams(window.location.search); sp.set("event", ev.id); window.history.replaceState(null, "", `?${sp}`); window.dispatchEvent(new PopStateEvent("popstate")); }}
                          showTime={<span className="ml-2 text-xs text-dim"><Time iso={e.occurred_at} /> · {TYPE_LABEL[e.type]}</span>} />)}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ol>
            {!runsDone && <button type="button" className="pill justify-self-center" onClick={moreRuns} disabled={loadingRuns}>{loadingRuns ? "Loading…" : "Older runs"}</button>}
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className="panel p-4 grid gap-3" aria-label="Latest activity">
            <div className="flex items-center gap-2"><span className={`dot ${live.connection === "live" ? "live" : live.connection}`} aria-hidden="true" /><h2 className="title text-[0.95rem]">Right now</h2><span className="label ml-auto text-dim">{live.connection}</span></div>
            <ol className="grid gap-2" role="list" aria-live="polite">
              {live.events.slice(0, 12).map((e) => <FeedRow key={e.id} event={e} bot={bot} fresh={(e as Event & { fresh?: boolean }).fresh} />)}
            </ol>
            {!live.loading && live.events.length === 0 && <p className="text-sm text-dim">No events yet. Paste the logging instruction into this bot and run it.</p>}
          </section>
          {isAdmin && <KeysPanel bot={bot} keys={initialKeys} />}
          <section className="card p-4 grid gap-3" aria-label="Logging instruction">
            <h2 className="title">Paste into the bot</h2>
            <p className="text-xs text-dim">Set the three env vars on the bot, then add this paragraph to its prompt.</p>
            <pre>{envBlock(`rmsb_${initialKeys.find((k) => !k.revoked_at)?.prefix ?? "xxxxxxxx"}_… (shown once when a key is created)`)}</pre>
            <p className="text-sm leading-relaxed"><strong>Activity logging (required).</strong> {LOGGING_INSTRUCTION.replace(/^Activity logging \(required\)\. /, "")}</p>
            <div className="flex gap-2"><CopyButton text={LOGGING_INSTRUCTION} label="Copy instruction" /><CopyButton text={curlSnippet("$RMS_BOT_KEY")} label="Copy curl" /></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function KeysPanel({ bot, keys: initial }: { bot: Bot; keys: BotKey[] }) {
  const [keys, setKeys] = useState(initial);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const refresh = async () => { const { data } = await supabaseBrowser().from("bot_keys").select("id,bot_id,prefix,label,created_at,last_used_at,revoked_at").eq("bot_id", bot.id).order("created_at", { ascending: false }); setKeys((data ?? []) as BotKey[]); };
  return (
    <section className="card p-4 grid gap-3" aria-label="API keys" data-testid="keys-panel">
      <div className="flex items-baseline justify-between"><h2 className="title">Keys</h2><span className="text-xs text-dim">only hashes are stored</span></div>
      {keys.length === 0 && <p className="text-sm text-dim">No keys yet. Create one and paste it into the bot once.</p>}
      <ul role="list" className="grid gap-2">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-2 text-sm">
            <code className="rounded bg-ink px-2 py-0.5">rmsb_{k.prefix}_…</code>
            <span className="text-dim text-xs">{k.label ?? "no label"} · created <Time iso={k.created_at} mode="date" />{k.last_used_at ? <> · used {ago(k.last_used_at)}</> : " · never used"}</span>
            {k.revoked_at ? <span className="tag skip">revoked</span> : (
              <button type="button" className="pill sm ml-auto" disabled={pending} onClick={() => { if (!confirm(`Revoke key rmsb_${k.prefix}_…? The bot gets 401 immediately.`)) return; start(async () => { const r = await revokeBotKey(k.id, bot.id); if (!r.ok) setErr(r.error); else refresh(); }); }}>Revoke</button>
            )}
          </li>
        ))}
      </ul>
      {fresh && (
        <div className="panel quiet p-3 grid gap-2" role="status" data-testid="new-key">
          <p className="label text-dim">New key · shown once, copy it now</p>
          <pre className="select-all">{envBlock(fresh)}</pre>
          <div className="flex gap-2"><CopyButton text={fresh} label="Copy key" /><CopyButton text={envBlock(fresh)} label="Copy env block" /><button type="button" className="pill sm" onClick={() => setFresh(null)}>Done</button></div>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createBotKey(bot.id, label.trim() || null); if (!r.ok) setErr(r.error); else { setFresh(r.data ?? null); setLabel(""); setErr(null); refresh(); } }); }}>
        <input className="input" placeholder="Label (e.g. prod, laptop test)" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Key label" />
        <button type="submit" className="btn sm" disabled={pending}>Create key</button>
      </form>
      {err && <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{err}</p>}
    </section>
  );
}
