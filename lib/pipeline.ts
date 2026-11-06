import { supabaseAdmin } from "./supabase/admin";
import { evaluateSku, parseConfig } from "./rules";
import { explainAll } from "./explain";
import { syncOpenPOs } from "./zoho";
import { addDays, istMonth, weeksBetween } from "./weeks";
import type { RecResult, RulesConfig, SkuInput, SkuRow } from "./types";

export const WINDOW_WKS = 13; // 12 weeks of averages + 1 to compare last week against the 12 before it

export interface SalesRow { week_start: string; sku: string; distributor_id: string; units: number }

/** Pure: turn raw rows into one SkuInput per SKU, aligned on the WINDOW_WKS weeks ending at latestWeek. */
export function buildInputs(args: {
  skus: Pick<SkuRow, "sku" | "perishable" | "std_qty">[];
  stock: { sku: string; on_hand: number }[];
  openPos: { sku: string; qty: number }[];
  sales: SalesRow[];
  firstWeekBySku: Record<string, string>;
  latestWeek: string | null;
}): SkuInput[] {
  const { latestWeek } = args;
  const weeks = latestWeek
    ? Array.from({ length: WINDOW_WKS }, (_, i) => addDays(latestWeek, -7 * (WINDOW_WKS - 1 - i)))
    : [];
  const weekIdx = new Map(weeks.map((w, i) => [w, i]));
  const onHand = new Map(args.stock.map((s) => [s.sku, s.on_hand]));
  const openQty = new Map<string, number>();
  for (const po of args.openPos) openQty.set(po.sku, (openQty.get(po.sku) ?? 0) + po.qty);

  const dist = new Map<string, Record<string, number[]>>();
  for (const row of args.sales) {
    const i = weekIdx.get(row.week_start);
    if (i === undefined) continue;
    const bySku = dist.get(row.sku) ?? {};
    const series = bySku[row.distributor_id] ?? new Array<number>(weeks.length).fill(0);
    series[i] += row.units;
    bySku[row.distributor_id] = series;
    dist.set(row.sku, bySku);
  }

  return args.skus.map((s) => {
    const distributors = dist.get(s.sku) ?? {};
    const totals = new Array<number>(weeks.length).fill(0);
    for (const series of Object.values(distributors)) series.forEach((u, i) => (totals[i] += u));
    const first = args.firstWeekBySku[s.sku];
    const historyWks = first && latestWeek ? weeksBetween(first, latestWeek) + 1 : 0;
    return {
      sku: s.sku,
      perishable: s.perishable,
      stdQty: s.std_qty,
      onHand: onHand.get(s.sku) ?? 0,
      openPoQty: openQty.get(s.sku) ?? 0,
      totals,
      distributors,
      historyWks,
    };
  });
}

export function computeAll(inputs: SkuInput[], cfg: RulesConfig, runMonth: number): RecResult[] {
  return inputs.map((i) => evaluateSku(i, cfg, runMonth));
}

export interface RunSummary { runId: number; count: number; byAction: Record<string, number>; poSync: string }

/** Sync open POs, compute every SKU, explain, save. Never creates POs in Zoho. */
export async function runPipeline(now = new Date()): Promise<RunSummary> {
  const db = supabaseAdmin();
  const { data: run, error: runErr } = await db.from("runs").insert({ status: "running" }).select("id").single();
  if (runErr || !run) throw new Error(`Could not create run: ${runErr?.message}`);
  const runId = run.id as number;

  try {
    const poSync = await syncOpenPOs();

    const [cfgRes, skuRes, stockRes, poRes, histRes] = await Promise.all([
      db.from("config").select("key, value"),
      db.from("skus").select("sku, perishable, std_qty"),
      db.from("stock").select("sku, on_hand"),
      db.from("open_pos").select("sku, qty"),
      db.rpc("sku_history"),
    ]);
    for (const r of [cfgRes, skuRes, stockRes, poRes, histRes]) if (r.error) throw new Error(r.error.message);

    const history = (histRes.data ?? []) as { sku: string; first_week: string; last_week: string }[];
    const latestWeek = history.reduce<string | null>((m, h) => (!m || h.last_week > m ? h.last_week : m), null);
    const firstWeekBySku = Object.fromEntries(history.map((h) => [h.sku, h.first_week]));

    let sales: SalesRow[] = [];
    if (latestWeek) {
      const win = await db.rpc("sales_window", { p_from: addDays(latestWeek, -7 * (WINDOW_WKS - 1)) });
      if (win.error) throw new Error(win.error.message);
      sales = ((win.data ?? []) as [string, string, string, number][]).map(([week_start, sku, distributor_id, units]) => ({
        week_start, sku, distributor_id, units,
      }));
    }

    const cfg = parseConfig(cfgRes.data ?? []);
    const inputs = buildInputs({
      skus: skuRes.data ?? [],
      stock: stockRes.data ?? [],
      openPos: poRes.data ?? [],
      sales,
      firstWeekBySku,
      latestWeek,
    });
    const recs = computeAll(inputs, cfg, istMonth(now));
    const reasons = await explainAll(recs);

    const rows = recs.map((r) => ({
      run_id: runId,
      sku: r.sku,
      avg4: r.avg4,
      avg12: r.avg12,
      demand: r.demand,
      cover_wks: r.coverWks,
      action: r.action,
      qty: r.qty,
      flags: r.flags,
      reason: reasons.get(r.sku) ?? null,
    }));
    if (rows.length > 0) {
      const ins = await db.from("recommendations").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }
    await db.from("runs").update({ status: "done" }).eq("id", runId);

    const byAction: Record<string, number> = {};
    for (const r of recs) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    return { runId, count: recs.length, byAction, poSync };
  } catch (err) {
    await db.from("runs").update({ status: "failed" }).eq("id", runId);
    throw err;
  }
}
