import { last12Weeks, latestRun, recsForRun, type RecWithSku } from "@/lib/data";
import { NEW_PRODUCT_FLAG } from "@/lib/exceptions";
import { zohoPoUrl } from "@/lib/zoho";
import { FlagChips, PushBadge, StatusText } from "@/components/Badges";
import { DecisionControls } from "@/components/DecisionControls";
import { PageHeader } from "@/components/Nav";
import { Sparkline } from "@/components/Sparkline";
import { IconCheck, IconSparkle } from "@/components/icons";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

export default async function ExceptionsPage() {
  let recs: RecWithSku[] = [];
  let weeks: string[] = [];
  let series = new Map<string, number[]>();
  let loadError: string | null = null;
  try {
    const run = await latestRun();
    if (run) recs = await recsForRun(run.id, true);
    ({ weeks, bySku: series } = await last12Weeks());
  } catch (err) {
    loadError = (err as Error).message;
  }
  // new products first, then pending before decided
  recs.sort(
    (a, b) =>
      Number(b.flags.includes(NEW_PRODUCT_FLAG)) - Number(a.flags.includes(NEW_PRODUCT_FLAG)) ||
      Number(b.status === "pending") - Number(a.status === "pending") ||
      a.sku.localeCompare(b.sku),
  );
  const pending = recs.filter((r) => r.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Exceptions"
        subtitle={
          recs.length
            ? `${pending} of ${recs.length} waiting for a decision. The rules can't be trusted here, so set the quantity yourself or skip.`
            : "SKUs the rules can't handle on their own show up here."
        }
      />
      {loadError && <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Could not load data: {loadError}</p>}

      {recs.length === 0 && !loadError && (
        <div className="card flex flex-col items-center py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <IconCheck width={22} height={22} strokeWidth={2.2} />
          </span>
          <p className="mt-3 font-medium">No exceptions in the latest run</p>
          <p className="text-sm text-slate-500">Every SKU was handled by the rules.</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {recs.map((r) => {
          const isNew = r.flags.includes(NEW_PRODUCT_FLAG);
          return (
            <div key={r.id} className={`card flex flex-col gap-4 ${isNew ? "border-violet-200 ring-1 ring-violet-100" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{r.skus?.name ?? r.sku}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-mono">{r.sku}</span>
                    {r.skus?.perishable && <span className="rounded bg-teal-50 px-1 text-[10px] font-medium uppercase tracking-wide text-teal-700">Perishable</span>}
                  </div>
                </div>
                <StatusText status={r.status} />
              </div>

              {isNew ? (
                <div className="flex gap-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-900">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-200/70 text-violet-800">
                    <IconSparkle width={16} height={16} />
                  </span>
                  <div>
                    <div className="font-semibold">New product</div>
                    <div className="text-violet-800/80">No demand history yet. Raghav to set the first order quantity.</div>
                  </div>
                </div>
              ) : (
                <>
                  <FlagChips flags={r.flags} />
                  <p className="text-sm text-slate-600">{r.reason}</p>
                </>
              )}

              <div className="grid grid-cols-[1fr_auto] items-end gap-5">
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Last 12 weeks</div>
                  <Sparkline values={series.get(r.sku) ?? new Array<number>(12).fill(0)} weeks={weeks} />
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                  <Stat label="4-wk avg" value={String(r.avg4)} />
                  <Stat label="12-wk avg" value={String(r.avg12)} />
                  <Stat label="Demand/wk" value={String(r.demand)} />
                  <Stat label="Cover" value={r.cover_wks === null ? "∞" : `${r.cover_wks} wks`} />
                </div>
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-4">
                {r.status === "pending" || r.status === "rejected" ? (
                  <DecisionControls rec={r} mode="exception" />
                ) : (
                  <p className="text-sm text-slate-600">
                    Approved <strong className="tabular-nums">{r.final_qty?.toLocaleString("en-IN")}</strong> units · {r.override_reason} · by {r.approved_by}
                  </p>
                )}
                {r.push_status !== "not_sent" && <PushBadge id={r.id} status={r.push_status} error={r.push_error} poId={r.zoho_po_id} href={zohoPoUrl(r.zoho_po_id)} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
