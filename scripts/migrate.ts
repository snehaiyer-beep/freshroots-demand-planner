/**
 * Apply supabase/migrations/*.sql directly to Postgres (no SQL editor needed), then verify via the Data API.
 *   npm run migrate
 * Env: SUPABASE_DB_URL — Supabase → Connect → "Session pooler" URI (with your database password).
 */
import { config as loadEnv } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("Set SUPABASE_DB_URL in .env.local (Supabase → Connect → Session pooler URI)");

  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const f of files) {
      process.stdout.write(`Applying ${f} … `);
      await client.query(readFileSync(path.join(dir, f), "utf8"));
      console.log("ok");
    }
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public'
       and table_name in ('skus','weekly_sales','stock','open_pos','config','runs','recommendations','po_log','allowed_users')`,
    );
    console.log(`Planner tables in database: ${rows[0].n}/9`);
  } finally {
    await client.end();
  }

  // Confirm the Data API can see them (schema cache reloaded by the migration's NOTIFY).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { data, error } = await db.from("config").select("key");
      if (!error) {
        console.log(`Data API ok: config has ${data.length} rows`);
        return;
      }
      if (attempt === 5) throw new Error(`Data API still cannot see the tables: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
