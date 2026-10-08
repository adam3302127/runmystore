// Dev-only: serves the real ingest + bot-inbox handlers on one port, backed by the in-memory
// PostgREST from testing.ts. Lets the simulator run end to end without a Supabase project.
//   deno run --allow-net --allow-env --allow-read _shared/local-stack.ts   (from supabase/functions)
// Prints the bot keys it minted; feed them to the simulator as SIM_BOT_KEYS.
import { FakePostgrest, loadHandler, makeKey } from "./testing.ts";

const pg = new FakePostgrest();
const url = await pg.start();
Deno.env.set("SUPABASE_URL", url);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-stack");
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const labels = (Deno.env.get("LOCAL_STACK_BOTS") ?? "care-pack,inbox,reorder,prospector,ops-watch").split(",");
const keys = labels.map((slug, i) => {
  const k = makeKey();
  pg.keys.push({ ...k, bot: { id: `0000000${i}-0000-4000-8000-00000000000${i}`, slug, enabled: true, client_id: CLIENT, store_message_bodies: false } });
  return `${slug}=${k.key}`;
});
const ingest = await loadHandler(new URL("../ingest/index.ts", import.meta.url).href);
const inbox = await loadHandler(new URL("../bot-inbox/index.ts", import.meta.url).href);
const port = Number(Deno.env.get("LOCAL_STACK_PORT") ?? "54329");
console.log(`SIM_INGEST_URL=http://127.0.0.1:${port}/functions/v1/ingest`);
console.log(`SIM_BOT_KEYS=${keys.join(",")}`);
Deno.serve({ port, onListen: () => console.log(`local stack listening on ${port}; events stored: 0`) }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path.endsWith("/ingest")) return ingest(req);
  if (path.endsWith("/bot-inbox")) return inbox(req);
  if (path === "/stats") return Response.json({ events: pg.events.length, byType: pg.events.reduce((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {} as Record<string, number>) });
  return new Response("not found", { status: 404 });
});
