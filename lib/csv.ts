import { normalizeWeek } from "./weeks";

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface RowError { line: number; message: string }
export interface Parsed<T> { rows: T[]; errors: RowError[] }

function headerIndex(header: string[], required: string[]): { idx: Record<string, number>; missing: string[] } {
  const norm = header.map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  const missing: string[] = [];
  for (const col of required) {
    const i = norm.indexOf(col);
    if (i === -1) missing.push(col);
    else idx[col] = i;
  }
  return { idx, missing };
}

function toNonNegInt(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

export interface SalesCsvRow { week_start: string; sku: string; distributor_id: string; units: number }

/** sales.csv: week_start,sku,distributor_id,units (week_start may be YYYY-MM-DD or YYYY-Www). */
export function validateSales(text: string, knownSkus: Set<string>): Parsed<SalesCsvRow> {
  const all = parseCsv(text);
  if (all.length === 0) return { rows: [], errors: [{ line: 1, message: "File is empty" }] };
  const { idx, missing } = headerIndex(all[0], ["week_start", "sku", "distributor_id", "units"]);
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: SalesCsvRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  all.slice(1).forEach((r, n) => {
    const line = n + 2;
    const week = normalizeWeek(r[idx.week_start] ?? "");
    const sku = (r[idx.sku] ?? "").trim();
    const dist = (r[idx.distributor_id] ?? "").trim();
    const units = toNonNegInt(r[idx.units]);
    const problems: string[] = [];
    if (!week) problems.push(`bad week_start "${r[idx.week_start] ?? ""}"`);
    if (!sku) problems.push("missing sku");
    else if (!knownSkus.has(sku)) problems.push(`unknown sku "${sku}"`);
    if (!dist) problems.push("missing distributor_id");
    if (units === null) problems.push(`units must be a whole number ≥ 0, got "${r[idx.units] ?? ""}"`);
    if (problems.length) return void errors.push({ line, message: problems.join("; ") });

    const key = `${week}|${sku}|${dist}`;
    if (seen.has(key)) return void errors.push({ line, message: `duplicate of line ${seen.get(key)}` });
    seen.set(key, line);
    rows.push({ week_start: week as string, sku, distributor_id: dist, units: units as number });
  });
  return { rows, errors };
}

export interface StockCsvRow { sku: string; on_hand: number }

/** stock.csv: sku,on_hand */
export function validateStock(text: string, knownSkus: Set<string>): Parsed<StockCsvRow> {
  const all = parseCsv(text);
  if (all.length === 0) return { rows: [], errors: [{ line: 1, message: "File is empty" }] };
  const { idx, missing } = headerIndex(all[0], ["sku", "on_hand"]);
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: StockCsvRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  all.slice(1).forEach((r, n) => {
    const line = n + 2;
    const sku = (r[idx.sku] ?? "").trim();
    const onHand = toNonNegInt(r[idx.on_hand]);
    const problems: string[] = [];
    if (!sku) problems.push("missing sku");
    else if (!knownSkus.has(sku)) problems.push(`unknown sku "${sku}"`);
    if (onHand === null) problems.push(`on_hand must be a whole number ≥ 0, got "${r[idx.on_hand] ?? ""}"`);
    if (problems.length) return void errors.push({ line, message: problems.join("; ") });
    if (seen.has(sku)) return void errors.push({ line, message: `duplicate of line ${seen.get(sku)}` });
    seen.set(sku, line);
    rows.push({ sku, on_hand: onHand as number });
  });
  return { rows, errors };
}
