import { describe, expect, it } from "vitest";
import { detectExceptions, isNewLaunch, isNewProduct, lastWeekZ, NEW_PRODUCT_FLAG, swingingDistributors } from "@/lib/exceptions";
import { DEFAULT_CONFIG as cfg, evaluateSku } from "@/lib/rules";
import type { SkuInput } from "@/lib/types";

const flat = (n: number, v: number) => new Array<number>(n).fill(v);
/** 12 noisy weeks around 100 (sd ≈ 10) followed by `last`. */
const noisy = (last: number) => [90, 110, 90, 110, 90, 110, 90, 110, 90, 110, 90, 110, last];

function input(over: Partial<SkuInput> = {}): SkuInput {
  return {
    sku: "S1",
    perishable: false,
    stdQty: 100,
    onHand: 800,
    openPoQty: 0,
    totals: noisy(100),
    distributors: { D1: noisy(100) },
    historyWks: 52,
    ...over,
  };
}

describe("new launch", () => {
  it("flags history shorter than min_history_wks", () => {
    expect(isNewLaunch(11, cfg)).toBe(true);
    expect(isNewLaunch(12, cfg)).toBe(false);
    expect(detectExceptions(input({ historyWks: 8 }), cfg)).toEqual(["new_launch"]);
  });
});

describe("new product (no sales at all)", () => {
  it("gets its own flag and note so Raghav sets the first order", () => {
    const i = input({ historyWks: 0, totals: flat(13, 0), distributors: {} });
    expect(isNewProduct(i)).toBe(true);
    expect(detectExceptions(i, cfg)).toEqual([NEW_PRODUCT_FLAG]);
    const r = evaluateSku(i, cfg, 7);
    expect(r.action).toBe("EXCEPTION");
    expect(r.qty).toBeNull();
    expect(r.coverWks).toBeNull();
  });
});

describe("distributor swing", () => {
  it("flags a ≥5% distributor whose last week moves more than swing_pct", () => {
    const big = [...flat(12, 100), 150]; // +50%
    const small = flat(13, 900);
    const totals = big.map((v, i) => v + small[i]);
    expect(swingingDistributors(totals, { BIG: big, SMALL: small }, cfg)).toEqual(["BIG"]);
    expect(detectExceptions(input({ totals, distributors: { BIG: big, SMALL: small } }), cfg)).toContain("distributor_swing:BIG");
  });
  it("catches drops as well as spikes", () => {
    const d = [...flat(12, 100), 50];
    expect(swingingDistributors(d, { D: d }, cfg)).toEqual(["D"]);
  });
  it("ignores swings of exactly swing_pct or less", () => {
    const d = [...flat(12, 100), 140];
    expect(swingingDistributors(d, { D: d }, cfg)).toEqual([]);
  });
  it("ignores distributors under 5% of SKU volume", () => {
    const tiny = [...flat(12, 2), 20]; // 10x spike but ~3.4% share
    const big = flat(13, 100);
    const totals = big.map((v, i) => v + tiny[i]);
    expect(swingingDistributors(totals, { TINY: tiny, BIG: big }, cfg)).toEqual([]);
  });
});

describe("anomaly (z-score)", () => {
  it("computes z of last week vs the 12 before it", () => {
    expect(lastWeekZ(noisy(130))).toBeCloseTo(3);
    expect(lastWeekZ(flat(13, 5))).toBe(0); // zero variance → no z
  });
  it("flags |z| > 3", () => {
    const totals = noisy(140); // z = 4
    const flags = detectExceptions(input({ totals, distributors: { A: totals.map((v) => v / 4), B: totals.map((v) => v / 4), C: totals.map((v) => v / 4), D: totals.map((v) => v / 4) } }), cfg);
    expect(flags).toContain("anomaly");
  });
  it("does not flag z of 3 or less", () => {
    const flags = detectExceptions(input({ totals: noisy(125), distributors: {} }), cfg);
    expect(flags).not.toContain("anomaly");
  });
});

describe("exceptions are checked first", () => {
  it("collects every flag and overrides an otherwise-REORDER_NOW SKU", () => {
    const totals = noisy(300);
    const r = evaluateSku(input({ onHand: 0, historyWks: 6, totals, distributors: { D1: totals } }), cfg, 7);
    expect(r.action).toBe("EXCEPTION");
    expect(r.qty).toBeNull();
    expect(r.flags).toEqual(["new_launch", "distributor_swing:D1", "anomaly"]);
  });
  it("a clean SKU has no exception flags", () => {
    expect(detectExceptions(input(), cfg)).toEqual([]);
  });
});
