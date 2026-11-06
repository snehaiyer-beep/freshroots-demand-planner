export type Action = "REORDER_NOW" | "REORDER_HIGH" | "PAUSE" | "OK" | "EXCEPTION";
export type RecStatus = "pending" | "approved" | "edited" | "rejected";
export type PushStatus = "not_sent" | "sent" | "failed";

export const ACTIONS: Action[] = ["EXCEPTION", "REORDER_NOW", "REORDER_HIGH", "PAUSE", "OK"];

export const OVERRIDE_REASONS = [
  "festival/scheme",
  "distributor info",
  "new launch",
  "supply issue",
  "other",
] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

export interface RulesConfig {
  highDemandPct: number;
  highDemandMult: number;
  minWks: number;
  maxWks: number;
  perMinWks: number;
  perMaxWks: number;
  festivalUplift: number;
  festivalMonths: number[];
  swingPct: number;
  minHistoryWks: number;
}

export interface AppConfig extends RulesConfig {
  pushMode: "draft" | "issued";
}

/** Everything the rule engine needs for one SKU. Series are oldest → newest, last element = last week. */
export interface SkuInput {
  sku: string;
  perishable: boolean;
  stdQty: number;
  onHand: number;
  openPoQty: number;
  totals: number[];
  distributors: Record<string, number[]>;
  historyWks: number;
}

export interface RecResult {
  sku: string;
  avg4: number;
  avg12: number;
  demand: number;
  /** null = infinite cover (no demand) */
  coverWks: number | null;
  action: Action;
  qty: number | null;
  flags: string[];
}

export interface SkuRow {
  sku: string;
  name: string;
  perishable: boolean;
  launch_date: string | null;
  std_qty: number;
  zoho_item_id: string | null;
  vendor_id: string | null;
}

export interface RecRow {
  id: number;
  run_id: number;
  sku: string;
  avg4: number;
  avg12: number;
  demand: number;
  cover_wks: number | null;
  action: Action;
  qty: number | null;
  flags: string[];
  reason: string | null;
  status: RecStatus;
  final_qty: number | null;
  override_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  zoho_po_id: string | null;
  push_status: PushStatus;
  push_error: string | null;
}
