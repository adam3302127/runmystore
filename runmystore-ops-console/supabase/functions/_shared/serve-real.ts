// Dev-only: serves the real ingest + bot-inbox handlers with the host Deno against a real Supabase API
// (local `supabase start` or a hosted project). Useful where the Docker edge runtime cannot reach npm.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... PORT=54399 \
//   deno run --allow-net --allow-env --allow-read _shared/serve-real.ts      (from supabase/functions)
import { loadHandler } from "./testing.ts";

if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(2);
}
const ingest = await loadHandler(new URL("../ingest/index.ts", import.meta.url).href);
const inbox = await loadHandler(new URL("../bot-inbox/index.ts", import.meta.url).href);
const port = Number(Deno.env.get("PORT") ?? "54399");
Deno.serve({ port, onListen: () => console.log(`real functions on http://127.0.0.1:${port}/functions/v1/{ingest,bot-inbox} -> ${Deno.env.get("SUPABASE_URL")}`) }, (req) => {
  const path = new URL(req.url).pathname;
  if (path.endsWith("/ingest")) return ingest(req);
  if (path.endsWith("/bot-inbox")) return inbox(req);
  return new Response("not found", { status: 404 });
});
