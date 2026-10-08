"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type LoginState = { ok: boolean; error: string | null; email?: string };

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Google OAuth (PKCE). Only accounts already on the team get past /auth/confirm; unknown ones land on /no-access. */
export async function signInWithGoogle(form: FormData) {
  const next = String(form.get("next") ?? "/");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/confirm?next=${encodeURIComponent(next)}`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/");
  if (!email || !email.includes("@")) return { ok: false, error: "Enter your work email." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await origin()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  // Unknown addresses get the same answer as known ones, so the form never confirms who is on the team.
  if (error && !/signups? not allowed|user not found/i.test(error.message)) {
    return { ok: false, error: error.status === 429 ? "Too many requests. Wait a minute and try again." : "Could not send the link. Try again." };
  }
  return { ok: true, error: null, email };
}
