import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeAccuracy, type AccuracyRecInput, type AccuracySummary } from "@/lib/accuracy";
import { latestSalesWeek, weeklyTotals } from "@/lib/data";
import { addDays, toISODate } from "@/lib/weeks";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

export default async function AccuracyPage() {
  let summary: AccuracySummary | null = null;
  let loadError: string | null = null;
  try {
    const db = supabaseAdmin();
    const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString();
    const { data: runs, error } = await db
      .from("runs")
      .select("id, created_at")
      .eq("status", "done")
      .lte("created_at", cutoff)
      .order("id", { ascending: false })
      .limit(26);
    if (error) throw new Error(error.message);

    const inputs: AccuracyRecInput[] = [];
    if (runs && runs.length) {
      const { data: recs, error: recErr } = await db
        .from("recommendations")
        .select("run_id, sku, demand, cover_wks, qty, final_qty, status")
        .in("run_id", runs.map((r) => r.id));
      if (recErr) throw new Error(recErr.message);
      const created = new Map(runs.map((r) => [r.id as number, r.created_at as string]));
      for (const r of recs ?? []) {
        inputs.push({
          run_id: r.run_id,
          run_created_at: created.get(r.run_id) ?? "",
          sku: r.sku,
          demand: Number(r.demand),
          cover_wks: r.cover_wks === null ? null : Number(r.cover_wks),
          qty: r.qty,
          final_qty: r.final_qty,
          status: r.status,
        });
      }
    }
    const latest = await latestSalesWeek();
    const earliest = runs?.length ? addDays(runs[runs.length - 1].created_at.slice(0, 10), -7) : toISODate(new Date());
    const totals = latest ? await weeklyTotals(earliest, latest) : new Map<string, Map<string, number>>();
    summary = computeAccuracy(inputs, totals, latest);
  } catch (err) {
    loadError = (err as Error).message;
  }

  // per-SKU average error across runs
  const bySku = new Map<string, { errs: number[]; predicted: number; actual: number; n: number }>();
  for (const r of summary?.rows ?? []) {
    const s = bySku.get(r.sku) ?? { errs: [], predicted: 0, actual: 0, n: 0 };
    if (r.errorPct !== null) s.errs.push(r.errorPct);
    s.predicted += r.predicted;
    s.actual += r.actual;
    s.n++;
    bySku.set(r.sku, s);
  }
  const skuRows = [...bySku.entries()]
    .map(([sku, s]) => ({ sku, ...s, err: s.errs.length ? s.errs.reduce((a, b) => a + b, 0) / s.errs.length : null }))
    .sort((a, b) => (b.err ?? -1) - (a.err ?? -1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accuracy</h1>
        <p className="text-sm text-slate-500">
          Runs at least 4 weeks old: predicted demand × 4 vs actual units sold in the 4 weeks from the run.
        </p>
      </div>
      {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load data: {loadError}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Average error</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{pct(summary?.avgErrorPct ?? null)}</p>
        </div>
        <div className="card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">SKU-runs measured</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">{summary?.rows.length ?? 0}</p>
        </div>
        <div className="card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Overrides that beat the rule</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">
            {summary?.overrides ? `${summary.overridesBeatRule} / ${summary.overrides}` : "—"}
          </p>
          {summary?.overrides ? (
            <p className="text-xs text-slate-500">{((summary.overridesBeatRule / summary.overrides) * 100).toFixed(0)}% of qty edits were closer to what was needed</p>
          ) : null}
        </div>
      </div>

      <div className="table-wrap">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="border-b border-slate-200 bg-slate-50/70">
            <tr>
              <th className="th">SKU</th>
              <th className="th text-right">Runs</th>
              <th className="th text-right">Predicted (4 wks)</th>
              <th className="th text-right">Actual (4 wks)</th>
              <th className="th text-right">Avg error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {skuRows.map((s) => (
              <tr key={s.sku}>
                <td className="td font-medium">{s.sku}</td>
                <td className="td text-right tabular-nums">{s.n}</td>
                <td className="td text-right tabular-nums">{s.predicted}</td>
                <td className="td text-right tabular-nums">{s.actual}</td>
                <td className={`td text-right tabular-nums ${s.err !== null && s.err > 25 ? "font-medium text-red-700" : ""}`}>{pct(s.err)}</td>
              </tr>
            ))}
            {skuRows.length === 0 && (
              <tr>
                <td colSpan={5} className="td py-8 text-center text-slate-500">
                  Nothing to score yet — accuracy appears once a run is 4 weeks old and its sales weeks are uploaded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
