"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { riskRank } from "@/lib/rules";
import { ACTIONS, type Action } from "@/lib/types";
import type { RecWithSku } from "@/lib/data";
import { ACTION_META, ActionBadge, CoverMeter, FlagChips, PushBadge, StatusText } from "./Badges";
import { DecisionControls, isUnmapped } from "./DecisionControls";
import { describeDecision, postJson, type DecisionResponse } from "./http";
import { IconCheck } from "./icons";

export interface Windows { normal: { min: number; max: number }; perishable: { min: number; max: number } }

type Tri = "" | "yes" | "no";

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === o.v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RecommendationsTable({ recs, windows, zohoOrgId }: { recs: RecWithSku[]; windows: Windows; zohoOrgId?: string | null }) {
  const router = useRouter();
  const [action, setAction] = useState<Action | "">("");
  const [perishable, setPerishable] = useState<Tri>("");
  const [festival, setFestival] = useState<Tri>("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of recs) c[r.action] = (c[r.action] ?? 0) + 1;
    return c;
  }, [recs]);

  const rows = useMemo(
    () =>
      recs
        .filter((r) => !action || r.action === action)
        .filter((r) => !perishable || (r.skus?.perishable ?? false) === (perishable === "yes"))
        .filter((r) => !festival || r.flags.includes("festival") === (festival === "yes"))
        .sort((a, b) => riskRank(a.action, a.cover_wks) - riskRank(b.action, b.cover_wks) || a.sku.localeCompare(b.sku)),
    [recs, action, perishable, festival],
  );

  /** Rows that can be bulk-approved as-is. */
  const approvable = (r: RecWithSku) =>
    r.status === "pending" && !r.zoho_po_id && r.qty !== null && !((r.qty ?? 0) > 0 && isUnmapped(r));

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function bulkApprove() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<DecisionResponse>("/api/recommendations", { ids: [...selected], kind: "approve" });
      setMsg(describeDecision(r));
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visibleApprovable = rows.filter(approvable);
  const allChecked = visibleApprovable.length > 0 && visibleApprovable.every((r) => selected.has(r.id));

  return (
    <div className="space-y-5">
      {/* summary tiles double as the action filter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ACTIONS.map((a) => {
          const m = ACTION_META[a];
          const Icon = m.icon;
          const active = action === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => setAction(active ? "" : a)}
              className={`card flex items-center gap-3 p-4 text-left transition hover:border-slate-300 ${active ? "ring-2 ring-slate-900" : ""}`}
              aria-pressed={active}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${m.tile}`}>
                <Icon width={20} height={20} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-2xl font-semibold leading-none text-slate-900">{counts[a] ?? 0}</span>
                <span className="mt-1 block text-xs text-slate-500">{m.short}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={perishable}
          onChange={setPerishable}
          options={[
            { v: "", label: "All SKUs" },
            { v: "yes", label: "Perishable" },
            { v: "no", label: "Non-perishable" },
          ]}
        />
        <Segmented
          value={festival}
          onChange={setFestival}
          options={[
            { v: "", label: "Any season" },
            { v: "yes", label: "Festival uplift" },
            { v: "no", label: "No uplift" },
          ]}
        />
        {action && (
          <button className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline" onClick={() => setAction("")}>
            Clear “{ACTION_META[action].short}” filter
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {msg && <p className="max-w-md text-xs text-slate-600">{msg}</p>}
          <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={bulkApprove}>
            <IconCheck width={16} height={16} strokeWidth={2.2} />
            {busy ? "Approving…" : `Approve selected${selected.size ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="min-w-full">
          <thead className="border-b border-slate-200 bg-slate-50/70">
            <tr>
              <th className="th w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                  aria-label="Select all approvable"
                  checked={allChecked}
                  onChange={() => setSelected(allChecked ? new Set() : new Set(visibleApprovable.map((r) => r.id)))}
                />
              </th>
              <th className="th">Product</th>
              <th className="th">Recommendation</th>
              <th className="th">Cover</th>
              <th className="th text-right">Qty</th>
              <th className="th">Why</th>
              <th className="th">Status</th>
              <th className="th">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const win = r.skus?.perishable ? windows.perishable : windows.normal;
              return (
                <tr key={r.id} className={`transition hover:bg-slate-50/60 ${r.status === "rejected" ? "opacity-50" : ""}`}>
                  <td className="td">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 accent-emerald-700 disabled:opacity-30"
                      aria-label={`Select ${r.sku}`}
                      disabled={!approvable(r)}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className="td min-w-[11rem]">
                    <div className="font-medium text-slate-900">{r.skus?.name ?? r.sku}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                      <span className="font-mono">{r.sku}</span>
                      {r.skus?.perishable && <span className="rounded bg-teal-50 px-1 text-[10px] font-medium uppercase tracking-wide text-teal-700">Perishable</span>}
                    </div>
                  </td>
                  <td className="td">
                    <div className="space-y-1">
                      <ActionBadge action={r.action} />
                      <FlagChips flags={r.flags} />
                    </div>
                  </td>
                  <td className="td">
                    <CoverMeter cover={r.cover_wks} min={win.min} max={win.max} />
                  </td>
                  <td className="td text-right">
                    {r.final_qty !== null && r.final_qty !== r.qty ? (
                      <div className="leading-tight">
                        <span className="text-base font-semibold tabular-nums text-slate-900">{r.final_qty.toLocaleString("en-IN")}</span>
                        <div className="text-[11px] tabular-nums text-slate-400 line-through" title="Rule quantity">
                          {r.qty === null ? "—" : r.qty.toLocaleString("en-IN")}
                        </div>
                      </div>
                    ) : (
                      <span className={`text-base font-semibold tabular-nums ${r.qty ? "text-slate-900" : "text-slate-300"}`}>
                        {r.qty === null ? "—" : r.qty.toLocaleString("en-IN")}
                      </span>
                    )}
                  </td>
                  <td className="td min-w-[15rem] max-w-xs">
                    <p className="text-slate-700">{r.reason}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      4-wk {r.avg4} · 12-wk {r.avg12} · demand {r.demand}/wk
                    </p>
                  </td>
                  <td className="td">
                    <div className="space-y-1">
                      <StatusText status={r.status} />
                      <PushBadge id={r.id} status={r.push_status} error={r.push_error} poId={r.zoho_po_id} href={zohoOrgId && r.zoho_po_id && !r.zoho_po_id.startsWith("MOCK-") ? `https://inventory.zoho.in/app/${zohoOrgId}#/purchaseorders/${r.zoho_po_id}` : null} />
                    </div>
                  </td>
                  <td className="td min-w-[11rem]">
                    {r.action === "EXCEPTION" && r.status === "pending" ? (
                      <a href="/exceptions" className="btn btn-sm border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100">
                        Review →
                      </a>
                    ) : (
                      <DecisionControls rec={r} />
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="td py-14 text-center text-slate-500">
                  No recommendations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
