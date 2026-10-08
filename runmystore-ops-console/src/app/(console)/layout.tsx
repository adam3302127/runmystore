import { Suspense } from "react";
import { requireViewer } from "@/lib/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import { TopBar } from "@/components/TopBar";
import { ClientScopeProvider } from "@/components/ClientScope";
import { BotsIndexProvider } from "@/components/BotsIndex";
import { fleetSummary } from "@/lib/health";
import { EventDrawerHost } from "@/components/EventDrawer";
import type { Bot, Client } from "@/lib/types";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const supabase = await supabaseServer();
  const [{ data: clients }, { data: bots }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("bots").select("*").order("name"),
  ]);
  const fleet = fleetSummary((bots ?? []) as Bot[]);
  return (
    <Suspense>
      <ClientScopeProvider clients={(clients ?? []) as Client[]}>
        <BotsIndexProvider bots={(bots ?? []) as Bot[]}>
          <TopBar viewer={viewer} fleet={{ live: fleet.live, total: fleet.enabled }} />
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">{children}</main>
          <EventDrawerHost canAct={viewer.canAct} />
        </BotsIndexProvider>
      </ClientScopeProvider>
    </Suspense>
  );
}
