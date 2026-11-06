import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateSales, validateStock } from "@/lib/csv";
import { apiUser, jsonError } from "@/lib/api";
import { toISODate } from "@/lib/weeks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await apiUser())) return jsonError("Unauthorized", 401);
  try {
    const form = await req.formData();
    const kind = form.get("kind");
    const file = form.get("file");
    if (kind !== "sales" && kind !== "stock") return jsonError("kind must be sales or stock");
    if (!(file instanceof File)) return jsonError("Attach a CSV file");
    const text = await file.text();

    const db = supabaseAdmin();
    const { data: skuRows, error } = await db.from("skus").select("sku");
    if (error) throw new Error(error.message);
    const known = new Set((skuRows ?? []).map((s) => s.sku as string));

    if (kind === "sales") {
      const { rows, errors } = validateSales(text, known);
      for (let i = 0; i < rows.length; i += 1000) {
        const up = await db
          .from("weekly_sales")
          .upsert(rows.slice(i, i + 1000), { onConflict: "week_start,sku,distributor_id" });
        if (up.error) throw new Error(up.error.message);
      }
      return NextResponse.json({ kind, upserted: rows.length, errors });
    }

    const { rows, errors } = validateStock(text, known);
    const asOf = toISODate(new Date());
    if (rows.length) {
      const up = await db.from("stock").upsert(rows.map((r) => ({ ...r, as_of: asOf })), { onConflict: "sku" });
      if (up.error) throw new Error(up.error.message);
    }
    return NextResponse.json({ kind, upserted: rows.length, errors });
  } catch (err) {
    console.error("upload failed", err);
    return jsonError((err as Error).message, 500);
  }
}
