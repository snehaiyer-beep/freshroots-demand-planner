/**
 * Connect Zoho Inventory (India DC) and map SKUs to real Zoho items/vendors.
 *   npm run zoho:connect            → connect + write mappings to Supabase
 *   npm run zoho:connect -- --dry   → connect + only report what would be mapped
 *
 * Needs in .env.local: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and either ZOHO_GRANT_CODE (from a Self Client,
 * valid ~10 minutes) or an existing ZOHO_REFRESH_TOKEN. Writes ZOHO_REFRESH_TOKEN and ZOHO_ORG_ID back.
 *
 * Matching: Zoho item SKU == our sku, else item name == our name (case-insensitive).
 * The item's preferred vendor becomes vendor_id. SKUs with no match get their placeholder ids cleared,
 * so the app blocks their approval ("Map in Zoho first") instead of failing pushes.
 */
import { config as loadEnv } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const ACCOUNTS = "https://accounts.zoho.in/oauth/v2/token";
const API = "https://www.zohoapis.in/inventory/v1";
const DRY = process.argv.includes("--dry");

function setEnv(updates: Record<string, string>) {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.splice(Math.max(lines.length - 1, 0), 0, `${key}=${value}`);
  }
  writeFileSync(".env.local", lines.join("\n"));
}

async function token(params: Record<string, string>) {
  const res = await fetch(`${ACCOUNTS}?${new URLSearchParams(params)}`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
  if (!res.ok || body.error || !body.access_token) throw new Error(`Zoho token request failed: ${body.error ?? res.status}`);
  return body;
}

async function zget<T>(path: string, accessToken: string, query: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API}${path}?${new URLSearchParams(query)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
  if (!res.ok || (body.code !== undefined && body.code !== 0)) throw new Error(`GET ${path} failed (${res.status}): ${body.message ?? "unknown"}`);
  return body;
}

interface ZItem { item_id: string; name: string; sku?: string; vendor_id?: string; vendor_name?: string; status?: string }

async function main() {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET to .env.local");

  // 1. refresh token (from a fresh grant code, or the one we already have)
  let refresh = process.env.ZOHO_REFRESH_TOKEN?.trim();
  const grant = process.env.ZOHO_GRANT_CODE?.trim();
  let access: string;
  if (grant) {
    const t = await token({ code: grant, client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code" });
    if (!t.refresh_token) throw new Error("Zoho returned no refresh token — generate a new grant code and retry");
    refresh = t.refresh_token;
    access = t.access_token as string;
    setEnv({ ZOHO_REFRESH_TOKEN: refresh, ZOHO_GRANT_CODE: "" });
    console.log("✓ Exchanged grant code for a refresh token (saved to .env.local)");
  } else if (refresh) {
    access = (await token({ refresh_token: refresh, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" })).access_token as string;
    console.log("✓ Refresh token works");
  } else {
    throw new Error("Add ZOHO_GRANT_CODE (from your Self Client) to .env.local");
  }

  // 2. organization
  const orgs = await zget<{ organizations: { organization_id: string; name: string }[] }>("/organizations", access);
  let orgId = process.env.ZOHO_ORG_ID?.trim();
  if (!orgId) {
    if (orgs.organizations.length === 0) {
      throw new Error(
        "This Zoho account has no Zoho Inventory organization yet. Set one up at https://inventory.zoho.in, then run `npm run zoho:connect` again (the saved refresh token keeps working).",
      );
    }
    if (orgs.organizations.length !== 1) {
      console.log("Organizations:", orgs.organizations.map((o) => `${o.name} (${o.organization_id})`).join(", "));
      throw new Error("More than one Zoho organization — set ZOHO_ORG_ID in .env.local to the right one and re-run");
    }
    orgId = orgs.organizations[0].organization_id;
    setEnv({ ZOHO_ORG_ID: orgId });
  }
  const org = orgs.organizations.find((o) => o.organization_id === orgId);
  console.log(`✓ Organization: ${org?.name ?? "?"} (${orgId})`);

  // 3. items (paged)
  const items: ZItem[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await zget<{ items: ZItem[]; page_context?: { has_more_page?: boolean } }>("/items", access, {
      organization_id: orgId, page: String(page), per_page: "200",
    });
    items.push(...(r.items ?? []));
    if (!r.page_context?.has_more_page) break;
  }
  console.log(`✓ ${items.length} Zoho items`);

  // 4. match our SKUs
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  const { data: skus, error } = await db.from("skus").select("sku, name").order("sku");
  if (error) throw new Error(error.message);

  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const bySku = new Map(items.filter((i) => i.sku).map((i) => [norm(i.sku), i]));
  const byName = new Map(items.map((i) => [norm(i.name), i]));

  const rows: { sku: string; item: string; vendor: string; via: string }[] = [];
  let mapped = 0;
  for (const s of skus ?? []) {
    const hit = bySku.get(norm(s.sku)) ?? byName.get(norm(s.name));
    const via = hit ? (bySku.has(norm(s.sku)) ? "sku" : "name") : "—";
    let vendorId = hit?.vendor_id ?? "";
    let vendorName = hit?.vendor_name ?? "";
    if (hit && !vendorId) {
      // list responses can omit the preferred vendor; fetch the item itself
      const d = await zget<{ item: ZItem }>(`/items/${hit.item_id}`, access, { organization_id: orgId });
      vendorId = d.item.vendor_id ?? "";
      vendorName = d.item.vendor_name ?? "";
    }
    rows.push({ sku: s.sku, item: hit ? `${hit.name} (${hit.item_id})` : "NOT FOUND", vendor: vendorId ? `${vendorName} (${vendorId})` : hit ? "no preferred vendor" : "", via });
    if (!DRY) {
      const upd = await db
        .from("skus")
        .update({ zoho_item_id: hit?.item_id ?? null, vendor_id: vendorId || null })
        .eq("sku", s.sku);
      if (upd.error) throw new Error(`update ${s.sku}: ${upd.error.message}`);
    }
    if (hit && vendorId) mapped++;
  }
  console.table(rows);
  console.log(
    `${DRY ? "[dry run] would map" : "Mapped"} ${mapped}/${skus?.length ?? 0} SKUs fully.` +
      (mapped < (skus?.length ?? 0) ? " Fix the rest on the Settings page (item id + vendor id)." : ""),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
