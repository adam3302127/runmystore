"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { setConnection, type Connection } from "@/lib/realtime-status";
import type { Bot, Decision, Event } from "@/lib/types";
import type { EventType, Lane } from "@/lib/event-contract";

export type LiveOptions = {
  clientId?: string;
  botId?: string;
  lanes?: Lane[];
  types?: EventType[];
  bots: Bot[];                 // used to map rows to lanes and to filter by lane
  limit?: number;              // initial load (default 50)
  max?: number;                // in-memory cap (default 500)
  onBotUpdate?: (bot: Bot) => void;
  onDecision?: (d: Decision, kind: "INSERT" | "UPDATE") => void;
  enabled?: boolean;
};
type LiveEvent = Event & { fresh?: boolean };
type Store = { key: string; events: LiveEvent[]; queued: LiveEvent[]; loading: boolean };
const NONE = "00000000-0000-0000-0000-000000000000";

/**
 * Latest events + a realtime subscription (Postgres Changes, RLS-filtered). Prepends new rows deduped by id,
 * keeps `max` in memory, queues while paused, and backfills anything missed when the channel reconnects.
 */
export function useLiveEvents(opts: LiveOptions) {
  const { clientId, botId, bots, limit = 50, max = 500, enabled = true } = opts;
  const lanesKey = (opts.lanes ?? []).join(",");
  const typesKey = (opts.types ?? []).join(",");
  const scopeKey = [clientId ?? "", botId ?? "", lanesKey, typesKey, limit, enabled ? 1 : 0].join("|");
  const [store, setStore] = useState<Store>({ key: "", events: [], queued: [], loading: true });
  const [paused, setPausedState] = useState(false);
  const [connection, setConn] = useState<Connection>("connecting");
  const pausedRef = useRef(false);
  const newestReceived = useRef<string | null>(null);
  const idsRef = useRef<Set<string>>(new Set());
  const botsById = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const botsRef = useRef(botsById);
  const optsRef = useRef(opts);
  useEffect(() => { botsRef.current = botsById; optsRef.current = opts; });

  const matches = useCallback((e: Event) => {
    const o = optsRef.current;
    if (o.clientId && e.client_id !== o.clientId) return false;
    if (o.botId && e.bot_id !== o.botId) return false;
    if (o.types?.length && !o.types.includes(e.type)) return false;
    if (o.lanes?.length) {
      const lane = botsRef.current.get(e.bot_id)?.lane;
      if (!lane || !o.lanes.includes(lane)) return false;
    }
    return true;
  }, []);

  const update = useCallback((c: Connection) => { setConn(c); setConnection(c); }, []);

  const ingest = useCallback((key: string, rows: Event[], fresh: boolean) => {
    const add: LiveEvent[] = [];
    for (const r of rows) {
      if (idsRef.current.has(r.id) || !matches(r)) continue;
      idsRef.current.add(r.id);
      add.push(fresh ? { ...r, fresh: true } : r);
      if (!newestReceived.current || r.received_at > newestReceived.current) newestReceived.current = r.received_at;
    }
    add.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    setStore((s) => {
      const base: Store = s.key === key ? s : { key, events: [], queued: [], loading: false };
      if (!add.length) return s.key === key && !s.loading ? s : { ...base, loading: false };
      if (pausedRef.current && fresh) return { ...base, loading: false, queued: [...add, ...base.queued] };
      return { ...base, loading: false, events: [...add, ...base.events].slice(0, max) };
    });
  }, [matches, max]);

  const query = useCallback(() => {
    const o = optsRef.current;
    let q = supabaseBrowser().from("events").select("*");
    if (o.clientId) q = q.eq("client_id", o.clientId);
    if (o.botId) q = q.eq("bot_id", o.botId);
    if (o.types?.length) q = q.in("type", o.types);
    if (o.lanes?.length && !o.botId) {
      const ids = [...botsRef.current.values()].filter((b) => o.lanes!.includes(b.lane)).map((b) => b.id);
      q = q.in("bot_id", ids.length ? ids : [NONE]);
    }
    return q;
  }, []);

  // Initial load whenever the scope changes. State for the old scope is dropped by key, not cleared in the effect.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    idsRef.current = new Set();
    newestReceived.current = null;
    if (limit === 0) { ingest(scopeKey, [], false); return; }
    query().order("occurred_at", { ascending: false }).limit(limit).then(({ data }: { data: unknown }) => {
      if (!cancelled) ingest(scopeKey, (data ?? []) as Event[], false);
    });
    return () => { cancelled = true; };
  }, [scopeKey, limit, enabled, query, ingest]);

  // Realtime subscription. One filter per channel is allowed, so scope by client or bot and filter the rest locally.
  useEffect(() => {
    if (!enabled) return;
    const sb = supabaseBrowser();
    const filter = botId ? `bot_id=eq.${botId}` : clientId ? `client_id=eq.${clientId}` : undefined;
    const name = `live:${botId ?? clientId ?? "all"}:${Math.random().toString(36).slice(2, 8)}`;
    let wasLive = false;
    const channel: RealtimeChannel = sb.channel(name)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", ...(filter ? { filter } : {}) }, (p: RealtimePostgresChangesPayload<Event>) => ingest(scopeKey, [p.new as Event], true))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events", ...(filter ? { filter } : {}) }, (p: RealtimePostgresChangesPayload<Event>) => {
        const row = p.new as Event;
        setStore((s) => ({ ...s, events: s.events.map((e) => (e.id === row.id ? { ...e, ...row } : e)) }));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bots", ...(clientId ? { filter: `client_id=eq.${clientId}` } : {}) }, (p: RealtimePostgresChangesPayload<Bot>) => optsRef.current.onBotUpdate?.(p.new as Bot))
      .on("postgres_changes", { event: "*", schema: "public", table: "decisions", ...(clientId ? { filter: `client_id=eq.${clientId}` } : {}) }, (p: RealtimePostgresChangesPayload<Decision>) => {
        if (p.eventType === "INSERT" || p.eventType === "UPDATE") optsRef.current.onDecision?.(p.new as Decision, p.eventType);
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          update("live");
          if (wasLive && newestReceived.current) {
            // Reconnected: pull anything that landed while the socket was down.
            const { data } = await query().gt("received_at", newestReceived.current).order("occurred_at", { ascending: false }).limit(200);
            ingest(scopeKey, (data ?? []) as Event[], true);
          }
          wasLive = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") update("offline");
        else if (status === "CLOSED") update("connecting");
      });
    return () => { sb.removeChannel(channel); };
  }, [clientId, botId, enabled, scopeKey, ingest, query, update]);

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
    setPausedState(p);
    if (!p) setStore((s) => (s.queued.length ? { ...s, events: [...s.queued, ...s.events].slice(0, max), queued: [] } : s));
  }, [max]);

  const current = store.key === scopeKey;
  return {
    events: current ? store.events : [],
    loading: !current || store.loading,
    paused, setPaused,
    queued: current ? store.queued.length : 0,
    connection, botsById,
  };
}
