import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { TeamMember, Viewer } from "@/lib/types";

/** The signed-in team member, or a redirect to /login or /no-access. Server only. */
export async function requireViewer(): Promise<Viewer> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: member } = await supabase.from("team_members").select("*").eq("user_id", user.id).maybeSingle();
  if (!member) redirect("/no-access");
  const m = member as TeamMember;
  return {
    user: { id: user.id, email: user.email ?? null },
    member: m,
    isAdmin: m.role === "owner" || m.role === "admin",
    canAct: m.role !== "viewer",
  };
}
