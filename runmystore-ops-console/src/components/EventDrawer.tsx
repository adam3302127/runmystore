"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Bot, Client, Event, EventNote } from "@/lib/types";
import { CHANNEL_LABEL, LANE_LABEL, TYPE_LABEL } from "@/lib/types";
import { closeLeadUrl, eventTag, tagClass } from "@/lib/feed-mapping";
import { money } from "@/lib/format";
import { Time } from "@/components/TimeZone";
import { JsonView } from "@/components/JsonView";
import { addNote, setEventStatus } from "@/app/actions";
import { useScopedHref } from "@/components/ClientScope";

/** Opens when ?event=<id> is in the URL, from any console screen. */
export function EventDrawerHost({ canAct }: { canAct: boolean }) {
  const params = useSearchParams();
  const id = params.get("event");
  const router = useRouter();
  const pathname = usePathname();
  const close = () => { const sp = new URLSearchParams(params.toString()); sp.delete("event"); router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false }); };
  if (!id) return null;
  return <EventDrawer id={id} onClose={close} canAct={canAct} />;
}

export function EventDrawer({ id, onClose, canAct }: { id: string; onClose: () => void; canAct: boolean }) {
  const [ev, setEv] = useState<Event | null>(null);
  const [bot, setBot] = useState<Bot | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState<EventNote[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scoped = useScopedHref();

  useEffect(() => {
    let cancelled = false;
    const sb = supabaseBrowser();
    (async () => {
      const { data: e } = await sb.from("events").select("*").eq("id", id).maybeSingle();
      if (cancelled || !e) { if (!cancelled) setErr("That event isn't visible to you, or it doesn't exist."); return; }
      setEv(e as Event);
      const [{ data: b }, { data: c }, { data: n }] = await Promise.all([
        sb.from("bots").select("*").eq("id", e.bot_id).maybeSingle(),
        sb.from("clients").select("*").eq("id", e.client_id).maybeSingle(),
        sb.from("event_notes").select("*").eq("event_id", id).order("created_at"),
      ]);
      if (cancelled) return;
      setBot(b as Bot | null); setClient(c as Client | null); setNotes((n ?? []) as EventNote[]);
    })();
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tag = ev ? eventTag(ev) : null;
  const close = closeLeadUrl(ev?.close_lead_id);
  const { decision: _d, ...payloadRest } = (ev?.payload ?? {}) as Record<string, unknown>;
  void _d;
  return (
    <>
      <div className="scrim" onClick={onClose} role="presentation" />
      <aside className="drawer drawer-enter p-5 sm:p-6 grid content-start gap-5" role="dialog" aria-modal="true" aria-label="Event details" data-testid="event-drawer">
        <div className="flex items-start gap-3">
          <div className="grid gap-1 min-w-0 flex-1">
            <p className="label text-dim">{ev ? TYPE_LABEL[ev.type] : "Event"}{ev?.channel ? ` · ${CHANNEL_LABEL[ev.channel]}` : ""}{ev?.direction && ev.direction !== "none" ? ` · ${ev.direction}` : ""}</p>
            <h2 className="title text-lg leading-snug">{ev?.summary ?? (err ?? "Loading…")}</h2>
          </div>
          <button type="button" className="pill sm" onClick={onClose} aria-label="Close">Esc</button>
        </div>
        {ev && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-dim">
              {tag && <span className={tagClass(tag)}>{tag.label}</span>}
              <span className="tag muted">{ev.status}</span>
              {ev.severity > 0 && <span className="tag muted">severity {ev.severity}</span>}
              <Time iso={ev.occurred_at} mode="datetime" />
              {ev.amount_cents != null && <span className="font-semibold text-white">{money(ev.amount_cents)}</span>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-dim">Bot</dt><dd>{bot ? <Link href={scoped(`/bots/${bot.id}`)} className="font-semibold">{bot.name}</Link> : "…"}{bot ? <span className="text-dim"> · {LANE_LABEL[bot.lane]}</span> : null}</dd>
              <dt className="text-dim">Client</dt><dd>{client ? <Link href={scoped(`/clients/${client.slug}`)} className="font-semibold">{client.name}</Link> : "…"}</dd>
              {ev.run_id && <><dt className="text-dim">Run</dt><dd className="truncate"><Link href={scoped(`/bots/${ev.bot_id}?run=${encodeURIComponent(ev.run_id)}`)}>{ev.run_id}</Link></dd></>}
              {ev.counterparty_name && <><dt className="text-dim">With</dt><dd>{ev.counterparty_name}{ev.counterparty_handle ? <span className="text-dim"> · {ev.counterparty_handle}</span> : null}</dd></>}
              {ev.thread_ref && <><dt className="text-dim">Thread</dt><dd className="truncate"><Link href={scoped(`/inbox?thread=${encodeURIComponent(ev.thread_ref)}`)}>{ev.thread_ref}</Link></dd></>}
              {ev.idempotency_key && <><dt className="text-dim">Key</dt><dd className="truncate text-dim">{ev.idempotency_key}</dd></>}
            </dl>
            {ev.detail && <section className="grid gap-1.5"><h3 className="label text-dim">Detail</h3><p className="whitespace-pre-wrap text-sm">{ev.detail}</p></section>}
            {(ev.type === "message_sent" || ev.type === "message_received") && !ev.detail && client && !client.store_message_bodies && (
              <p className="text-xs text-dim">Message bodies are off for {client.name}: summaries and links only. The thread stays in the account that owns it.</p>
            )}
            {(ev.links.length > 0 || close) && (
              <section className="grid gap-2">
                <h3 className="label text-dim">Links</h3>
                <div className="flex flex-wrap gap-2">
                  {close && <a className="btn sm" href={close} target="_blank" rel="noreferrer">Open in Close <span className="arrow" aria-hidden="true">→</span></a>}
                  {ev.links.map((l) => <a key={l.url} className="pill sm" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
                </div>
              </section>
            )}
            {Object.keys(payloadRest).length > 0 && <section className="grid gap-1.5"><h3 className="label text-dim">Payload</h3><JsonView value={payloadRest} /></section>}
            {ev.payload?.decision ? <section className="grid gap-1.5"><h3 className="label text-dim">Decision asked</h3><JsonView value={ev.payload.decision} /></section> : null}
            <section className="grid gap-2">
              <h3 className="label text-dim">Notes</h3>
              {notes.length === 0 && <p className="text-sm text-dim">No notes yet.</p>}
              <ul role="list" className="grid gap-2">
                {notes.map((n) => <li key={n.id} className="card p-3 text-sm"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-xs text-dim"><Time iso={n.created_at} mode="datetime" /></p></li>)}
              </ul>
              {canAct && (
                <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); const body = note; start(async () => {
                  const r = await addNote(ev.id, body);
                  if (!r.ok) { setErr(r.error); return; }
                  setNote(""); setErr(null);
                  const { data } = await supabaseBrowser().from("event_notes").select("*").eq("event_id", ev.id).order("created_at");
                  setNotes((data ?? []) as EventNote[]);
                }); }}>
                  <textarea className="textarea" rows={2} placeholder="Add a note for the team" value={note} onChange={(e) => setNote(e.target.value)} aria-label="New note" />
                  <div className="flex items-center gap-2">
                    <button type="submit" className="btn sm" disabled={pending || !note.trim()}>Add note</button>
                    {ev.status !== "resolved" && (
                      <button type="button" className="btn ghost sm" disabled={pending} onClick={() => start(async () => {
                        const r = await setEventStatus(ev.id, "resolved");
                        if (!r.ok) setErr(r.error); else setEv({ ...ev, status: "resolved" });
                      })}>Mark resolved</button>
                    )}
                  </div>
                </form>
              )}
              {err && <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{err}</p>}
            </section>
          </>
        )}
      </aside>
    </>
  );
}
