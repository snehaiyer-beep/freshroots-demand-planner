import { describe, expect, it } from "vitest";
import { parseCsv, validateSales, validateStock } from "@/lib/csv";
import { isoWeekToMonday, normalizeWeek } from "@/lib/weeks";

const skus = new Set(["A", "B"]);

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and blank lines", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n\r\n1,2,3\n')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
  });
});

describe("weeks", () => {
  it("converts ISO weeks to Mondays", () => {
    expect(isoWeekToMonday("2026-W27")).toBe("2026-06-29");
    expect(isoWeekToMonday("2026-W01")).toBe("2025-12-29");
    expect(normalizeWeek("2026-10-12")).toBe("2026-10-12");
    expect(normalizeWeek("2026-02-30")).toBeNull();
  });
});

describe("validateSales", () => {
  it("keeps valid rows and reports row errors with line numbers", () => {
    const text = [
      "week_start,sku,distributor_id,units",
      "2026-10-12,A,D1,10",
      "2026-W42,B,D1,5",
      "2026-13-01,A,D1,3",
      "2026-10-12,Z,D1,3",
      "2026-10-12,A,D2,-1",
      "2026-10-12,A,D1,7",
    ].join("\n");
    const { rows, errors } = validateSales(text, skus);
    expect(rows).toEqual([
      { week_start: "2026-10-12", sku: "A", distributor_id: "D1", units: 10 },
      { week_start: "2026-10-12", sku: "B", distributor_id: "D1", units: 5 },
    ]);
    expect(errors.map((e) => e.line)).toEqual([4, 5, 6, 7]);
    expect(errors[1].message).toContain("unknown sku");
    expect(errors[3].message).toContain("duplicate");
  });
  it("rejects files with missing columns", () => {
    expect(validateSales("sku,units\nA,1", skus).errors[0].message).toContain("week_start");
  });
});

describe("validateStock", () => {
  it("validates sku and on_hand", () => {
    const { rows, errors } = validateStock("sku,on_hand\nA,10\nB,x\nC,3", skus);
    expect(rows).toEqual([{ sku: "A", on_hand: 10 }]);
    expect(errors).toHaveLength(2);
  });
});
