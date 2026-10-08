import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as Pg } from "pg";
import type { Page } from "@playwright/test";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const FUNCTIONS = process.env.FUNCTIONS_URL ?? `${SUPABASE_URL}/functions/v1`;

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const pg = new Pg({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try { return (await pg.query(text, params)).rows as T[]; } finally { await pg.end(); }
}

export type TestUser = { id: string; email: string };
/** Creates (or finds) an auth user and its team_members row. */
export async function ensureUser(email: string, display: string, role: "owner" | "admin" | "operator" | "viewer", allClients: boolean, clientSlugs: string[] = []): Promise<TestUser> {
  const a = admin();
  let id: string | undefined;
  const created = await a.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) id = created.data.user.id;
  else {
    const list = await a.auth.admin.listUsers({ perPage: 1000 });
    id = list.data.users.find((u) => u.email === email)?.id;
  }
  if (!id) throw new Error(`could not create ${email}: ${created.error?.message}`);
  await sql(`insert into public.team_members (user_id, display_name, role, all_clients) values ($1,$2,$3,$4)
             on conflict (user_id) do update set role = excluded.role, all_clients = excluded.all_clients, display_name = excluded.display_name`, [id, display, role, allClients]);
  await sql(`delete from public.client_access where user_id = $1`, [id]);
  for (const slug of clientSlugs) await sql(`insert into public.client_access (user_id, client_id) select $1, id from public.clients where slug = $2`, [id, slug]);
  return { id, email };
}

/** Signs a Playwright page in through the app's own /auth/confirm route using an admin-generated magic link. */
export async function signIn(page: Page, email: string) {
  const a = admin();
  const { data, error } = await a.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/`);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 20_000 });
}

export async function botKey(clientSlug: string, botSlug: string): Promise<{ key: string; botId: string; clientId: string }> {
  const rows = await sql<{ id: string; client_id: string }>(`select b.id, b.client_id from public.bots b join public.clients c on c.id = b.client_id where c.slug = $1 and b.slug = $2`, [clientSlug, botSlug]);
  if (!rows[0]) throw new Error(`bot ${clientSlug}/${botSlug} not in seed`);
  const key = await sql<{ k: string }>(`select public.create_bot_key($1, 'playwright') as k`, [rows[0].id]);
  return { key: key[0].k, botId: rows[0].id, clientId: rows[0].client_id };
}

export async function ingest(key: string, body: unknown) {
  const res = await fetch(`${FUNCTIONS}/ingest`, { method: "POST", headers: { "x-bot-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) as { ok?: boolean; ids?: string[]; duplicate?: boolean } };
}
export async function inbox(key: string) {
  const res = await fetch(`${FUNCTIONS}/bot-inbox`, { headers: { "x-bot-key": key } });
  return { status: res.status, body: await res.json().catch(() => ({})) as { decisions?: { id: string; answer_key: string | null }[] } };
}
export const uid = () => Math.random().toString(36).slice(2, 10);
