// Idempotent backfill importer for the RMS Ops Console.
//
//   npx tsx scripts/import-events.ts --file care_flow_events.jsonl --client fresh-bros --bot care-pack [--dry-run] [--keep-decisions]
//
// Reads one bot event per line (the contract in agency-dashboard/bot_event_contract.md; an optional
// "bot": "<slug>" field on a line routes it to another bot of the same client). Writes straight to
// Postgres with DATABASE_URL, so months of history land with received_at = occurred_at and never make a
// dead bot look alive. Re-running the same file inserts nothing: rows dedupe on (bot_id, idempotency_key),
// and lines without a key get a deterministic one derived from their content.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { BotEventSchema, toEventRow, type EventRow } from "../src/lib/event-contract";

type Args = { file: string; client: string; bot: string; dryRun: boolean; keepDecisions: boolean; batch: number; databaseUrl: string };

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback?: string) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    return argv[i + 1];
  };
  const file = get("file"); const client = get("client"); const bot = get("bot");
  if (!file || !client || !bot) {
    console.error("usage: import-events.ts --file <events.jsonl> --client <client-slug> --bot <default-bot-slug> [--dry-run] [--keep-decisions] [--batch 500]");
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) { console.error("DATABASE_URL is not set (Supabase: Project Settings → Database → Connection string, session pooler)"); process.exit(2); }
  return { file, client, bot, dryRun: argv.includes("--dry-run"), keepDecisions: argv.includes("--keep-decisions"),
           batch: Number(get("batch", "500")), databaseUrl };
}

const COLS = ["bot_id","client_id","type","status","severity","run_id","summary","detail","channel","direction",
  "counterparty_name","counterparty_handle","thread_ref","close_lead_id","close_activity_id","amount_cents",
  "links","payload","idempotency_key","occurred_at","received_at"] as const;

function derivedKey(row: EventRow): string {
  const h = createHash("sha256").update([row.bot_id, row.type, row.occurred_at, row.summary, row.thread_ref ?? "", row.run_id ?? ""].join("\u0000")).digest("hex");
  return `import:${h.slice(0, 32)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Client({ connectionString: args.databaseUrl });
  await db.connect();

  const client = (await db.query("select id, slug, store_message_bodies from public.clients where slug = $1", [args.client])).rows[0];
  if (!client) { console.error(`client "${args.client}" not found; create it in Settings first`); process.exit(1); }
  const bots = new Map<string, { id: string }>();
  for (const b of (await db.query("select id, slug from public.bots where client_id = $1", [client.id])).rows) bots.set(b.slug, { id: b.id });
  if (!bots.has(args.bot)) { console.error(`bot "${args.bot}" not found for client "${args.client}"; create it in Settings first`); process.exit(1); }

  const stats = { lines: 0, valid: 0, invalid: 0, inserted: 0, duplicates: 0, derivedKeys: 0, unknownBot: 0,
    byType: {} as Record<string, number>, minAt: "", maxAt: "", decisionEventIds: [] as string[] };
  const errors: string[] = [];
  let pending: EventRow[] = [];

  const flush = async () => {
    if (!pending.length) return;
    if (args.dryRun) { pending = []; return; }
    const values: unknown[] = []; const tuples: string[] = [];
    pending.forEach((r, i) => {
      const base = i * COLS.length;
      tuples.push(`(${COLS.map((_, j) => `$${base + j + 1}`).join(",")})`);
      values.push(r.bot_id, r.client_id, r.type, r.status, r.severity, r.run_id, r.summary, r.detail, r.channel, r.direction,
        r.counterparty_name, r.counterparty_handle, r.thread_ref, r.close_lead_id, r.close_activity_id, r.amount_cents,
        JSON.stringify(r.links), JSON.stringify(r.payload), r.idempotency_key, r.occurred_at, r.occurred_at);
    });
    await db.query("begin");
    try {
      const res = await db.query(
        `insert into public.events (${COLS.join(",")}) values ${tuples.join(",")}
         on conflict (bot_id, idempotency_key) do nothing returning id, type`, values);
      await db.query("commit");
      stats.inserted += res.rowCount ?? 0;
      stats.duplicates += pending.length - (res.rowCount ?? 0);
      for (const r of res.rows) if (r.type === "decision_needed") stats.decisionEventIds.push(r.id);
    } catch (e) { await db.query("rollback"); throw e; }
    pending = [];
  };

  const rl = createInterface({ input: createReadStream(args.file), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    const line = raw.trim();
    if (!line) continue;
    stats.lines++;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { stats.invalid++; errors.push(`line ${lineNo}: not JSON`); continue; }
    const botSlug = (obj as { bot?: unknown })?.bot;
    const target = typeof botSlug === "string" ? bots.get(botSlug) : bots.get(args.bot);
    if (!target) { stats.invalid++; stats.unknownBot++; errors.push(`line ${lineNo}: unknown bot "${String(botSlug)}"`); continue; }
    if (obj && typeof obj === "object") delete (obj as Record<string, unknown>).bot;
    const parsed = BotEventSchema.safeParse(obj);
    if (!parsed.success) {
      stats.invalid++;
      errors.push(`line ${lineNo}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "event"}: ${i.message}`).join("; ")}`);
      continue;
    }
    if (!parsed.data.occurred_at) { stats.invalid++; errors.push(`line ${lineNo}: occurred_at is required for history`); continue; }
    const row = toEventRow(parsed.data, { botId: target.id, clientId: client.id, storeBodies: client.store_message_bodies });
    if (!row.idempotency_key) { row.idempotency_key = derivedKey(row); stats.derivedKeys++; }
    stats.valid++;
    stats.byType[row.type] = (stats.byType[row.type] ?? 0) + 1;
    if (!stats.minAt || row.occurred_at < stats.minAt) stats.minAt = row.occurred_at;
    if (!stats.maxAt || row.occurred_at > stats.maxAt) stats.maxAt = row.occurred_at;
    pending.push(row);
    if (pending.length >= args.batch) await flush();
  }
  await flush();

  let expired = 0;
  if (!args.dryRun && !args.keepDecisions && stats.decisionEventIds.length) {
    const res = await db.query(
      `update public.decisions set state = 'expired'
       where event_id = any($1::uuid[]) and state = 'open' and created_at < now() - interval '48 hours'`,
      [stats.decisionEventIds]);
    expired = res.rowCount ?? 0;
  }
  await db.end();

  console.log(`${args.dryRun ? "DRY RUN  " : ""}file: ${args.file}`);
  console.log(`lines: ${stats.lines}  valid: ${stats.valid}  invalid: ${stats.invalid}${stats.unknownBot ? ` (unknown bot: ${stats.unknownBot})` : ""}`);
  console.log(`inserted: ${args.dryRun ? "(dry run)" : stats.inserted}  duplicates skipped: ${args.dryRun ? "(dry run)" : stats.duplicates}  derived idempotency keys: ${stats.derivedKeys}`);
  if (stats.valid) console.log(`range: ${stats.minAt} → ${stats.maxAt}`);
  console.log(`by type: ${Object.entries(stats.byType).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (expired) console.log(`decisions expired (older than 48 h): ${expired}`);
  if (errors.length) {
    console.log(`\nfirst ${Math.min(20, errors.length)} of ${errors.length} problems:`);
    for (const e of errors.slice(0, 20)) console.log("  " + e);
  }
  process.exit(stats.invalid && !stats.valid ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
