// Runs a SQL file against a hosted Supabase project over HTTPS (Management API), for environments
// that cannot open a direct Postgres connection. Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.
//   node scripts/hosted-sql.mjs supabase/migrations/0001_init.sql
import { readFileSync } from "node:fs";
const [file] = process.argv.slice(2);
const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
if (!file || !token || !ref) { console.error("usage: SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/hosted-sql.mjs <file.sql>"); process.exit(2); }
const query = readFileSync(file, "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) { console.error(`${file}: HTTP ${res.status}\n${text.slice(0, 2000)}`); process.exit(1); }
console.log(`${file}: ok`);
try { const rows = JSON.parse(text); if (Array.isArray(rows) && rows.length) console.log(JSON.stringify(rows, null, 1).replace(/rmsb_([0-9a-f]{8})_[0-9a-f]{48}/g, "rmsb_$1_<hidden>")); } catch { /* no rows */ }
