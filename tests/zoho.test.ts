import { describe, expect, it } from "vitest";
import { isOpenPoStatus, isZohoOpenPoId } from "@/lib/zoho";

describe("isZohoOpenPoId", () => {
  it("recognises rows synced from Zoho and leaves seed/mock rows alone", () => {
    expect(isZohoOpenPoId("4346452000000034243:4346452000000034245")).toBe(true);
    expect(isZohoOpenPoId("MOCK-OPEN-FR-102")).toBe(false);
    expect(isZohoOpenPoId("seed-1")).toBe(false);
  });
});

describe("isOpenPoStatus", () => {
  it("counts POs whose stock is still to arrive, including planner drafts", () => {
    for (const s of ["draft", "issued", "partially_received", "Issued"]) expect(isOpenPoStatus(s)).toBe(true);
  });
  it("ignores received, billed, cancelled and closed POs", () => {
    for (const s of ["received", "billed", "cancelled", "closed", "", undefined]) expect(isOpenPoStatus(s)).toBe(false);
  });
});
