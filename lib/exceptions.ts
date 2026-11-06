import type { RulesConfig, SkuInput } from "./types";

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Split a series into the 12 weeks before last week, and last week. */
function split(series: number[]): { prev12: number[]; last: number } {
  return { prev12: series.slice(-13, -1), last: series[series.length - 1] ?? 0 };
}

export const NEW_PRODUCT_FLAG = "new_product";
export const NEW_PRODUCT_NOTE = "New product — no demand history yet. Raghav to set the first order quantity.";

export function isNewProduct(input: Pick<SkuInput, "historyWks">): boolean {
  return input.historyWks <= 0;
}

export function isNewLaunch(historyWks: number, cfg: RulesConfig): boolean {
  return historyWks < cfg.minHistoryWks;
}

/**
 * Distributors holding ≥5% of the SKU's 12-week volume whose last week deviates more than
 * swing_pct from their own average of the 12 weeks before it.
 */
export function swingingDistributors(
  totals: number[],
  distributors: Record<string, number[]>,
  cfg: RulesConfig,
): string[] {
  const skuVolume = totals.slice(-12).reduce((a, b) => a + b, 0);
  if (skuVolume <= 0) return [];
  const hits: string[] = [];
  for (const [id, series] of Object.entries(distributors)) {
    const share = series.slice(-12).reduce((a, b) => a + b, 0) / skuVolume;
    if (share < 0.05) continue;
    const { prev12, last } = split(series);
    const own = mean(prev12);
    if (own <= 0) continue;
    if ((Math.abs(last - own) * 100) / own > cfg.swingPct) hits.push(id);
  }
  return hits.sort();
}

/** z-score of last week's total against the 12 weeks before it (population SD). */
export function lastWeekZ(totals: number[]): number {
  const { prev12, last } = split(totals);
  if (prev12.length < 2) return 0;
  const m = mean(prev12);
  const sd = Math.sqrt(mean(prev12.map((x) => (x - m) ** 2)));
  if (sd === 0) return 0;
  return (last - m) / sd;
}

/** Returns exception flags; empty array = no exception. */
export function detectExceptions(input: SkuInput, cfg: RulesConfig): string[] {
  const flags: string[] = [];
  // No sales at all: a brand-new product whose demand we cannot estimate yet.
  if (isNewProduct(input)) return [NEW_PRODUCT_FLAG];
  if (isNewLaunch(input.historyWks, cfg)) flags.push("new_launch");
  for (const id of swingingDistributors(input.totals, input.distributors, cfg)) {
    flags.push(`distributor_swing:${id}`);
  }
  if (Math.abs(lastWeekZ(input.totals)) > 3) flags.push("anomaly");
  return flags;
}
