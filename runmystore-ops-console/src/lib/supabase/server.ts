import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Per-request server client (server components, route handlers, server actions). RLS applies. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  const { url, key } = publicEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(toSet) {
        try { for (const { name, value, options } of toSet) cookieStore.set(name, value, options); }
        catch { /* server components cannot set cookies; the proxy refreshes sessions */ }
      },
    },
  });
}
