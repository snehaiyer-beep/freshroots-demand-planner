import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedFromCsv, syntheticSeed, type SeedData } from "../scripts/seedData";
import { buildInputs, computeAll } from "@/lib/pipeline";
import { DEFAULT_CONFIG } from "@/lib/rules";
import type { RecResult } from "@/lib/types";

function evaluate(d: SeedData, month: number): RecResult[] {
  const first: Record<string, string> = {};
  let latest: string | null = null;
  for (const s of d.sales) {
    if (!first[s.sku] || s.week_start < first[s.sku]) first[s.sku] = s.week_start;
    if (!latest || s.week_start > latest) latest = s.week_start;
  }
  const inputs = buildInputs({ skus: d.skus, stock: d.stock, openPos: d.openPos, sales: d.sales, firstWeekBySku: first, latestWeek: latest });
  return computeAll(inputs, DEFAULT_CONFIG, month);
}

describe("CSV seed (data/*.csv)", () => {
  const f = (n: string) => readFileSync(path.join(__dirname, "..", "data", n), "utf8");
  const data = seedFromCsv({
    skuMaster: f("sku_master.csv"),
    weeklySales: f("weekly_sales.csv"),
    inventory: f("current_inventory.csv"),
    calendar: f("calendar.csv"),
  });

  it("loads 16 SKUs with ISO weeks converted to Mondays", () => {
    expect(data.skus).toHaveLength(16);
    expect(data.sales[0].week_start).toBe("2026-06-29");
    expect(data.festivalMonths).toEqual([3, 10, 11]);
    expect(data.skus.filter((s) => s.perishable).map((s) => s.sku)).toEqual(["SKU004", "SKU007", "SKU011"]);
  });

  it("SKU016 is a new product with no demand and goes to Raghav as an exception", () => {
    const r = evaluate(data, 10).find((x) => x.sku === "SKU016");
    expect(r).toMatchObject({ action: "EXCEPTION", qty: null, avg12: 0 });
    expect(r?.flags).toContain("new_product");
  });

  it("every other SKU gets a rule-based action", () => {
    const others = evaluate(data, 10).filter((x) => x.sku !== "SKU016");
    expect(others.every((x) => x.action !== "EXCEPTION")).toBe(true);
  });
});

describe("synthetic seed", () => {
  const data = syntheticSeed({ endWeek: "2026-10-12" });
  const recs = evaluate(data, 10);

  it("has 40 SKUs (8 perishable), 50 distributors and 156 weeks", () => {
    expect(data.skus).toHaveLength(40);
    expect(data.skus.filter((s) => s.perishable)).toHaveLength(8);
    expect(new Set(data.sales.map((s) => s.distributor_id)).size).toBe(50);
    expect(new Set(data.sales.map((s) => s.week_start)).size).toBe(156);
    expect(data.skus.every((s) => s.zoho_item_id && s.vendor_id)).toBe(true);
  });

  it("produces every action type", () => {
    const actions = new Set(recs.map((r) => r.action));
    expect([...actions].sort()).toEqual(["EXCEPTION", "OK", "PAUSE", "REORDER_HIGH", "REORDER_NOW"]);
  });

  it("plants the expected exceptions", () => {
    const flags = (sku: string) => recs.find((r) => r.sku === sku)?.flags ?? [];
    expect(flags("FR001")).toContain("new_launch");
    expect(flags("FR002")).toContain("new_launch");
    expect(flags("FR003")).toContain("anomaly");
    expect(flags("FR004").some((f) => f.startsWith("distributor_swing:"))).toBe(true);
  });
});
