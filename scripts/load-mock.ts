/**
 * Load a mock-data SQL file (skus, weekly_sales, stock, open_pos inserts) into Supabase via the API.
 *   npm run seed:mock                      → data/freshroots_mock_data.sql
 *   npm run seed:mock -- path/to/file.sql  → another file in the same format
 *   add --replace to remove every SKU not in the file (cascades their sales, stock, POs, recommendations)
 *   and all past runs, so the dashboard shows only the mock products.
 * Open-PO rows get stable ids "MOCK-OPEN-<sku>-<n>" (the table needs an id; Zoho sync leaves these alone).
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

type Row = Record<string, string>;

/** Rows of the first `insert into <table> (...) values ...` statement, values unquoted. */
export function parseInsert(sql: string, table: string): Row[] {
  const m = new RegExp(`insert into ${table}\\s*\\(([^)]*)\\)\\s*values([\\s\\S]*?)(?:\\bon conflict\\b|;)`, "i").exec(sql);
  if (!m) return [];
  const cols = m[1].split(",").map((c) => c.trim());
  return [...m[2].matchAll(/\(([^()]*)\)/g)].map((r) =>
    Object.fromEntries(r[1].split(",").map((v, i) => [cols[i], v.trim().replace(/^'(.*)'$/, "$1").replace(/''/g, "'")])),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const file = args.find((a) => !a.startsWith("--")) ?? "data/freshroots_mock_data.sql";
  const sql = readFileSync(file, "utf8");

  const skus = parseInsert(sql, "skus").map((r) => ({
    sku: r.sku,
    name: r.name,
    perishable: r.perishable === "true",
    launch_date: r.launch_date || null,
    std_qty: Number(r.std_qty),
  }));
  const sales = parseInsert(sql, "weekly_sales").map((r) => ({
    week_start: r.week_start, sku: r.sku, distributor_id: r.distributor_id, units: Number(r.units),
  }));
  const stock = parseInsert(sql, "stock").map((r) => ({ sku: r.sku, on_hand: Number(r.on_hand), as_of: r.as_of }));
  const perSku = new Map<string, number>();
  const openPos = parseInsert(sql, "open_pos").map((r) => {
    const n = (perSku.get(r.sku) ?? 0) + 1;
    perSku.set(r.sku, n);
    return { id: r.id || `MOCK-OPEN-${r.sku}-${n}`, sku: r.sku, qty: Number(r.qty), eta: r.eta || null };
  });
  if (skus.length === 0) throw new Error(`No skus found in ${file}`);
  console.log(`${file}: ${skus.length} SKUs · ${sales.length} sales rows · ${stock.length} stock · ${openPos.length} open POs`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const check = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };

  if (replace) {
    const keep = skus.map((s) => s.sku);
    const { data: others, error } = await db.from("skus").select("sku").not("sku", "in", `(${keep.map((s) => `"${s}"`).join(",")})`);
    check("list other skus", error);
    const gone = (others ?? []).map((o) => o.sku as string);
    check("clear runs", (await db.from("runs").delete().gte("id", 0)).error);
    if (gone.length) check("remove other skus", (await db.from("skus").delete().in("sku", gone)).error);
    console.log(`--replace: removed ${gone.length} other SKUs (${gone.join(", ") || "none"}) and all past runs`);
  }

  // skus: upsert only the listed columns so existing Zoho mappings survive a re-run
  check("skus", (await db.from("skus").upsert(skus, { onConflict: "sku" })).error);
  for (let i = 0; i < sales.length; i += 1000) {
    check("weekly_sales", (await db.from("weekly_sales").upsert(sales.slice(i, i + 1000), { onConflict: "week_start,sku,distributor_id" })).error);
  }
  check("stock", (await db.from("stock").upsert(stock, { onConflict: "sku" })).error);
  check("clear open_pos", (await db.from("open_pos").delete().in("sku", skus.map((s) => s.sku))).error);
  if (openPos.length) check("open_pos", (await db.from("open_pos").insert(openPos)).error);
  console.log("Loaded. Press “Run now” on the dashboard (or POST /api/run).");
}

if (process.argv[1]?.includes("load-mock")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
