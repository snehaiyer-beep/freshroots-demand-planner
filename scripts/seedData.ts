import { parseCsv } from "../lib/csv";
import { addDays, mondayOf, normalizeWeek, toISODate } from "../lib/weeks";
import { avgLast, computeDemand, DEFAULT_CONFIG } from "../lib/rules";
import type { SkuRow } from "../lib/types";

export interface SeedData {
  skus: SkuRow[];
  sales: { week_start: string; sku: string; distributor_id: string; units: number }[];
  stock: { sku: string; on_hand: number; as_of: string }[];
  openPos: { id: string; sku: string; qty: number; eta: string | null }[];
  festivalMonths?: number[];
}

// ---------------------------------------------------------------------------
// 1) Seed from the CSV exports in /data (default)
// ---------------------------------------------------------------------------

export interface CsvFiles {
  skuMaster: string; // SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Unit_of_Measure,Distributor_ID
  weeklySales: string; // SKU_ID,Week,Units_Sold   (Week like 2026-W27)
  inventory: string; // SKU_ID,Location,Units_On_Hand,As_Of_Date
  calendar?: string; // Year,Month,Year_Month,Is_Festival_Month
}

function table(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  const keys = (header ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function seedFromCsv(files: CsvFiles): SeedData {
  const master = table(files.skuMaster);
  const distBySku = new Map(master.map((m) => [m.SKU_ID, m.Distributor_ID]));

  const sales: SeedData["sales"] = [];
  const firstWeek = new Map<string, string>();
  for (const r of table(files.weeklySales)) {
    const week = normalizeWeek(r.Week);
    const units = Number(r.Units_Sold);
    if (!week || !Number.isFinite(units) || !distBySku.has(r.SKU_ID)) continue;
    sales.push({ week_start: week, sku: r.SKU_ID, distributor_id: distBySku.get(r.SKU_ID) ?? "UNKNOWN", units: Math.max(0, Math.round(units)) });
    if (!firstWeek.has(r.SKU_ID) || week < (firstWeek.get(r.SKU_ID) as string)) firstWeek.set(r.SKU_ID, week);
  }

  const inventory = table(files.inventory);
  const asOfBySku = new Map(inventory.map((i) => [i.SKU_ID, i.As_Of_Date]));

  const skus: SkuRow[] = master.map((m) => ({
    sku: m.SKU_ID,
    name: m.SKU_Name,
    perishable: m.Perishability.toLowerCase() === "high",
    // SKUs with no sales yet (new products) launch on their inventory date.
    launch_date: firstWeek.get(m.SKU_ID) ?? asOfBySku.get(m.SKU_ID) ?? null,
    std_qty: Number(m.Standard_Reorder_Qty) || 0,
    zoho_item_id: `ZITEM-${m.SKU_ID}`,
    vendor_id: `ZVEND-${m.Category.replace(/\W+/g, "").toUpperCase()}`,
  }));

  const stock = inventory.map((i) => ({ sku: i.SKU_ID, on_hand: Math.max(0, Number(i.Units_On_Hand) || 0), as_of: i.As_Of_Date }));

  let festivalMonths: number[] | undefined;
  if (files.calendar) {
    const months = table(files.calendar)
      .filter((c) => c.Is_Festival_Month.toUpperCase() === "TRUE")
      .map((c) => Number(c.Month));
    festivalMonths = Array.from(new Set(months)).sort((a, b) => a - b);
  }

  return { skus, sales, stock, openPos: [], festivalMonths };
}

// ---------------------------------------------------------------------------
// 2) Synthetic data: 40 SKUs, 50 distributors, 156 weeks (--synthetic)
// ---------------------------------------------------------------------------

/** Small deterministic PRNG so the seed is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH_FACTOR: Record<number, number> = { 2: 1.03, 3: 1.12, 4: 1.03, 9: 1.04, 10: 1.12, 11: 1.15, 12: 1.04 };

function season(weekStart: string): number {
  // average the month factor over the 7 days of the week so peaks ramp in smoothly
  let f = 0;
  for (let d = 0; d < 7; d++) f += MONTH_FACTOR[Number(addDays(weekStart, d).slice(5, 7))] ?? 1;
  return f / 7;
}

const PRODUCTS = [
  "Mango Drink 200ml", "Oats Cookies 150g", "Brown Rice 1kg", "Mixed Nuts 100g", "Quinoa 500g", "Granola Bar 40g",
  "Chia Seeds 200g", "Apple Cider Vinegar 500ml", "Herbal Tea 25 bags", "Peanut Butter 300g", "Dark Chocolate 80g",
  "Honey 500g", "Ragi Flakes 500g", "Millet Muesli 400g", "Flax Seeds 200g", "Jaggery Powder 500g", "Masala Makhana 80g",
  "Trail Mix 150g", "Protein Bar 50g", "Amla Juice 500ml", "Green Tea 25 bags", "Coconut Sugar 250g", "Oat Flour 1kg",
  "Pumpkin Seeds 150g", "Date Bites 200g", "Lemon Ginger Shot 60ml", "Kombucha 250ml", "Cold Pressed Oil 1L",
  "Multigrain Atta 5kg", "Pink Salt 500g", "Ghee 500ml", "Almond Butter 200g",
  // perishables (index 32..39)
  "Almond Milk 500ml", "Coconut Water 330ml", "Multigrain Bread 400g", "Greek Yogurt 400g", "Paneer 200g",
  "Fresh Juice 1L", "Sprouts Salad 250g", "Oat Milk 1L",
];

export interface SyntheticOptions { endWeek?: string; seed?: number }

export function syntheticSeed(opts: SyntheticOptions = {}): SeedData {
  const rand = mulberry32(opts.seed ?? 42);
  const endWeek = opts.endWeek ?? addDays(mondayOf(toISODate(new Date())), -7);
  const WEEKS = 156;
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(endWeek, -7 * (WEEKS - 1 - i)));
  const runMonth = Number(addDays(endWeek, 10).slice(5, 7)); // month of the next run
  const distributors = Array.from({ length: 50 }, (_, i) => `D${String(i + 1).padStart(3, "0")}`);
  const zipf = distributors.map((_, d) => 1 / Math.pow(d + 1, 1.1));
  const zipfSum = zipf.reduce((a, b) => a + b, 0);

  const skus: SkuRow[] = [];
  const sales: SeedData["sales"] = [];
  const stock: SeedData["stock"] = [];
  const openPos: SeedData["openPos"] = [];

  for (let i = 0; i < 40; i++) {
    const sku = `FR${String(i + 1).padStart(3, "0")}`;
    const perishable = i >= 32;
    const base = 300 + Math.round(rand() * 1500);
    const stdQty = Math.round((base * (perishable ? 2 : 6)) / 50) * 50;
    // new launches: 6 and 9 weeks of history
    const launchIdx = i === 0 ? WEEKS - 6 : i === 1 ? WEEKS - 9 : 0;
    // step-up SKUs are non-seasonal so the demand jump is not confused with the festival ramp
    const stepUp = i >= 4 && i <= 8;
    const totals: number[] = [];

    for (let w = 0; w < WEEKS; w++) {
      if (w < launchIdx) { totals.push(0); continue; }
      // last week is kept "normal" so only the planted anomalies trip the exception checks
      const isLast = w === WEEKS - 1;
      const shock = isLast ? 1 : 1 + 0.12 * (rand() * 2 - 1);
      const idio = isLast ? 0.02 : 0.03;
      let level = 1;
      // step-up in demand over the last 4 weeks → REORDER_HIGH candidates
      if (stepUp && w >= WEEKS - 4) level = 1.45;
      // whole-SKU spike last week → anomaly
      if (i === 2 && w === WEEKS - 1) level = 2.6;
      let total = 0;
      distributors.forEach((dist, d) => {
        const rot = (d + i) % distributors.length; // vary which distributors are big per SKU
        let units = base * (zipf[rot] / zipfSum) * (stepUp ? 1 : season(weeks[w])) * shock * level * (1 + idio * (rand() * 2 - 1));
        // one distributor spike last week → distributor_swing
        if (i === 3 && rot === 0 && w === WEEKS - 1) units *= 2.5;
        const u = Math.max(0, Math.round(units));
        if (u > 0) sales.push({ week_start: weeks[w], sku, distributor_id: dist, units: u });
        total += u;
      });
      totals.push(total);
    }

    // stock: pick a target cover so every action shows up
    const demand = computeDemand(avgLast(totals, 12), runMonth, DEFAULT_CONFIG);
    let coverTarget: number;
    if (perishable) coverTarget = i <= 33 ? 1.5 : i === 34 ? 7 : 3.5; // NOW, NOW, PAUSE, OK…
    else if (i >= 4 && i <= 7) coverTarget = 9; // in window + step-up → REORDER_HIGH
    else if (i >= 8 && i <= 15) coverTarget = 2 + (i % 3); // REORDER_NOW (i=8 also high demand → ×mult)
    else if (i >= 16 && i <= 21) coverTarget = 18 + (i % 4) * 3; // PAUSE
    else coverTarget = 8 + (i % 4); // OK
    const supply = Math.round(coverTarget * demand);
    const poQty = i === 22 || i === 23 ? Math.round(supply * 0.4) : 0;
    if (poQty > 0) openPos.push({ id: `MOCK-OPEN-${sku}`, sku, qty: poQty, eta: addDays(endWeek, 14) });
    stock.push({ sku, on_hand: Math.max(0, supply - poQty), as_of: addDays(endWeek, 7) });

    skus.push({
      sku,
      name: `Freshroots ${PRODUCTS[i]}`,
      perishable,
      launch_date: launchIdx > 0 ? weeks[launchIdx] : weeks[0],
      std_qty: stdQty,
      zoho_item_id: `ZITEM-${sku}`,
      vendor_id: `ZVEND-${String((i % 5) + 1).padStart(2, "0")}`,
    });
  }

  return { skus, sales, stock, openPos };
}
