import { describe, expect, it } from "vitest";
import { isOpenPoStatus } from "@/lib/zoho";

describe("isOpenPoStatus", () => {
  it("counts POs whose stock is still to arrive, including planner drafts", () => {
    for (const s of ["draft", "issued", "partially_received", "Issued"]) expect(isOpenPoStatus(s)).toBe(true);
  });
  it("ignores received, billed, cancelled and closed POs", () => {
    for (const s of ["received", "billed", "cancelled", "closed", "", undefined]) expect(isOpenPoStatus(s)).toBe(false);
  });
});
