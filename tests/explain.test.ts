import { afterEach, describe, expect, it, vi } from "vitest";
import { clampWords, explainAll, numbersAreFaithful, templateReason } from "@/lib/explain";
import { NEW_PRODUCT_NOTE } from "@/lib/exceptions";
import type { RecResult } from "@/lib/types";

const rec = (over: Partial<RecResult> = {}): RecResult => ({
  sku: "S1", avg4: 130, avg12: 100, demand: 125, coverWks: 3.2, action: "REORDER_NOW", qty: 150, flags: [], ...over,
});

describe("templateReason", () => {
  it("has a reason for every action, using the given numbers", () => {
    expect(templateReason(rec())).toContain("150");
    expect(templateReason(rec({ action: "PAUSE", coverWks: 20, qty: 0 }))).toContain("20 wks");
    expect(templateReason(rec({ action: "OK", qty: 0 }))).toContain("no order");
    expect(templateReason(rec({ action: "REORDER_HIGH" }))).toContain("130");
    expect(templateReason(rec({ action: "EXCEPTION", qty: null, flags: ["anomaly", "festival"] }))).toBe("Needs review: anomaly.");
  });
  it("new products get the fixed note for Raghav", () => {
    expect(templateReason(rec({ action: "EXCEPTION", qty: null, flags: ["new_product"] }))).toBe(NEW_PRODUCT_NOTE);
  });
});

describe("clampWords", () => {
  it("keeps short text and cuts at 20 words", () => {
    expect(clampWords("short and sweet")).toBe("short and sweet");
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(clampWords(long).split(" ")).toHaveLength(20);
  });
});

describe("numbersAreFaithful", () => {
  it("accepts numbers that match the inputs", () => {
    expect(numbersAreFaithful("Cover 3.2 wks vs 125/wk demand; order 150.", rec())).toBe(true);
  });
  it("rejects invented or changed numbers", () => {
    expect(numbersAreFaithful("Order 200 units.", rec())).toBe(false);
  });
});

describe("explainAll", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("falls back to templates without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const out = await explainAll([rec(), rec({ sku: "S2", action: "OK", qty: 0 })]);
    expect(out.get("S1")).toBe(templateReason(rec()));
    expect(out.size).toBe(2);
  });
});
