/** Public Supabase config. Accepts the new publishable key or the legacy anon key under one name. */
export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable or anon key) in .env.local");
  }
  return { url, key };
}
export const DEFAULT_TZ = process.env.NEXT_PUBLIC_DEFAULT_TZ || "America/New_York";
export const CLOSE_BASE = "https://app.close.com";
