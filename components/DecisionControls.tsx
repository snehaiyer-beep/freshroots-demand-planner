"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OVERRIDE_REASONS } from "@/lib/types";
import type { RecWithSku } from "@/lib/data";
import { describeDecision, postJson, type DecisionResponse } from "./http";
import { IconAlert, IconCheck, IconEdit, IconX } from "./icons";

export function isUnmapped(rec: RecWithSku): boolean {
  return !rec.skus?.zoho_item_id?.trim() || !rec.skus?.vendor_id?.trim();
}

/**
 * Per-row controls. "recommendation" mode: Approve / Edit qty / Reject.
 * "exception" mode: set qty + reason, then approve (→ push), or Skip.
 */
export function DecisionControls({ rec, mode = "recommendation" }: { rec: RecWithSku; mode?: "recommendation" | "exception" }) {
  const router = useRouter();
  const [editing, setEditing] = useState(mode === "exception");
  const [qty, setQty] = useState<string>(String(rec.final_qty ?? rec.qty ?? ""));
  const [reason, setReason] = useState<string>(mode === "exception" && rec.flags.some((f) => f.startsWith("new_")) ? "new launch" : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const locked = Boolean(rec.zoho_po_id);
  const unmapped = isUnmapped(rec);
  const decided = rec.status !== "pending";

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<DecisionResponse>("/api/recommendations", { ids: [rec.id], ...body });
      setMsg(describeDecision(r));
      if (r.applied.length && mode === "recommendation") setEditing(false);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (locked) return <span className="text-xs text-slate-400">Locked · sent to Zoho</span>;

  const qtyNum = Number(qty);
  const mapWarning = unmapped && (editing ? qtyNum > 0 : (rec.qty ?? 0) > 0);

  return (
    <div className="space-y-1.5">
      {mapWarning && (
        <a href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">
          <IconAlert width={13} height={13} /> Map in Zoho first
        </a>
      )}
      {!editing ? (
        <div className="flex flex-wrap items-center gap-1">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || rec.qty === null || mapWarning}
            onClick={() => send({ kind: "approve" })}
            title={rec.qty === null ? "Set a quantity first" : "Approve"}
          >
            <IconCheck width={14} height={14} strokeWidth={2.2} /> {decided ? "Re-approve" : "Approve"}
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)} title="Change quantity">
            <IconEdit width={14} height={14} /> Edit
          </button>
          <button className="btn btn-ghost btn-sm text-slate-500 hover:text-red-700" disabled={busy} onClick={() => send({ kind: "reject" })} title="Reject">
            <IconX width={14} height={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input w-24 py-1 text-right tabular-nums"
            placeholder="Qty"
            aria-label="Quantity"
          />
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="input py-1" aria-label="Override reason">
            <option value="">Reason…</option>
            {OVERRIDE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          {reason === "other" && <input value={note} onChange={(e) => setNote(e.target.value)} className="input w-40 py-1" placeholder="Explain" />}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || qty === "" || !Number.isInteger(qtyNum) || qtyNum < 0 || !reason || mapWarning}
            onClick={() => send({ kind: "edit", qty: qtyNum, reason, note })}
          >
            <IconCheck width={14} height={14} strokeWidth={2.2} /> {mode === "exception" ? "Approve & push" : "Save"}
          </button>
          {mode === "exception" ? (
            <button className="btn btn-sm" disabled={busy} onClick={() => send({ kind: "reject", note: "skipped" })}>
              Skip
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {decided && !msg && (
        <p className="text-[11px] text-slate-400">
          by {rec.approved_by}
          {rec.final_qty !== null ? ` · qty ${rec.final_qty.toLocaleString("en-IN")}` : ""}
          {rec.override_reason ? ` · ${rec.override_reason}` : ""}
        </p>
      )}
      {msg && <p className="max-w-xs text-[11px] text-slate-600">{msg}</p>}
    </div>
  );
}
