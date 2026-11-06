import { addDays, mondayOf } from "./weeks";

export interface AccuracyRecInput {
  run_id: number;
  run_created_at: string;
  sku: string;
  demand: number;
  cover_wks: number | null;
  qty: number | null;
  final_qty: number | null;
  status: string;
}

export interface AccuracyRow {
  run_id: number;
  sku: string;
  predicted: number;
  actual: number;
  errorPct: number | null;
  override: "beat" | "lost" | "tie" | null;
}

export interface AccuracySummary {
  rows: AccuracyRow[];
  avgErrorPct: number | null;
  overrides: number;
  overridesBeatRule: number;
}

/**
 * Compare predicted demand × 4 with actual units in the 4 weeks starting the run's week.
 * An override "beats" the rule when its qty is closer to what was actually needed:
 * needed = max(0, actual − supply at run time), where supply = cover_wks × demand.
 */
export function computeAccuracy(
  recs: AccuracyRecInput[],
  totals: Map<string, Map<string, number>>, // sku → week_start → units
  latestWeek: string | null,
): AccuracySummary {
  const rows: AccuracyRow[] = [];
  for (const r of recs) {
    const start = mondayOf(r.run_created_at.slice(0, 10));
    const weeks = [0, 1, 2, 3].map((i) => addDays(start, 7 * i));
    if (!latestWeek || weeks[3] > latestWeek) continue; // actuals not in yet
    const bySku = totals.get(r.sku);
    const actual = weeks.reduce((sum, w) => sum + (bySku?.get(w) ?? 0), 0);
    const predicted = Math.round(r.demand * 4);
    const errorPct = actual > 0 ? (Math.abs(predicted - actual) / actual) * 100 : null;

    let override: AccuracyRow["override"] = null;
    if (r.status === "edited" && r.qty !== null && r.final_qty !== null && r.final_qty !== r.qty && r.cover_wks !== null) {
      const needed = Math.max(0, actual - r.cover_wks * r.demand);
      const ruleGap = Math.abs(r.qty - needed);
      const overrideGap = Math.abs(r.final_qty - needed);
      override = overrideGap < ruleGap ? "beat" : overrideGap > ruleGap ? "lost" : "tie";
    }
    rows.push({ run_id: r.run_id, sku: r.sku, predicted, actual, errorPct, override });
  }
  const errs = rows.map((r) => r.errorPct).filter((e): e is number => e !== null);
  return {
    rows,
    avgErrorPct: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    overrides: rows.filter((r) => r.override !== null).length,
    overridesBeatRule: rows.filter((r) => r.override === "beat").length,
  };
}
