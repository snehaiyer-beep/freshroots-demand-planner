import { supabaseAdmin } from "@/lib/supabase/admin";
import { zohoMockMode, zohoOrgName, zohoPoInfo, zohoPoUrl, type ZohoPoInfo } from "@/lib/zoho";
import { ZohoStatus } from "@/components/ZohoStatus";
import type { PushStatus } from "@/lib/types";
import { PushBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

interface LogRow {
  id: number;
  rec_id: number;
  zoho_po_id: string;
  qty: number;
  approved_by: string | null;
  created_at: string;
  recommendations: { sku: string; run_id: number; push_status: PushStatus; push_error: string | null } | null;
}

interface FailedRow {
  id: number;
  sku: string;
  run_id: number;
  final_qty: number | null;
  approved_by: string | null;
  push_status: PushStatus;
  push_error: string | null;
  zoho_po_id: string | null;
}

export default async function PosPage() {
  let logs: LogRow[] = [];
  let failed: FailedRow[] = [];
  let loadError: string | null = null;
  let poInfo = new Map<string, ZohoPoInfo>();
  let orgName: string | null = null;
  try {
    const db = supabaseAdmin();
    [poInfo, orgName] = await Promise.all([zohoPoInfo(), zohoOrgName()]);
    const [logRes, failRes] = await Promise.all([
      db
        .from("po_log")
        .select("*, recommendations(sku, run_id, push_status, push_error)")
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("recommendations")
        .select("id, sku, run_id, final_qty, approved_by, push_status, push_error, zoho_po_id")
        .eq("push_status", "failed")
        .order("id", { ascending: false }),
    ]);
    if (logRes.error) throw new Error(logRes.error.message);
    if (failRes.error) throw new Error(failRes.error.message);
    logs = (logRes.data ?? []) as LogRow[];
    failed = (failRes.data ?? []) as FailedRow[];
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase orders</h1>
          <p className="text-sm text-slate-500">
            Every approved recommendation becomes a draft PO in Zoho Inventory, one per supplier.
            {zohoMockMode() ? " (Mock mode: IDs are fake.)" : " Nothing reaches a supplier until the PO is issued in Zoho."}
          </p>
        </div>
        <ZohoStatus live={!zohoMockMode()} orgName={orgName} />
      </div>
      {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load data: {loadError}</p>}

      {failed.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium text-red-700">Failed pushes ({failed.length})</h2>
          <div className="table-wrap border-red-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="border-b border-red-100 bg-red-50/70">
                <tr>
                  <th className="th">Run</th>
                  <th className="th">SKU</th>
                  <th className="th text-right">Qty</th>
                  <th className="th">Approved by</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failed.map((f) => (
                  <tr key={f.id}>
                    <td className="td">#{f.run_id}</td>
                    <td className="td font-medium">{f.sku}</td>
                    <td className="td text-right tabular-nums">{f.final_qty}</td>
                    <td className="td">{f.approved_by}</td>
                    <td className="td">
                      <PushBadge id={f.id} status={f.push_status} error={f.push_error} poId={f.zoho_po_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">PO log</h2>
        <div className="table-wrap">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="border-b border-slate-200 bg-slate-50/70">
              <tr>
                <th className="th">Created</th>
                <th className="th">Zoho PO</th>
                <th className="th">Supplier</th>
                <th className="th">Run</th>
                <th className="th">SKU</th>
                <th className="th text-right">Qty</th>
                <th className="th">Approved by</th>
                <th className="th">Zoho status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap">{new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td className="td">
                    {(() => {
                      const info = poInfo.get(l.zoho_po_id);
                      const url = zohoPoUrl(l.zoho_po_id);
                      return (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900">{info?.number ?? <span className="font-mono text-xs font-normal">{l.zoho_po_id}</span>}</div>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">
                              Open in Zoho ↗
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="td text-slate-600">{poInfo.get(l.zoho_po_id)?.vendor ?? "—"}</td>
                  <td className="td">#{l.recommendations?.run_id}</td>
                  <td className="td font-medium">{l.recommendations?.sku}</td>
                  <td className="td text-right tabular-nums">{l.qty}</td>
                  <td className="td">{l.approved_by}</td>
                  <td className="td">
                    {poInfo.get(l.zoho_po_id) ? (
                      <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium capitalize text-slate-700">
                        {poInfo.get(l.zoho_po_id)?.status.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-700">{l.recommendations?.push_status ?? "sent"}</span>
                    )}
                    {l.recommendations?.push_error && <p className="text-xs text-amber-700">{l.recommendations.push_error}</p>}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="td py-8 text-center text-slate-500">
                    No POs pushed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
