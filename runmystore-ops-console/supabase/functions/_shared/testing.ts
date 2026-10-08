// Test-only helpers: a tiny in-memory PostgREST that speaks just enough of the API that
// _shared/auth.ts, ingest and bot-inbox use. Lets the functions run unmodified, without Docker.
// deno-lint-ignore-file no-explicit-any

export type FakeKey = {
  prefix: string; key: string; revoked?: boolean;
  bot: { id: string; slug: string; enabled: boolean; client_id: string; store_message_bodies: boolean; status?: string };
};

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hex(n: number): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function makeKey(): { key: string; prefix: string } {
  const prefix = hex(4);
  return { key: `rmsb_${prefix}_${hex(24)}`, prefix };
}

export class FakePostgrest {
  keys: FakeKey[] = [];
  events: any[] = [];
  decisions: any[] = [];
  lastUsed: Record<string, string> = {};
  requests: { method: string; path: string; prefer: string | null }[] = [];
  private server?: Deno.HttpServer;
  url = "";

  async start(): Promise<string> {
    this.server = Deno.serve({ port: 0, onListen: () => {} }, (req) => this.handle(req));
    const addr = this.server.addr as Deno.NetAddr;
    this.url = `http://127.0.0.1:${addr.port}`;
    return this.url;
  }
  async stop() { await this.server?.shutdown(); }

  private async handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const prefer = req.headers.get("prefer");
    this.requests.push({ method: req.method, path: u.pathname + u.search, prefer });
    const table = u.pathname.replace("/rest/v1/", "");
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (table === "bot_keys" && req.method === "GET") {
      const prefix = (u.searchParams.get("prefix") ?? "").replace(/^eq\./, "");
      const rows = await Promise.all(this.keys.filter((k) => k.prefix === prefix).map(async (k) => ({
        id: `key_${k.prefix}`,
        key_hash: await sha256Hex(k.key),
        revoked_at: k.revoked ? new Date().toISOString() : null,
        bots: {
          id: k.bot.id, slug: k.bot.slug, enabled: k.bot.enabled, client_id: k.bot.client_id,
          clients: { store_message_bodies: k.bot.store_message_bodies, status: k.bot.status ?? "active" },
        },
      })));
      return json(200, rows);
    }
    if (table === "bot_keys" && req.method === "PATCH") {
      const id = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
      this.lastUsed[id] = (await req.json()).last_used_at;
      return new Response(null, { status: 204 });
    }
    if (table === "events" && req.method === "POST") {
      const rows = await req.json();
      const ignoreDupes = (prefer ?? "").includes("resolution=ignore-duplicates");
      const inserted: any[] = [];
      for (const r of rows) {
        const dupe = r.idempotency_key != null &&
          this.events.some((e) => e.bot_id === r.bot_id && e.idempotency_key === r.idempotency_key);
        if (dupe) {
          if (ignoreDupes) continue;
          return json(409, { code: "23505", message: "duplicate key value violates unique constraint" });
        }
        const row = { id: crypto.randomUUID(), received_at: new Date().toISOString(), ...r };
        this.events.push(row);
        inserted.push({ id: row.id, idempotency_key: row.idempotency_key });
      }
      return json(201, inserted);
    }
    if (table === "decisions" && req.method === "PATCH") {
      const botId = (u.searchParams.get("bot_id") ?? "").replace(/^eq\./, "");
      const states = (u.searchParams.get("state") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
      const patch = await req.json();
      const hit = this.decisions.filter((d) => d.bot_id === botId && states.includes(d.state) && d.delivered_to_bot_at == null);
      for (const d of hit) Object.assign(d, patch);
      return json(200, hit.map(({ id, event_id, question, state, answer_key, answer_note, answered_at }) =>
        ({ id, event_id, question, state, answer_key, answer_note, answered_at })));
    }
    return json(404, { message: `fake postgrest: unhandled ${req.method} ${u.pathname}` });
  }
}

/** Import an Edge Function module and capture the handler it passes to Deno.serve, without opening a port. */
export async function loadHandler(modulePath: string): Promise<(req: Request) => Promise<Response>> {
  const original = Deno.serve;
  let handler: any;
  (Deno as any).serve = (a: any, b?: any) => {
    handler = typeof a === "function" ? a : b;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: { hostname: "", port: 0, transport: "tcp" } };
  };
  try { await import(modulePath); } finally { (Deno as any).serve = original; }
  if (!handler) throw new Error(`${modulePath} did not call Deno.serve`);
  return (req) => Promise.resolve(handler(req));
}
