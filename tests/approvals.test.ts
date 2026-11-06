import { describe, expect, it } from "vitest";
import { checkDecision } from "@/lib/approvals";

const mapped = { zoho_item_id: "I1", vendor_id: "V1" };
const unmapped = { zoho_item_id: null, vendor_id: "V1" };
const reorder = { action: "REORDER_NOW" as const, qty: 100, zoho_po_id: null };

describe("checkDecision", () => {
  it("allows approving a mapped reorder", () => {
    expect(checkDecision(reorder, mapped, { kind: "approve" })).toBeNull();
  });
  it("blocks approval when the SKU is not mapped in Zoho", () => {
    expect(checkDecision(reorder, unmapped, { kind: "approve" })).toMatch(/Map in Zoho/);
  });
  it("allows approving zero-qty actions without a mapping (nothing to push)", () => {
    expect(checkDecision({ action: "PAUSE", qty: 0, zoho_po_id: null }, unmapped, { kind: "approve" })).toBeNull();
  });
  it("exceptions need a quantity: plain approve is blocked, edit works", () => {
    const ex = { action: "EXCEPTION" as const, qty: null, zoho_po_id: null };
    expect(checkDecision(ex, mapped, { kind: "approve" })).toMatch(/quantity/);
    expect(checkDecision(ex, mapped, { kind: "edit", qty: 50, reason: "new launch" })).toBeNull();
  });
  it("edits need a whole qty and a listed reason", () => {
    expect(checkDecision(reorder, mapped, { kind: "edit", qty: -1, reason: "other" })).toMatch(/whole number/);
    expect(checkDecision(reorder, mapped, { kind: "edit", qty: 10, reason: "because" })).toMatch(/reason/);
  });
  it("never re-decides something already pushed", () => {
    expect(checkDecision({ ...reorder, zoho_po_id: "PO1" }, mapped, { kind: "reject" })).toMatch(/Already pushed/);
  });
  it("reject is always allowed before push", () => {
    expect(checkDecision(reorder, unmapped, { kind: "reject" })).toBeNull();
  });
});
