const DAY = 86_400_000;

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return toISODate(new Date(parseDate(iso).getTime() + days * DAY));
}

export function weeksBetween(fromIso: string, toIso: string): number {
  return Math.round((parseDate(toIso).getTime() - parseDate(fromIso).getTime()) / (7 * DAY));
}

/** Monday of the week containing the date. */
export function mondayOf(iso: string): string {
  const d = parseDate(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(iso, -dow);
}

/** "2026-W27" → Monday of ISO week 27 of 2026. Returns null if not an ISO week string. */
export function isoWeekToMonday(s: string): string | null {
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // ISO week 1 contains Jan 4th.
  const jan4 = toISODate(new Date(Date.UTC(year, 0, 4)));
  return addDays(mondayOf(jan4), (week - 1) * 7);
}

/** Accepts YYYY-MM-DD or YYYY-Www; returns a YYYY-MM-DD string or null. */
export function normalizeWeek(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = parseDate(t);
    return Number.isNaN(d.getTime()) || toISODate(d) !== t ? null : t;
  }
  return isoWeekToMonday(t);
}

/** Current month (1–12) in India Standard Time. */
export function istMonth(now = new Date()): number {
  return new Date(now.getTime() + 5.5 * 3_600_000).getUTCMonth() + 1;
}
