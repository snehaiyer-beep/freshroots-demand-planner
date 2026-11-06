import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { RecResult } from "./types";
import { NEW_PRODUCT_FLAG, NEW_PRODUCT_NOTE } from "./exceptions";

const MODEL = "claude-opus-5-5";
const MAX_WORDS = 20;

const ExplainSchema = z.object({
  reasons: z.array(z.object({ sku: z.string(), reason: z.string() })),
});

const fmt = (n: number | null) => (n === null ? "∞" : String(Math.round(n * 10) / 10));

/** Deterministic fallback reason built from the numbers. */
export function templateReason(r: RecResult): string {
  const cover = `${fmt(r.coverWks)} wks cover`;
  switch (r.action) {
    case "REORDER_NOW":
      return `Only ${cover} vs demand ${fmt(r.demand)}/wk; reorder ${r.qty} units now.`;
    case "REORDER_HIGH":
      return `4-wk avg ${fmt(r.avg4)} well above 12-wk avg ${fmt(r.avg12)}; reorder ${r.qty} units.`;
    case "PAUSE":
      return `${cover} exceeds window at ${fmt(r.demand)}/wk demand; pause ordering.`;
    case "OK":
      return `${cover} within window at ${fmt(r.demand)}/wk demand; no order needed.`;
    case "EXCEPTION":
      if (r.flags.includes(NEW_PRODUCT_FLAG)) return NEW_PRODUCT_NOTE;
      return `Needs review: ${r.flags.filter((f) => f !== "festival").join(", ")}.`;
  }
}

export function clampWords(text: string, max = MAX_WORDS): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

/** True if every number quoted in the reason matches one of the given figures (guards against invented numbers). */
export function numbersAreFaithful(reason: string, r: RecResult): boolean {
  const allowed = [r.avg4, r.avg12, r.demand, r.coverWks, r.qty]
    .filter((n): n is number => n !== null)
    .flatMap((n) => [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100]);
  const found = reason.match(/\d+(?:\.\d+)?/g) ?? [];
  return found.every((s) => {
    const v = Number(s);
    // small integers (e.g. "4-week", "12-week") are window labels, not figures
    if ([4, 12].includes(v)) return true;
    return allowed.some((a) => Math.abs(a - v) < 0.051);
  });
}

/**
 * One batched Claude call that writes a short reason per SKU. The model only explains the numbers it
 * is given; anything missing, too long or numerically unfaithful falls back to the template.
 */
export async function explainAll(recs: RecResult[]): Promise<Map<string, string>> {
  const out = new Map(recs.map((r) => [r.sku, templateReason(r)] as const));
  if (recs.length === 0 || !process.env.ANTHROPIC_API_KEY) return out;

  // New products keep their fixed note; there are no numbers for the model to explain.
  const toExplain = recs.filter((r) => !r.flags.includes(NEW_PRODUCT_FLAG));
  if (toExplain.length === 0) return out;
  const payload = toExplain.map((r) => ({
    sku: r.sku,
    action: r.action,
    qty: r.qty,
    avg4: r.avg4,
    avg12: r.avg12,
    demand_per_wk: r.demand,
    cover_wks: r.coverWks,
    flags: r.flags,
  }));

  try {
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(ExplainSchema) },
      system:
        "You explain inventory reorder recommendations for a demand planner. For each SKU, write one plain-English reason " +
        `of at most ${MAX_WORDS} words explaining why the given action follows from the given numbers. ` +
        "Use only the numbers provided, exactly as given. Never change, recompute or invent numbers, and never suggest a different action or quantity. " +
        "Return one entry per SKU.",
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) return out;
    const bySku = new Map(toExplain.map((r) => [r.sku, r]));
    for (const item of response.parsed_output.reasons) {
      const rec = bySku.get(item.sku);
      if (!rec) continue;
      const reason = clampWords(item.reason);
      if (reason && numbersAreFaithful(reason, rec)) out.set(item.sku, reason);
    }
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`explain: Anthropic API error ${err.status}: ${err.message}`);
    } else {
      console.error("explain: falling back to template reasons", err);
    }
  }
  return out;
}
