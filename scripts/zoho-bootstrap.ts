/**
 * One-time: create placeholder vendors (one per category) and the 16 items in an empty Zoho Inventory org.
 *   npm run zoho:bootstrap
 * Reads data/sku_master.csv for names, SKU codes and categories. Safe to re-run: existing vendors/items
 * (matched by name / SKU) are reused, never duplicated. Run `npm run zoho:connect` afterwards to map them.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { parseCsv } from "../lib/csv";

loadEnv({ path: ".env.local" });

const API = "https://www.zohoapis.in/inventory/v1";

async function accessToken(): Promise<string> {
  const p = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? "",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  const r = (await (await fetch(`https://accounts.zoho.in/oauth/v2/token?${p}`, { method: "POST" })).json()) as { access_token?: string; error?: string };
  if (!r.access_token) throw new Error(`Zoho token refresh failed: ${r.error}`);
  return r.access_token;
}

async function call<T>(token: string, method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ organization_id: process.env.ZOHO_ORG_ID ?? "", ...query });
  const res = await fetch(`${API}${path}?${qs}`, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
  if (!res.ok || (json.code !== undefined && json.code !== 0)) throw new Error(`${method} ${path} failed (${res.status}): ${json.message}`);
  return json;
}

async function main() {
  if (!process.env.ZOHO_ORG_ID) throw new Error("ZOHO_ORG_ID missing — run `npm run zoho:connect -- --dry` first");
  const token = await accessToken();

  const [header, ...rows] = parseCsv(readFileSync("data/sku_master.csv", "utf8"));
  const col = (name: string) => header.indexOf(name);
  const skus = rows.map((r) => ({ sku: r[col("SKU_ID")], name: r[col("SKU_Name")], category: r[col("Category")] }));

  // vendors: one placeholder per category
  const existingVendors = await call<{ contacts: { contact_id: string; contact_name: string }[] }>(token, "GET", "/contacts", undefined, {
    contact_type: "vendor", per_page: "200",
  });
  const vendorByName = new Map(existingVendors.contacts.map((c) => [c.contact_name.toLowerCase(), c.contact_id]));
  const vendorByCategory = new Map<string, string>();
  for (const category of Array.from(new Set(skus.map((s) => s.category)))) {
    const name = `Freshroots ${category} Supplier`;
    let id = vendorByName.get(name.toLowerCase());
    if (!id) {
      const r = await call<{ contact: { contact_id: string } }>(token, "POST", "/contacts", { contact_name: name, contact_type: "vendor" });
      id = r.contact.contact_id;
      console.log(`+ vendor  ${name} (${id})`);
    } else {
      console.log(`= vendor  ${name} (${id}) already exists`);
    }
    vendorByCategory.set(category, id);
  }

  // items
  const existingItems = await call<{ items: { item_id: string; name: string; sku?: string }[] }>(token, "GET", "/items", undefined, { per_page: "200" });
  const itemBySku = new Map(existingItems.items.filter((i) => i.sku).map((i) => [String(i.sku).toLowerCase(), i.item_id]));
  for (const s of skus) {
    if (itemBySku.has(s.sku.toLowerCase())) {
      console.log(`= item    ${s.sku} ${s.name} already exists`);
      continue;
    }
    const r = await call<{ item: { item_id: string } }>(token, "POST", "/items", {
      name: s.name,
      sku: s.sku,
      unit: "pcs",
      product_type: "goods",
      item_type: "inventory",
      rate: 0,
      purchase_rate: 0,
      vendor_id: vendorByCategory.get(s.category),
    });
    console.log(`+ item    ${s.sku} ${s.name} (${r.item.item_id})`);
  }
  console.log("Done. Now run: npm run zoho:connect");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
