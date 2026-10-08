"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;
/** One browser client per tab; realtime auth follows the cookie session automatically. */
export function supabaseBrowser() {
  if (!client) {
    const { url, key } = publicEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
