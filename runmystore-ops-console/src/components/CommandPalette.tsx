"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useClientScope, useScopedHref } from "@/components/ClientScope";
import { useBotsIndex } from "@/components/BotsIndex";
import type { Event } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/types";
import { Time } from "@/components/TimeZone";

type Hit = { kind: "bot" | "client" | "page" | "event"; title: string; sub: string; href: string; at?: string };
const PAGES: Hit[] = [
  { kind: "page", title: "Fleet overview", sub: "Every bot's health", href: "/" },
  { kind: "page", title: "Timeline", sub: "Full ledger with filters", href: "/feed" },
  { kind: "page", title: "Inbox", sub: "Messages by conversation", href: "/inbox" },
  { kind: "page", title: "Needs you", sub: "Open decisions", href: "/decisions" },
  { kind: "page", title: "Clients", sub: "Per-client KPIs", href: "/clients" },
  { kind: "page", title: "Search", sub: "Full-text search", href: "/search" },
];

export function CommandPalette({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  const router = useRouter();
  const scoped = useScopedHref();
  const { clients } = useClientScope();
  const bots = useBotsIndex();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ term: string; hits: Hit[] }>({ term: "", hits: [] });
  const [selRaw, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (open) onClose(); else onOpen(); }
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onOpen]);
  useEffect(() => { if (open) { const t = setTimeout(() => input.current?.focus(), 10); return () => clearTimeout(t); } }, [open]);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setQ(""); setSel(0); } }

  const term = q.trim().toLowerCase();
  const local = useMemo<Hit[]>(() => [
      ...bots.filter((b) => !term || b.name.toLowerCase().includes(term) || b.slug.includes(term)).slice(0, 5)
        .map((b) => ({ kind: "bot" as const, title: b.name, sub: clients.find((c) => c.id === b.client_id)?.name ?? "", href: `/bots/${b.id}` })),
      ...clients.filter((c) => !term || c.name.toLowerCase().includes(term) || c.slug.includes(term)).slice(0, 4)
        .map((c) => ({ kind: "client" as const, title: c.name, sub: "Client", href: `/clients/${c.slug}` })),
      ...PAGES.filter((p) => !term || p.title.toLowerCase().includes(term)),
  ], [term, bots, clients]);
  useEffect(() => {
    if (!open || term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().from("events").select("id,type,summary,occurred_at,bot_id")
        .textSearch("fts", term, { type: "websearch", config: "english" }).order("occurred_at", { ascending: false }).limit(6);
      if (cancelled) return;
      const ev = ((data ?? []) as Pick<Event, "id" | "type" | "summary" | "occurred_at" | "bot_id">[]).map((e) => ({
        kind: "event" as const, title: e.summary, sub: `${TYPE_LABEL[e.type]} · ${bots.find((b) => b.id === e.bot_id)?.name ?? "bot"}`, href: `/feed?event=${e.id}`, at: e.occurred_at,
      }));
      setRemote({ term, hits: ev });
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [term, open, bots]);
  const hits = useMemo(() => (remote.term === term ? [...local, ...remote.hits] : local), [local, remote, term]);
  const sel = Math.min(selRaw, Math.max(0, hits.length - 1));

  if (!open) return null;
  const go = (h: Hit) => { onClose(); router.push(scoped(h.href)); };
  return (
    <div className="palette" onClick={onClose} role="presentation">
      <div className="box" role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input ref={input} className="input" style={{ border: 0, borderRadius: 0, padding: "14px 16px", fontSize: "1rem", background: "transparent" }}
          placeholder="Search events, bots, clients… (type a name, an order number, a customer)" value={q} onChange={(e) => setQ(e.target.value)}
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={hits[sel] ? `hit-${sel}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === "Enter" && hits[sel]) { e.preventDefault(); go(hits[sel]); }
            if (e.key === "Enter" && !hits.length && q.trim()) { e.preventDefault(); onClose(); router.push(scoped(`/search?q=${encodeURIComponent(q.trim())}`)); }
          }} />
        <div id="palette-list" role="listbox" className="max-h-[60vh] overflow-auto">
          {hits.map((h, i) => (
            <button key={`${h.kind}-${h.href}-${i}`} id={`hit-${i}`} role="option" aria-selected={i === sel} className="hit" onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <span className="tag muted">{h.kind}</span>
              <span className="grid min-w-0"><span className="truncate font-semibold text-sm">{h.title}</span><span className="truncate text-dim text-xs">{h.sub}</span></span>
              {h.at ? <Time iso={h.at} mode="datetime" className="text-dim text-xs" /> : <span />}
            </button>
          ))}
          {!hits.length && <p className="p-4 text-dim text-sm">No matches. Press Enter to search the full timeline.</p>}
        </div>
      </div>
    </div>
  );
}
