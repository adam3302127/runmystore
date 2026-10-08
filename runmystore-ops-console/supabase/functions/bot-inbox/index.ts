// GET /functions/v1/bot-inbox  (deploy with --no-verify-jwt). Returns answered/dismissed decisions not yet delivered.
import { admin, authBot, json } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return json(405, { ok: false, error: "GET only" });
  const bot = await authBot(req);
  if (!bot) return json(401, { ok: false, error: "invalid or revoked bot key" });

  const { data, error } = await admin
    .from("decisions")
    .update({ delivered_to_bot_at: new Date().toISOString() })
    .eq("bot_id", bot.botId)
    .in("state", ["answered", "dismissed"])
    .is("delivered_to_bot_at", null)
    .select("id, event_id, question, state, answer_key, answer_note, answered_at");
  if (error) return json(500, { ok: false, error: "lookup failed" });
  return json(200, { ok: true, decisions: data ?? [] });
});
