"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireViewer } from "@/lib/viewer";
import { LANES } from "@/lib/event-contract";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result<never> => ({ ok: false, error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) });

export async function answerDecision(id: string, answerKey: string | null, note: string | null, dismiss = false): Promise<Result> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("answer_decision", { p_id: id, p_answer_key: answerKey, p_note: note || null, p_dismiss: dismiss });
  if (error) return fail(error);
  revalidatePath("/decisions");
  return { ok: true };
}

export async function setEventStatus(id: string, status: "ok" | "pending" | "failed" | "needs_review" | "resolved"): Promise<Result> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_event_status", { p_id: id, p_status: status });
  return error ? fail(error) : { ok: true };
}

export async function addNote(eventId: string, body: string): Promise<Result> {
  const text = body.trim();
  if (!text) return { ok: false, error: "Write something first." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("event_notes").insert({ event_id: eventId, body: text, client_id: "00000000-0000-0000-0000-000000000000" });
  return error ? fail(error) : { ok: true };
}

export async function createBotKey(botId: string, label: string | null): Promise<Result<string>> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("create_bot_key", { p_bot_id: botId, p_label: label || null });
  if (error) return fail(error);
  revalidatePath(`/bots/${botId}`);
  return { ok: true, data: data as string };
}

export async function revokeBotKey(keyId: string, botId: string): Promise<Result> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("revoke_bot_key", { p_key_id: keyId });
  if (error) return fail(error);
  revalidatePath(`/bots/${botId}`);
  return { ok: true };
}

const slugOk = (s: string) => /^[a-z0-9-]+$/.test(s);

export async function saveClient(form: FormData): Promise<Result> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only." };
  const id = String(form.get("id") ?? "");
  const row = {
    slug: String(form.get("slug") ?? "").trim().toLowerCase(),
    name: String(form.get("name") ?? "").trim(),
    plan: String(form.get("plan") ?? "") || null,
    status: String(form.get("status") ?? "active"),
    timezone: String(form.get("timezone") ?? "America/New_York").trim() || "America/New_York",
    close_lead_id: String(form.get("close_lead_id") ?? "").trim() || null,
    store_message_bodies: form.get("store_message_bodies") === "on",
    accent_color: String(form.get("accent_color") ?? "").trim() || null,
    is_demo: form.get("is_demo") === "on",
  };
  if (!row.name) return { ok: false, error: "Name is required." };
  if (!slugOk(row.slug)) return { ok: false, error: "Slug must be lowercase letters, numbers and dashes." };
  try { Intl.DateTimeFormat("en-US", { timeZone: row.timezone }); } catch { return { ok: false, error: "Unknown time zone." }; }
  const supabase = await supabaseServer();
  const q = id ? supabase.from("clients").update(row).eq("id", id) : supabase.from("clients").insert(row);
  const { error } = await q;
  if (error) return fail(error);
  revalidatePath("/settings"); revalidatePath("/clients"); revalidatePath("/");
  return { ok: true };
}

export async function saveBot(form: FormData): Promise<Result> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only." };
  const id = String(form.get("id") ?? "");
  const lane = String(form.get("lane") ?? "ops");
  const row = {
    client_id: String(form.get("client_id") ?? ""),
    slug: String(form.get("slug") ?? "").trim().toLowerCase(),
    name: String(form.get("name") ?? "").trim(),
    lane: (LANES as readonly string[]).includes(lane) ? lane : "ops",
    platform: String(form.get("platform") ?? "").trim() || null,
    description: String(form.get("description") ?? "").trim() || null,
    expected_interval_minutes: Math.max(1, Number(form.get("expected_interval_minutes") || 60)),
    enabled: form.get("enabled") === "on",
  };
  if (!row.name || !row.client_id) return { ok: false, error: "Client and name are required." };
  if (!slugOk(row.slug)) return { ok: false, error: "Slug must be lowercase letters, numbers and dashes." };
  const supabase = await supabaseServer();
  const q = id ? supabase.from("bots").update(row).eq("id", id) : supabase.from("bots").insert(row);
  const { error } = await q;
  if (error) return fail(error);
  revalidatePath("/settings"); revalidatePath("/"); if (id) revalidatePath(`/bots/${id}`);
  return { ok: true };
}

export async function inviteTeammate(form: FormData): Promise<Result> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const displayName = String(form.get("display_name") ?? "").trim();
  const role = String(form.get("role") ?? "viewer");
  const allClients = form.get("all_clients") === "on";
  const clientIds = form.getAll("client_ids").map(String).filter(Boolean);
  if (!email.includes("@") || !displayName) return { ok: false, error: "Email and name are required." };
  if (!["owner", "admin", "operator", "viewer"].includes(role)) return { ok: false, error: "Bad role." };
  if (role === "owner" && viewer.member.role !== "owner") return { ok: false, error: "Only an owner can add another owner." };
  const admin = supabaseAdmin();
  // Invite (or find) the auth user with the service key, server-side only.
  let userId: string | null = null;
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/confirm` });
  if (invited.data.user) userId = invited.data.user.id;
  else {
    const list = await admin.auth.admin.listUsers({ perPage: 1000 });
    userId = list.data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (!userId) return fail(invited.error ?? new Error("Could not invite that address."));
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("team_members").upsert({ user_id: userId, display_name: displayName, role, all_clients: allClients });
  if (error) return fail(error);
  await supabase.from("client_access").delete().eq("user_id", userId);
  if (!allClients && clientIds.length) {
    const { error: e2 } = await supabase.from("client_access").insert(clientIds.map((client_id) => ({ user_id: userId, client_id })));
    if (e2) return fail(e2);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateTeammate(form: FormData): Promise<Result> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only." };
  const userId = String(form.get("user_id") ?? "");
  const role = String(form.get("role") ?? "viewer");
  const allClients = form.get("all_clients") === "on";
  const clientIds = form.getAll("client_ids").map(String).filter(Boolean);
  if (role === "owner" && viewer.member.role !== "owner") return { ok: false, error: "Only an owner can grant owner." };
  if (userId === viewer.user.id && role !== viewer.member.role) return { ok: false, error: "You can't change your own role." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("team_members").update({ role, all_clients: allClients, display_name: String(form.get("display_name") ?? "").trim() || undefined }).eq("user_id", userId);
  if (error) return fail(error);
  await supabase.from("client_access").delete().eq("user_id", userId);
  if (!allClients && clientIds.length) await supabase.from("client_access").insert(clientIds.map((client_id) => ({ user_id: userId, client_id })));
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeTeammate(userId: string): Promise<Result> {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) return { ok: false, error: "Admins only." };
  if (userId === viewer.user.id) return { ok: false, error: "You can't remove yourself." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("team_members").delete().eq("user_id", userId);
  if (error) return fail(error);
  revalidatePath("/settings");
  return { ok: true };
}
