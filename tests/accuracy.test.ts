import { describe, expect, it } from "vitest";
import { computeAccuracy, type AccuracyRecInput } from "@/lib/accuracy";

const totals = new Map([
  ["A", new Map([["2026-09-07", 100], ["2026-09-14", 100], ["2026-09-21", 100], ["2026-09-28", 100]])],
]);

const rec = (over: Partial<AccuracyRecInput> = {}): AccuracyRecInput => ({
  run_id: 1, run_created_at: "2026-09-10T02:00:00Z", sku: "A", demand: 125, cover_wks: 2, qty: 100,
  final_qty: null, status: "approved", ...over,
});

describe("computeAccuracy", () => {
  it("compares demand × 4 with the next 4 weeks of actuals", () => {
    const s = computeAccuracy([rec()], totals, "2026-09-28");
    expect(s.rows[0]).toMatchObject({ predicted: 500, actual: 400, errorPct: 25, override: null });
    expect(s.avgErrorPct).toBe(25);
  });
  it("skips runs whose 4 weeks of actuals are not in yet", () => {
    expect(computeAccuracy([rec()], totals, "2026-09-21").rows).toHaveLength(0);
  });
  it("scores overrides against what was actually needed", () => {
    // supply = 2 × 125 = 250, actual 400 → needed 150. Rule said 100, override 160 → override closer.
    const s = computeAccuracy([rec({ status: "edited", final_qty: 160 }), rec({ sku: "A", run_id: 2, status: "edited", final_qty: 300 })], totals, "2026-09-28");
    expect(s.rows.map((r) => r.override)).toEqual(["beat", "lost"]);
    expect(s.overrides).toBe(2);
    expect(s.overridesBeatRule).toBe(1);
  });
});
