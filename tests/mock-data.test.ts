import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInsert } from "../scripts/load-mock";
import { buildInputs, computeAll } from "@/lib/pipeline";
import { DEFAULT_CONFIG } from "@/lib/rules";

const sql = readFileSync(path.join(__dirname, "..", "data", "freshroots_mock_data.sql"), "utf8");

describe("mock data SQL (data/freshroots_mock_data.sql)", () => {
  const skus = parseInsert(sql, "skus");
  const sales = parseInsert(sql, "weekly_sales");
  const stock = parseInsert(sql, "stock");
  const openPos = parseInsert(sql, "open_pos");

  it("parses every row, and open POs carry the id the table needs", () => {
    expect([skus.length, sales.length, stock.length, openPos.length]).toEqual([18, 1120, 18, 4]);
    expect(openPos.every((o) => o.id?.startsWith("MOCK-OPEN-"))).toBe(true);
  });

  it("gives the advertised November result: 4 Reorder now, 3 High, 3 Pause, 5 On track, 3 Needs review", () => {
    const first: Record<string, string> = {};
    let latest: string | null = null;
    for (const s of sales) {
      if (!first[s.sku] || s.week_start < first[s.sku]) first[s.sku] = s.week_start;
      if (!latest || s.week_start > latest) latest = s.week_start;
    }
    const recs = computeAll(
      buildInputs({
        skus: skus.map((s) => ({ sku: s.sku, perishable: s.perishable === "true", std_qty: Number(s.std_qty) })),
        stock: stock.map((s) => ({ sku: s.sku, on_hand: Number(s.on_hand) })),
        openPos: openPos.map((o) => ({ sku: o.sku, qty: Number(o.qty) })),
        sales: sales.map((s) => ({ week_start: s.week_start, sku: s.sku, distributor_id: s.distributor_id, units: Number(s.units) })),
        firstWeekBySku: first,
        latestWeek: latest,
      }),
      DEFAULT_CONFIG,
      11,
    );
    const counts: Record<string, number> = {};
    for (const r of recs) counts[r.action] = (counts[r.action] ?? 0) + 1;
    expect(counts).toEqual({ REORDER_NOW: 4, REORDER_HIGH: 3, PAUSE: 3, OK: 5, EXCEPTION: 3 });
    expect(recs.find((r) => r.sku === "FR-116")?.flags).toContain("new_launch");
    expect(recs.find((r) => r.sku === "FR-118")?.flags).toContain("anomaly");
  });
});
