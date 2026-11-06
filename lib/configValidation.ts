export const CONFIG_KEYS = [
  "high_demand_pct",
  "high_demand_mult",
  "min_wks",
  "max_wks",
  "per_min_wks",
  "per_max_wks",
  "festival_uplift",
  "festival_months",
  "swing_pct",
  "min_history_wks",
  "push_mode",
] as const;

const NUMERIC = CONFIG_KEYS.filter((k) => k !== "festival_months" && k !== "push_mode") as readonly string[];

/** Returns an error message, or null when the value is valid for the key. */
export function validateConfigEntry(key: string, value: string): string | null {
  if (NUMERIC.includes(key)) {
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) && n >= 0 ? null : `${key} must be a number ≥ 0`;
  }
  if (key === "festival_months") {
    const ok = value
      .split(",")
      .every((s) => s.trim() === "" || (Number.isInteger(Number(s)) && Number(s) >= 1 && Number(s) <= 12));
    return ok ? null : "festival_months must be month numbers 1–12, comma-separated";
  }
  if (key === "push_mode") return value === "draft" || value === "issued" ? null : "push_mode must be draft or issued";
  return `Unknown key ${key}`;
}
