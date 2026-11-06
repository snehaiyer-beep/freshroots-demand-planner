import { describe, expect, it } from "vitest";
import {
  avgLast,
  computeDemand,
  coverWeeks,
  coverWindow,
  decideAction,
  DEFAULT_CONFIG as cfg,
  evaluateSku,
  isHighDemand,
  parseConfig,
  riskRank,
} from "@/lib/rules";
import type { SkuInput } from "@/lib/types";

const flat = (n: number, v: number) => new Array<number>(n).fill(v);

function input(over: Partial<SkuInput> = {}): SkuInput {
  return {
    sku: "S1",
    perishable: false,
    stdQty: 100,
    onHand: 1000,
    openPoQty: 0,
    totals: flat(13, 100),
    distributors: { D1: flat(13, 100) },
    historyWks: 52,
    ...over,
  };
}

describe("rule 1: averages", () => {
  it("avg4 and avg12 are means of the last 4 / 12 weeks", () => {
    const totals = [999, 10, 10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20];
    expect(avgLast(totals, 4)).toBe(20);
    expect(avgLast(totals, 12)).toBeCloseTo((8 * 10 + 4 * 20) / 12);
  });
  it("uses what exists when history is shorter", () => {
    expect(avgLast([6, 8], 4)).toBe(7);
    expect(avgLast([], 4)).toBe(0);
  });
});

describe("rule 2: festival uplift", () => {
  it("uplifts avg12 in festival months", () => {
    expect(computeDemand(100, 10, cfg)).toBe(125);
    expect(computeDemand(100, 11, cfg)).toBe(125);
    expect(computeDemand(100, 3, cfg)).toBe(125);
  });
  it("leaves demand alone in other months", () => {
    expect(computeDemand(100, 7, cfg)).toBe(100);
  });
  it("is applied before the cover check", () => {
    // 650 units / 100 = 6.5 wks (OK) normally, but / 125 = 5.2 wks (< 6) in October
    const i = input({ onHand: 650 });
    expect(evaluateSku(i, cfg, 7).action).toBe("OK");
    const oct = evaluateSku(i, cfg, 10);
    expect(oct.demand).toBe(125);
    expect(oct.action).toBe("REORDER_NOW");
    expect(oct.flags).toContain("festival");
  });
});

describe("rule 3: cover weeks", () => {
  it("counts on-hand plus open PO qty", () => {
    expect(coverWeeks(300, 100, 50)).toBe(8);
  });
  it("is infinite (null) when there is no demand", () => {
    expect(coverWeeks(300, 0, 0)).toBeNull();
  });
  it("open POs can lift a SKU out of REORDER_NOW", () => {
    expect(evaluateSku(input({ onHand: 400 }), cfg, 7).action).toBe("REORDER_NOW");
    expect(evaluateSku(input({ onHand: 400, openPoQty: 400 }), cfg, 7).action).toBe("OK");
  });
});

describe("rule 4: cover window", () => {
  it("uses min/max for normal SKUs and per_min/per_max for perishables", () => {
    expect(coverWindow(false, cfg)).toEqual({ min: 6, max: 14 });
    expect(coverWindow(true, cfg)).toEqual({ min: 3, max: 4 });
  });
  it("5 weeks of cover is low for normal SKUs but too much for perishables", () => {
    expect(evaluateSku(input({ onHand: 500 }), cfg, 7).action).toBe("REORDER_NOW");
    expect(evaluateSku(input({ onHand: 500, perishable: true }), cfg, 7).action).toBe("PAUSE");
  });
});

describe("rule 5: actions and precedence", () => {
  const base = { perishable: false, avg4: 100, avg12: 100, stdQty: 100 };
  const high = { avg4: 130, avg12: 100 };

  it("high demand means avg4 > avg12 × (1 + pct)", () => {
    expect(isHighDemand(121, 100, cfg)).toBe(true);
    expect(isHighDemand(120, 100, cfg)).toBe(false);
  });
  it("cover < min → REORDER_NOW with std_qty", () => {
    expect(decideAction({ ...base, coverWks: 5.9 }, cfg)).toEqual({ action: "REORDER_NOW", qty: 100 });
  });
  it("cover < min and high demand → REORDER_NOW with std_qty × mult", () => {
    expect(decideAction({ ...base, ...high, coverWks: 2 }, cfg)).toEqual({ action: "REORDER_NOW", qty: 150 });
  });
  it("cover > max → PAUSE with qty 0, even when demand is high", () => {
    expect(decideAction({ ...base, coverWks: 14.1 }, cfg)).toEqual({ action: "PAUSE", qty: 0 });
    expect(decideAction({ ...base, ...high, coverWks: 20 }, cfg)).toEqual({ action: "PAUSE", qty: 0 });
  });
  it("infinite cover → PAUSE", () => {
    expect(decideAction({ ...base, coverWks: null }, cfg).action).toBe("PAUSE");
  });
  it("in window and high demand → REORDER_HIGH with std_qty × mult", () => {
    expect(decideAction({ ...base, ...high, coverWks: 8 }, cfg)).toEqual({ action: "REORDER_HIGH", qty: 150 });
  });
  it("in window, normal demand → OK", () => {
    expect(decideAction({ ...base, coverWks: 8 }, cfg)).toEqual({ action: "OK", qty: 0 });
  });
  it("window edges are inclusive (min and max are OK)", () => {
    expect(decideAction({ ...base, coverWks: 6 }, cfg).action).toBe("OK");
    expect(decideAction({ ...base, coverWks: 14 }, cfg).action).toBe("OK");
  });
  it("rounds boosted qty up", () => {
    expect(decideAction({ ...base, ...high, stdQty: 75, coverWks: 8 }, cfg).qty).toBe(113);
  });
});

describe("evaluateSku", () => {
  it("exceptions win over every rule and null the qty", () => {
    const r = evaluateSku(input({ onHand: 0, historyWks: 5 }), cfg, 7);
    expect(r.action).toBe("EXCEPTION");
    expect(r.qty).toBeNull();
    expect(r.flags).toContain("new_launch");
    // numbers are still computed for display
    expect(r.avg12).toBe(100);
  });
});

describe("parseConfig", () => {
  it("reads typed thresholds and falls back on bad values", () => {
    const c = parseConfig([
      { key: "min_wks", value: "5" },
      { key: "high_demand_mult", value: "abc" },
      { key: "festival_months", value: "1, 2,13" },
      { key: "push_mode", value: "issued" },
    ]);
    expect(c.minWks).toBe(5);
    expect(c.highDemandMult).toBe(1.5);
    expect(c.festivalMonths).toEqual([1, 2]);
    expect(c.pushMode).toBe("issued");
    expect(parseConfig([]).pushMode).toBe("draft");
  });
});

describe("riskRank", () => {
  it("orders exceptions, then reorders by lowest cover, then OK, then PAUSE", () => {
    const rows = [
      { a: "OK", c: 8 },
      { a: "REORDER_NOW", c: 4 },
      { a: "PAUSE", c: 30 },
      { a: "REORDER_NOW", c: 1 },
      { a: "EXCEPTION", c: 9 },
      { a: "REORDER_HIGH", c: 7 },
    ] as const;
    const sorted = [...rows].sort((x, y) => riskRank(x.a, x.c) - riskRank(y.a, y.c)).map((r) => `${r.a}:${r.c}`);
    expect(sorted).toEqual(["EXCEPTION:9", "REORDER_NOW:1", "REORDER_NOW:4", "REORDER_HIGH:7", "OK:8", "PAUSE:30"]);
  });
});
