// Shared bot-key auth for RMS Ops Console Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export type BotCtx = {
  keyId: string;
  botId: string;
  clientId: string;
  botSlug: string;
  storeBodies: boolean;
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const KEY_RE = /^rmsb_([0-9a-f]{8})_([0-9a-f]{48})$/;

/** Returns the bot context for a valid, unrevoked key on an enabled bot, else null. */
export async function authBot(req: Request): Promise<BotCtx | null> {
  const key = (req.headers.get("x-bot-key") ?? "").trim();
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const { data, error } = await admin
    .from("bot_keys")
    .select("id, key_hash, revoked_at, bots!inner(id, slug, enabled, client_id, clients!inner(store_message_bodies, status))")
    .eq("prefix", m[1])
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  // deno-lint-ignore no-explicit-any
  const bot = (data as any).bots;
  if (!bot?.enabled || bot.clients?.status === "churned") return null;
  if (!safeEqual(await sha256Hex(key), data.key_hash)) return null;
  // best-effort, non-blocking
  admin.from("bot_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return {
    keyId: data.id,
    botId: bot.id,
    clientId: bot.client_id,
    botSlug: bot.slug,
    storeBodies: !!bot.clients?.store_message_bodies,
  };
}
