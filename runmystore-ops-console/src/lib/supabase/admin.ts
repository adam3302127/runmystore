import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/** Service-role client. Server only, used solely to invite teammates. Never import from client code. */
export function supabaseAdmin() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is not set on the server");
  return createClient(publicEnv().url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
