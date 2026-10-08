"use server";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type LoginState = { ok: boolean; error: string | null; email?: string };

export async function sendMagicLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/");
  if (!email || !email.includes("@")) return { ok: false, error: "Enter your work email." };
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  // Unknown addresses get the same answer as known ones, so the form never confirms who is on the team.
  if (error && !/signups? not allowed|user not found/i.test(error.message)) {
    return { ok: false, error: error.status === 429 ? "Too many requests. Wait a minute and try again." : "Could not send the link. Try again." };
  }
  return { ok: true, error: null, email };
}
