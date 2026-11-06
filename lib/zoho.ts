import { supabaseAdmin } from "./supabase/admin";
import type { RecRow, SkuRow } from "./types";

const BASE = "https://www.zohoapis.in/inventory/v1";
const TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";

export function zohoMockMode(): boolean {
  return !(
    process.env.ZOHO_CLIENT_ID &&
    process.env.ZOHO_CLIENT_SECRET &&
    process.env.ZOHO_REFRESH_TOKEN &&
    process.env.ZOHO_ORG_ID
  );
}

// ---------- OAuth (access token cached per server instance) ----------
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? "",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  });
  const res = await fetch(`${TOKEN_URL}?${params}`, { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Zoho token refresh failed: ${body.error ?? res.status}`);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

async function zoho<T>(method: "GET" | "POST", path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ organization_id: process.env.ZOHO_ORG_ID ?? "", ...query });
  const res = await fetch(`${BASE}${path}?${qs}`, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Zoho-oauthtoken ${await accessToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
  if (!res.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(`Zoho ${method} ${path} failed (${res.status}): ${json.message ?? "unknown error"}`);
  }
  return json;
}

// ---------- links + display ----------

/** Deep link to a PO in the Zoho Inventory web app (null for mock IDs or mock mode). */
export function zohoPoUrl(poId: string | null | undefined, orgId = process.env.ZOHO_ORG_ID): string | null {
  if (!poId || !orgId || poId.startsWith("MOCK-")) return null;
  return `https://inventory.zoho.in/app/${orgId}#/purchaseorders/${poId}`;
}

export interface ZohoPoInfo { number: string; status: string; vendor: string }

/** Zoho PO number/status/vendor for every PO in the org, keyed by purchaseorder_id. Empty on failure or mock mode. */
export async function zohoPoInfo(): Promise<Map<string, ZohoPoInfo>> {
  const out = new Map<string, ZohoPoInfo>();
  if (zohoMockMode()) return out;
  try {
    for (let page = 1; page < 20; page++) {
      const list = await zoho<{
        purchaseorders: { purchaseorder_id: string; purchaseorder_number: string; status: string; vendor_name: string }[];
        page_context?: { has_more_page?: boolean };
      }>("GET", "/purchaseorders", undefined, { filter_by: "Status.All", page: String(page), per_page: "200" });
      for (const p of list.purchaseorders ?? []) {
        out.set(p.purchaseorder_id, { number: p.purchaseorder_number, status: p.status, vendor: p.vendor_name });
      }
      if (!list.page_context?.has_more_page) break;
    }
  } catch (err) {
    console.error("zohoPoInfo failed", err);
  }
  return out;
}

/** Name of the connected Zoho Inventory organization, or null. */
export async function zohoOrgName(): Promise<string | null> {
  if (zohoMockMode()) return null;
  try {
    const r = await zoho<{ organizations: { organization_id: string; name: string }[] }>("GET", "/organizations");
    return r.organizations.find((o) => o.organization_id === process.env.ZOHO_ORG_ID)?.name ?? null;
  } catch (err) {
    console.error("zohoOrgName failed", err);
    return null;
  }
}

// ---------- open POs ----------
interface ZohoPoSummary { purchaseorder_id: string; delivery_date?: string; status?: string }
interface ZohoLine { line_item_id: string; item_id: string; quantity: number; quantity_received?: number }

export interface OpenPoLine { id: string; sku: string; qty: number; eta: string | null }

/**
 * POs whose stock is still to arrive. Zoho Inventory has no "open" status (filter_by=Status.Open is rejected),
 * so we list all POs and keep these. Drafts count too: a draft the planner just pushed is already an
 * approved order, and ignoring it would make the next run recommend the same order again.
 */
const OPEN_PO_STATUSES = new Set(["draft", "issued", "open", "partially_received", "pending_approval", "approved"]);

export function isOpenPoStatus(status: string | undefined): boolean {
  return OPEN_PO_STATUSES.has((status ?? "").toLowerCase());
}

/** Fetch open Zoho POs and map their lines to SKUs. Returns null in mock mode (existing rows are kept). */
export async function getOpenPOs(): Promise<OpenPoLine[] | null> {
  if (zohoMockMode()) return null;
  const { data: skus, error } = await supabaseAdmin().from("skus").select("sku, zoho_item_id");
  if (error) throw new Error(`load skus: ${error.message}`);
  const skuByItem = new Map((skus ?? []).filter((s) => s.zoho_item_id).map((s) => [s.zoho_item_id as string, s.sku as string]));

  const lines: OpenPoLine[] = [];
  for (let page = 1; page < 50; page++) {
    const list = await zoho<{ purchaseorders: ZohoPoSummary[]; page_context?: { has_more_page?: boolean } }>(
      "GET", "/purchaseorders", undefined, { filter_by: "Status.All", page: String(page), per_page: "200" },
    );
    for (const po of (list.purchaseorders ?? []).filter((p) => isOpenPoStatus(p.status))) {
      const detail = await zoho<{ purchaseorder: { line_items: ZohoLine[]; delivery_date?: string } }>(
        "GET", `/purchaseorders/${po.purchaseorder_id}`,
      );
      for (const li of detail.purchaseorder.line_items ?? []) {
        const sku = skuByItem.get(li.item_id);
        const open = Math.max(0, (li.quantity ?? 0) - (li.quantity_received ?? 0));
        if (sku && open > 0) {
          lines.push({ id: `${po.purchaseorder_id}:${li.line_item_id}`, sku, qty: open, eta: detail.purchaseorder.delivery_date || po.delivery_date || null });
        }
      }
    }
    if (!list.page_context?.has_more_page) break;
  }
  return lines;
}

/** Replace open_pos with what Zoho reports. Returns a short status message. */
export async function syncOpenPOs(): Promise<string> {
  try {
    const lines = await getOpenPOs();
    if (lines === null) return "Zoho mock mode: kept existing open POs";
    const db = supabaseAdmin();
    const del = await db.from("open_pos").delete().neq("id", "");
    if (del.error) throw new Error(del.error.message);
    if (lines.length > 0) {
      const ins = await db.from("open_pos").insert(lines);
      if (ins.error) throw new Error(ins.error.message);
    }
    return `Synced ${lines.length} open PO lines from Zoho`;
  } catch (err) {
    console.error("syncOpenPOs failed", err);
    return `Open PO sync failed, using last known open POs: ${(err as Error).message}`;
  }
}

// ---------- push approved POs ----------
export interface PushResult { pushed: number; failed: number; skipped: number; errors: string[] }

/**
 * Push approved/edited recommendations to Zoho as draft POs (one per run + vendor).
 * Idempotent: recs that already have a zoho_po_id are skipped. Never throws.
 */
export async function pushPOs(recIds: number[]): Promise<PushResult> {
  const result: PushResult = { pushed: 0, failed: 0, skipped: 0, errors: [] };
  if (recIds.length === 0) return result;
  const db = supabaseAdmin();

  try {
    const [{ data: recs, error: recErr }, { data: cfgRows }] = await Promise.all([
      db.from("recommendations").select("*").in("id", recIds),
      db.from("config").select("value").eq("key", "push_mode").maybeSingle(),
    ]);
    if (recErr) throw new Error(recErr.message);
    const pushMode = cfgRows?.value === "issued" ? "issued" : "draft";

    const ready = ((recs ?? []) as RecRow[]).filter(
      (r) => !r.zoho_po_id && (r.status === "approved" || r.status === "edited") && (r.final_qty ?? 0) > 0,
    );
    result.skipped = recIds.length - ready.length;
    if (ready.length === 0) return result;

    const { data: skuRows, error: skuErr } = await db.from("skus").select("*").in("sku", ready.map((r) => r.sku));
    if (skuErr) throw new Error(skuErr.message);
    const skuMap = new Map(((skuRows ?? []) as SkuRow[]).map((s) => [s.sku, s]));

    const groups = new Map<string, RecRow[]>();
    for (const r of ready) {
      const s = skuMap.get(r.sku);
      if (!s?.zoho_item_id || !s.vendor_id) {
        await markFailed(db, [r], "SKU not mapped to a Zoho item/vendor");
        result.failed++;
        continue;
      }
      const key = `${r.run_id}|${s.vendor_id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    for (const [key, group] of groups) {
      const [runId, vendorId] = key.split("|");
      try {
        const poId = await createPurchaseOrder(runId, vendorId, group, skuMap, pushMode);
        let issueError: string | null = null;
        if (pushMode === "issued" && !zohoMockMode()) {
          try {
            await zoho("POST", `/purchaseorders/${poId}/status/issued`);
          } catch (err) {
            issueError = `PO created as draft but could not be issued: ${(err as Error).message}`;
          }
        }
        const upd = await db
          .from("recommendations")
          .update({ zoho_po_id: poId, push_status: "sent", push_error: issueError })
          .in("id", group.map((r) => r.id));
        if (upd.error) throw new Error(`PO ${poId} created but saving failed: ${upd.error.message}`);
        const log = await db.from("po_log").insert(
          group.map((r) => ({ rec_id: r.id, zoho_po_id: poId, qty: r.final_qty, approved_by: r.approved_by })),
        );
        if (log.error) console.error("po_log insert failed", log.error);
        result.pushed += group.length;
      } catch (err) {
        const msg = (err as Error).message;
        await markFailed(db, group, msg);
        result.failed += group.length;
        result.errors.push(msg);
      }
    }
  } catch (err) {
    console.error("pushPOs failed", err);
    result.errors.push((err as Error).message);
  }
  return result;
}

async function createPurchaseOrder(
  runId: string,
  vendorId: string,
  group: RecRow[],
  skuMap: Map<string, SkuRow>,
  pushMode: string,
): Promise<string> {
  if (zohoMockMode()) {
    return `MOCK-PO-${runId}-${vendorId}-${Date.now().toString(36)}${pushMode === "issued" ? "-ISSUED" : ""}`;
  }
  const res = await zoho<{ purchaseorder: { purchaseorder_id: string } }>("POST", "/purchaseorders", {
    vendor_id: vendorId,
    reference_number: `FR-${runId}-${vendorId}`,
    line_items: group.map((r) => ({ item_id: skuMap.get(r.sku)?.zoho_item_id, quantity: r.final_qty })),
  });
  return res.purchaseorder.purchaseorder_id;
}

async function markFailed(db: ReturnType<typeof supabaseAdmin>, recs: RecRow[], message: string) {
  try {
    await db.from("recommendations").update({ push_status: "failed", push_error: message }).in("id", recs.map((r) => r.id));
  } catch (err) {
    console.error("markFailed failed", err);
  }
}
