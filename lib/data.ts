import { supabaseAdmin } from "./supabase/admin";
import { addDays } from "./weeks";
import type { RecRow, SkuRow } from "./types";

export type RecWithSku = RecRow & { skus: Pick<SkuRow, "name" | "perishable" | "zoho_item_id" | "vendor_id"> | null };

export interface RunRow { id: number; created_at: string; status: string }

export async function latestRun(): Promise<RunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("runs")
    .select("*")
    .eq("status", "done")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RunRow | null) ?? null;
}

export async function recsForRun(runId: number, onlyExceptions = false): Promise<RecWithSku[]> {
  let q = supabaseAdmin()
    .from("recommendations")
    .select("*, skus(name, perishable, zoho_item_id, vendor_id)")
    .eq("run_id", runId);
  if (onlyExceptions) q = q.eq("action", "EXCEPTION");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...(r as RecWithSku),
    avg4: Number(r.avg4),
    avg12: Number(r.avg12),
    demand: Number(r.demand),
    cover_wks: r.cover_wks === null ? null : Number(r.cover_wks),
  }));
}

/** Latest week with any sales. */
export async function latestSalesWeek(): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("weekly_sales")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.week_start as string | undefined) ?? null;
}

/** sku → week_start → total units, for weeks in [from, to]. */
export async function weeklyTotals(from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const { data, error } = await supabaseAdmin().rpc("totals_window", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const out = new Map<string, Map<string, number>>();
  for (const [week, sku, units] of (data ?? []) as [string, string, number][]) {
    const m = out.get(sku) ?? new Map<string, number>();
    m.set(week, units);
    out.set(sku, m);
  }
  return out;
}

/** Last 12 weekly totals per SKU (oldest → newest), zero-filled. */
export async function last12Weeks(): Promise<{ weeks: string[]; bySku: Map<string, number[]> }> {
  const latest = await latestSalesWeek();
  if (!latest) return { weeks: [], bySku: new Map() };
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(latest, -7 * (11 - i)));
  const totals = await weeklyTotals(weeks[0], latest);
  const bySku = new Map<string, number[]>();
  for (const [sku, m] of totals) bySku.set(sku, weeks.map((w) => m.get(w) ?? 0));
  return { weeks, bySku };
}
