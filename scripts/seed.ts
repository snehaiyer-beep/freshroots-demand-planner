/**
 * Seed Supabase.
 *   npm run seed                 → load data/*.csv (15 real SKUs + SKU016, a new product with no sales)
 *   npm run seed -- --synthetic  → 40 SKUs × 50 distributors × 156 weeks of synthetic data
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional SEED_ALLOWED_EMAILS (comma-separated).
 * Wipes skus (cascading to sales/stock/POs/recommendations) and runs before loading.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { seedFromCsv, syntheticSeed, type SeedData } from "./seedData";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in .env.local)");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const synthetic = process.argv.includes("--synthetic");
  let data: SeedData;
  if (synthetic) {
    data = syntheticSeed();
  } else {
    const dir = path.join(process.cwd(), "data");
    const f = (n: string) => readFileSync(path.join(dir, n), "utf8");
    data = seedFromCsv({
      skuMaster: f("sku_master.csv"),
      weeklySales: f("weekly_sales.csv"),
      inventory: f("current_inventory.csv"),
      calendar: existsSync(path.join(dir, "calendar.csv")) ? f("calendar.csv") : undefined,
    });
  }
  console.log(`Seeding ${synthetic ? "synthetic" : "CSV"} data: ${data.skus.length} SKUs, ${data.sales.length} sales rows`);

  const check = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };

  // wipe (skus cascade to weekly_sales, stock, open_pos, recommendations → po_log)
  check("clear runs", (await db.from("runs").delete().gte("id", 0)).error);
  check("clear skus", (await db.from("skus").delete().neq("sku", "")).error);

  check("insert skus", (await db.from("skus").insert(data.skus)).error);

  const CHUNK = 5000;
  for (let i = 0; i < data.sales.length; i += CHUNK) {
    check("insert weekly_sales", (await db.from("weekly_sales").insert(data.sales.slice(i, i + CHUNK))).error);
    process.stdout.write(`\r  weekly_sales ${Math.min(i + CHUNK, data.sales.length)}/${data.sales.length}`);
  }
  process.stdout.write("\n");

  check("insert stock", (await db.from("stock").insert(data.stock)).error);
  if (data.openPos.length) check("insert open_pos", (await db.from("open_pos").insert(data.openPos)).error);

  if (data.festivalMonths?.length) {
    check(
      "config festival_months",
      (await db.from("config").upsert({ key: "festival_months", value: data.festivalMonths.join(",") })).error,
    );
  }

  const emails = (process.env.SEED_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length) {
    check("allowed_users", (await db.from("allowed_users").upsert(emails.map((email) => ({ email })))).error);
    console.log(`Allowed users: ${emails.join(", ")}`);
  }
  console.log("Done. Open the app and press “Run now”.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
