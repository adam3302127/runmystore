import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SettingsTabs } from "@/components/SettingsForms";
import { Eyebrow } from "@/components/Stripes";
import type { Bot, Client, ClientAccess, TeamMember } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const viewer = await requireViewer();
  if (!viewer.isAdmin) redirect("/");
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }, { data: team }, { data: access }] = await Promise.all([
    supabase.from("clients").select("*").order("name"), supabase.from("bots").select("*").order("name"),
    supabase.from("team_members").select("*").order("created_at"), supabase.from("client_access").select("*"),
  ]);
  // Emails live in auth.users; read them with the service key on the server only.
  const emails: Record<string, string> = {};
  try {
    const { data } = await supabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) if (u.email) emails[u.id] = u.email;
  } catch { /* no service key configured: names only */ }
  const accessMap: Record<string, string[]> = {};
  for (const a of (access ?? []) as ClientAccess[]) (accessMap[a.user_id] ??= []).push(a.client_id);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1"><Eyebrow>Settings</Eyebrow><h1 className="display text-4xl">Clients, bots, team.</h1></div>
      <SettingsTabs clients={(clients ?? []) as Client[]} bots={(bots ?? []) as Bot[]} team={(team ?? []) as TeamMember[]} emails={emails} access={accessMap} viewerId={viewer.user.id} isOwner={viewer.member.role === "owner"} />
    </div>
  );
}
