import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { apiUser, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await apiUser())) return jsonError("Unauthorized", 401);
  try {
    const body = (await req.json()) as { sku?: unknown; zoho_item_id?: unknown; vendor_id?: unknown };
    if (typeof body.sku !== "string" || !body.sku) return jsonError("sku is required");
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const { error } = await supabaseAdmin()
      .from("skus")
      .update({ zoho_item_id: clean(body.zoho_item_id), vendor_id: clean(body.vendor_id) })
      .eq("sku", body.sku);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("sku mapping failed", err);
    return jsonError((err as Error).message, 500);
  }
}
