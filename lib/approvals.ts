import { supabaseAdmin } from "./supabase/admin";
import { pushPOs, type PushResult } from "./zoho";
import { OVERRIDE_REASONS, type RecRow, type SkuRow } from "./types";

export type Decision =
  | { kind: "approve" }
  | { kind: "edit"; qty: number; reason: string; note?: string }
  | { kind: "reject"; note?: string };

export function isMapped(sku: Pick<SkuRow, "zoho_item_id" | "vendor_id"> | undefined): boolean {
  return Boolean(sku?.zoho_item_id?.trim() && sku?.vendor_id?.trim());
}

/** Pure check: null if the decision may be applied, otherwise the reason it is blocked. */
export function checkDecision(
  rec: Pick<RecRow, "action" | "qty" | "zoho_po_id">,
  sku: Pick<SkuRow, "zoho_item_id" | "vendor_id"> | undefined,
  d: Decision,
): string | null {
  if (rec.zoho_po_id) return "Already pushed to Zoho";
  if (d.kind === "reject") return null;
  if (d.kind === "edit") {
    if (!Number.isInteger(d.qty) || d.qty < 0) return "Quantity must be a whole number ≥ 0";
    if (!(OVERRIDE_REASONS as readonly string[]).includes(d.reason)) return "Pick an override reason";
  }
  if (d.kind === "approve" && rec.qty === null) return "Set a quantity first (exception)";
  const finalQty = d.kind === "edit" ? d.qty : rec.qty ?? 0;
  if (finalQty > 0 && !isMapped(sku)) return "Map in Zoho first (missing item or vendor id)";
  return null;
}

export interface DecisionResult {
  applied: number[];
  blocked: { id: number; sku: string; message: string }[];
  push: PushResult;
}

/** Apply a decision to recommendations, then push approved lines to Zoho. Zoho errors never undo approval. */
export async function applyDecision(ids: number[], d: Decision, email: string): Promise<DecisionResult> {
  const db = supabaseAdmin();
  const empty: PushResult = { pushed: 0, failed: 0, skipped: 0, errors: [] };

  const { data: recs, error } = await db.from("recommendations").select("*").in("id", ids);
  if (error) throw new Error(error.message);
  const recRows = (recs ?? []) as RecRow[];
  const { data: skuRows, error: skuErr } = await db.from("skus").select("*").in("sku", recRows.map((r) => r.sku));
  if (skuErr) throw new Error(skuErr.message);
  const skuMap = new Map(((skuRows ?? []) as SkuRow[]).map((s) => [s.sku, s]));

  const applied: number[] = [];
  const blocked: DecisionResult["blocked"] = [];
  const now = new Date().toISOString();

  for (const rec of recRows) {
    const problem = checkDecision(rec, skuMap.get(rec.sku), d);
    if (problem) {
      blocked.push({ id: rec.id, sku: rec.sku, message: problem });
      continue;
    }
    const patch =
      d.kind === "reject"
        ? { status: "rejected", final_qty: null, override_reason: d.note ?? null, approved_by: email, approved_at: now }
        : d.kind === "edit"
          ? { status: "edited", final_qty: d.qty, override_reason: d.note ? `${d.reason}: ${d.note}` : d.reason, approved_by: email, approved_at: now }
          : { status: "approved", final_qty: rec.qty, override_reason: null, approved_by: email, approved_at: now };
    const upd = await db.from("recommendations").update(patch).eq("id", rec.id).is("zoho_po_id", null);
    if (upd.error) blocked.push({ id: rec.id, sku: rec.sku, message: upd.error.message });
    else applied.push(rec.id);
  }

  if (d.kind === "reject" || applied.length === 0) return { applied, blocked, push: empty };
  const push = await pushPOs(applied); // never throws
  return { applied, blocked, push };
}
