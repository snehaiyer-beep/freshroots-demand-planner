import type { Action, AppConfig, RecResult, RulesConfig, SkuInput } from "./types";
import { detectExceptions } from "./exceptions";

export const DEFAULT_CONFIG: AppConfig = {
  highDemandPct: 20,
  highDemandMult: 1.5,
  minWks: 6,
  maxWks: 14,
  perMinWks: 3,
  perMaxWks: 4,
  festivalUplift: 25,
  festivalMonths: [10, 11, 3],
  swingPct: 40,
  minHistoryWks: 12,
  pushMode: "draft",
};

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) ? n : fallback;
}

/** Turn config table rows into typed thresholds; bad or missing values fall back to defaults. */
export function parseConfig(rows: { key: string; value: string }[]): AppConfig {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const d = DEFAULT_CONFIG;
  const months = (m.get("festival_months") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  return {
    highDemandPct: num(m.get("high_demand_pct"), d.highDemandPct),
    highDemandMult: num(m.get("high_demand_mult"), d.highDemandMult),
    minWks: num(m.get("min_wks"), d.minWks),
    maxWks: num(m.get("max_wks"), d.maxWks),
    perMinWks: num(m.get("per_min_wks"), d.perMinWks),
    perMaxWks: num(m.get("per_max_wks"), d.perMaxWks),
    festivalUplift: num(m.get("festival_uplift"), d.festivalUplift),
    festivalMonths: m.has("festival_months") ? months : d.festivalMonths,
    swingPct: num(m.get("swing_pct"), d.swingPct),
    minHistoryWks: num(m.get("min_history_wks"), d.minHistoryWks),
    pushMode: m.get("push_mode") === "issued" ? "issued" : "draft",
  };
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Rule 1: mean weekly units over the last n weeks (fewer if less history exists). */
export function avgLast(totals: number[], n: number): number {
  return mean(totals.slice(-n));
}

export function isFestivalMonth(month: number, cfg: RulesConfig): boolean {
  return cfg.festivalMonths.includes(month);
}

/** Rule 2: demand = avg12, uplifted in festival months. */
export function computeDemand(avg12: number, month: number, cfg: RulesConfig): number {
  return isFestivalMonth(month, cfg) ? avg12 * (1 + cfg.festivalUplift / 100) : avg12;
}

/** Rule 3: weeks of cover. null when there is no demand (infinite cover). */
export function coverWeeks(onHand: number, openPoQty: number, demand: number): number | null {
  if (demand <= 0) return null;
  return (onHand + openPoQty) / demand;
}

/** Rule 4: cover window in weeks. */
export function coverWindow(perishable: boolean, cfg: RulesConfig): { min: number; max: number } {
  return perishable ? { min: cfg.perMinWks, max: cfg.perMaxWks } : { min: cfg.minWks, max: cfg.maxWks };
}

export function isHighDemand(avg4: number, avg12: number, cfg: RulesConfig): boolean {
  return avg4 > avg12 * (1 + cfg.highDemandPct / 100);
}

/** Rule 5: precedence REORDER_NOW > PAUSE > REORDER_HIGH > OK. */
export function decideAction(
  p: { coverWks: number | null; perishable: boolean; avg4: number; avg12: number; stdQty: number },
  cfg: RulesConfig,
): { action: Exclude<Action, "EXCEPTION">; qty: number } {
  const win = coverWindow(p.perishable, cfg);
  const high = isHighDemand(p.avg4, p.avg12, cfg);
  const boosted = Math.ceil(p.stdQty * cfg.highDemandMult);
  const cover = p.coverWks ?? Number.POSITIVE_INFINITY;

  if (cover < win.min) return { action: "REORDER_NOW", qty: high ? boosted : p.stdQty };
  if (cover > win.max) return { action: "PAUSE", qty: 0 };
  if (high) return { action: "REORDER_HIGH", qty: boosted };
  return { action: "OK", qty: 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Full evaluation of one SKU: exceptions first, then the rules. */
export function evaluateSku(input: SkuInput, cfg: RulesConfig, runMonth: number): RecResult {
  const avg4 = avgLast(input.totals, 4);
  const avg12 = avgLast(input.totals, 12);
  const demand = computeDemand(avg12, runMonth, cfg);
  const cover = coverWeeks(input.onHand, input.openPoQty, demand);
  const festivalFlags = isFestivalMonth(runMonth, cfg) ? ["festival"] : [];

  const base = {
    sku: input.sku,
    avg4: round2(avg4),
    avg12: round2(avg12),
    demand: round2(demand),
    coverWks: cover === null ? null : round2(cover),
  };

  const exceptionFlags = detectExceptions(input, cfg);
  if (exceptionFlags.length > 0) {
    return { ...base, action: "EXCEPTION", qty: null, flags: [...exceptionFlags, ...festivalFlags] };
  }

  const { action, qty } = decideAction(
    { coverWks: cover, perishable: input.perishable, avg4, avg12, stdQty: input.stdQty },
    cfg,
  );
  return { ...base, action, qty, flags: festivalFlags };
}

/** Lower = more urgent. Used to sort the dashboard by risk. */
export function riskRank(action: Action, coverWks: number | null): number {
  const order: Record<Action, number> = { EXCEPTION: 0, REORDER_NOW: 1, REORDER_HIGH: 2, PAUSE: 4, OK: 3 };
  const cover = coverWks ?? 9999;
  return order[action] * 10000 + Math.min(cover, 9999);
}
