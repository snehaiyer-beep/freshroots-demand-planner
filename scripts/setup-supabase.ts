/**
 * One-shot project setup through the Supabase Management API — no SQL editor or DB password needed.
 *   npm run setup:supabase
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL (picks the project), SUPABASE_ACCESS_TOKEN
 * (supabase.com/dashboard/account/tokens). It:
 *   1. fetches the publishable (or legacy anon) key and secret key into .env.local
 *   2. runs supabase/migrations/*.sql
 *   3. checks the Data API can see the tables
 */
import { config as loadEnv } from "dotenv";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local" });

const API = "https://api.supabase.com/v1";

async function api<T>(method: string, route: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function setEnv(file: string, updates: Record<string, string>) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.splice(lines.length - 1, 0, `${key}=${value}`);
  }
  writeFileSync(file, lines.join("\n"));
}

interface ApiKey { name: string; api_key: string | null; type?: string | null }

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!token) throw new Error("Add SUPABASE_ACCESS_TOKEN to .env.local (supabase.com/dashboard/account/tokens)");
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}`);

  // 1. keys
  const keys = await api<ApiKey[]>("GET", `/projects/${ref}/api-keys?reveal=true`, token);
  const publishable = keys.find((k) => k.type === "publishable" && k.api_key) ?? keys.find((k) => k.name === "anon" && k.api_key);
  const secret = keys.find((k) => k.type === "secret" && k.api_key) ?? keys.find((k) => k.name === "service_role" && k.api_key);
  if (!publishable?.api_key || !secret?.api_key) throw new Error("Could not find publishable/anon and secret/service_role keys");
  setEnv(".env.local", { NEXT_PUBLIC_SUPABASE_ANON_KEY: publishable.api_key, SUPABASE_SERVICE_ROLE_KEY: secret.api_key });
  console.log(`Keys written to .env.local (${publishable.name}, ${secret.name})`);

  // 2. migration
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await api("POST", `/projects/${ref}/database/query`, token, { query: readFileSync(path.join(dir, f), "utf8") });
    console.log(`Applied ${f}`);
  }
  const check = await api<{ n: number }[]>("POST", `/projects/${ref}/database/query`, token, {
    query: `select count(*)::int as n from information_schema.tables where table_schema = 'public'
            and table_name in ('skus','weekly_sales','stock','open_pos','config','runs','recommendations','po_log','allowed_users')`,
  });
  console.log(`Planner tables in database: ${check[0]?.n ?? 0}/9`);

  // 3. Data API sees the tables
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${url}/rest/v1/config?select=key`, {
      headers: { apikey: secret.api_key, Authorization: `Bearer ${secret.api_key}` },
    });
    if (res.ok) {
      console.log(`Data API ok: config has ${((await res.json()) as unknown[]).length} rows`);
      return;
    }
    if (attempt === 6) throw new Error(`Data API cannot see the tables yet: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
