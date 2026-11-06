"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SkuRow } from "@/lib/types";
import { postJson } from "./http";

const HELP: Record<string, string> = {
  high_demand_pct: "% by which avg4 must exceed avg12",
  high_demand_mult: "std_qty multiplier when demand is high",
  min_wks: "min cover (weeks), non-perishable",
  max_wks: "max cover (weeks), non-perishable",
  per_min_wks: "min cover (weeks), perishable",
  per_max_wks: "max cover (weeks), perishable",
  festival_uplift: "% demand uplift in festival months",
  festival_months: "comma-separated month numbers",
  swing_pct: "distributor swing threshold %",
  min_history_wks: "weeks of history before rules apply",
  push_mode: "draft or issued",
};

export function ConfigForm({ keys, initial }: { keys: string[]; initial: Record<string, string> }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const entries = keys.map((key) => ({ key, value: values[key] ?? "" }));
      const r = await postJson<{ saved: number }>("/api/config", { entries });
      setMsg({ ok: true, text: `Saved ${r.saved} settings.` });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold text-slate-900">Rule thresholds</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((key) => (
          <label key={key} className="text-sm">
            <span className="font-mono text-xs">{key}</span>
            {key === "push_mode" ? (
              <select
                className="input mt-1 block w-full"
                value={values[key] ?? "draft"}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              >
                <option value="draft">draft</option>
                <option value="issued">issued</option>
              </select>
            ) : (
              <input
                className="input mt-1 block w-full"
                value={values[key] ?? ""}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            )}
            <span className="text-xs text-slate-500">{HELP[key]}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save thresholds"}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}

function MappingRow({ sku }: { sku: SkuRow }) {
  const router = useRouter();
  const [item, setItem] = useState(sku.zoho_item_id ?? "");
  const [vendor, setVendor] = useState(sku.vendor_id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = item !== (sku.zoho_item_id ?? "") || vendor !== (sku.vendor_id ?? "");
  const unmapped = !item.trim() || !vendor.trim();

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await postJson("/api/skus", { sku: sku.sku, zoho_item_id: item, vendor_id: vendor });
      setMsg("Saved");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={unmapped ? "bg-amber-50" : ""}>
      <td className="td font-medium">{sku.sku}</td>
      <td className="td">
        {sku.name}
        {sku.perishable ? <span className="ml-1 text-xs text-slate-500">perishable</span> : null}
      </td>
      <td className="td text-right tabular-nums">{sku.std_qty}</td>
      <td className="td">
        <input className="input w-40 font-mono text-xs" value={item} onChange={(e) => setItem(e.target.value)} aria-label={`${sku.sku} Zoho item id`} />
      </td>
      <td className="td">
        <input className="input w-40 font-mono text-xs" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label={`${sku.sku} vendor id`} />
      </td>
      <td className="td">
        <button className="btn text-xs" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="ml-2 text-xs text-slate-500">{msg}</span>}
      </td>
    </tr>
  );
}

export function MappingTable({ skus }: { skus: SkuRow[] }) {
  const unmapped = skus.filter((s) => !s.zoho_item_id || !s.vendor_id).length;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h2 className="font-semibold text-slate-900">SKU → Zoho mapping</h2>
        {unmapped > 0 && <span className="text-sm text-amber-700">{unmapped} SKU(s) unmapped — approvals with qty are blocked</span>}
      </div>
      <div className="table-wrap">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="border-b border-slate-200 bg-slate-50/70">
            <tr>
              <th className="th">SKU</th>
              <th className="th">Name</th>
              <th className="th text-right">Std qty</th>
              <th className="th">Zoho item id</th>
              <th className="th">Vendor id</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {skus.map((s) => (
              <MappingRow key={s.sku} sku={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
