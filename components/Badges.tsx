"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import { useRouter } from "next/navigation";
import type { Action, PushStatus, RecStatus } from "@/lib/types";
import { postJson } from "./http";
import { IconAlert, IconArrowUp, IconCheck, IconPause, IconRefresh, IconSparkle } from "./icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export const ACTION_META: Record<Action, { label: string; short: string; icon: Icon; pill: string; tile: string; dot: string }> = {
  EXCEPTION: {
    label: "Needs review",
    short: "Needs review",
    icon: IconAlert,
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    tile: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  REORDER_NOW: {
    label: "Reorder now",
    short: "Reorder now",
    icon: IconArrowUp,
    pill: "bg-red-50 text-red-700 ring-red-200",
    tile: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  REORDER_HIGH: {
    label: "Reorder · high demand",
    short: "High demand",
    icon: IconArrowUp,
    pill: "bg-orange-50 text-orange-700 ring-orange-200",
    tile: "bg-orange-100 text-orange-700",
    dot: "bg-orange-500",
  },
  PAUSE: {
    label: "Pause",
    short: "Pause",
    icon: IconPause,
    pill: "bg-sky-50 text-sky-700 ring-sky-200",
    tile: "bg-sky-100 text-sky-700",
    dot: "bg-sky-500",
  },
  OK: {
    label: "On track",
    short: "On track",
    icon: IconCheck,
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    tile: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
  },
};

export function ActionBadge({ action }: { action: Action }) {
  const m = ACTION_META[action];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.pill}`}>
      <Icon width={13} height={13} strokeWidth={2.2} />
      {m.label}
    </span>
  );
}

const STATUS_META: Record<RecStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-600" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700" },
  edited: { label: "Approved (edited)", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", cls: "bg-slate-100 text-slate-400" },
};

export function StatusText({ status }: { status: RecStatus }) {
  const m = STATUS_META[status];
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

const FLAG_LABEL = (f: string) => {
  if (f === "new_product") return "New product";
  if (f === "new_launch") return "New launch";
  if (f === "anomaly") return "Unusual week";
  if (f === "festival") return "Festival uplift";
  if (f.startsWith("distributor_swing:")) return `Swing · ${f.split(":")[1]}`;
  return f;
};

export function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
            f === "new_product"
              ? "bg-violet-100 text-violet-800"
              : f === "festival"
                ? "bg-pink-50 text-pink-700"
                : "bg-amber-50 text-amber-800"
          }`}
        >
          {f === "festival" && <IconSparkle width={11} height={11} />}
          {FLAG_LABEL(f)}
        </span>
      ))}
    </div>
  );
}

/** Weeks of cover against the target window: shaded band = window, fill = cover. */
export function CoverMeter({ cover, min, max }: { cover: number | null; min: number; max: number }) {
  if (cover === null) {
    return (
      <div className="w-32">
        <div className="text-sm font-medium text-slate-400">No demand yet</div>
        <div className="mt-1 h-1.5 rounded-full bg-slate-100" />
      </div>
    );
  }
  const scaleMax = Math.max(max * 1.6, min + 1);
  const value = cover === null ? scaleMax : Math.min(cover, scaleMax);
  const state = cover === null || cover > max ? "over" : cover < min ? "under" : "ok";
  const fill = state === "under" ? "bg-red-500" : state === "over" ? "bg-sky-500" : "bg-emerald-500";
  const pct = (n: number) => `${(n / scaleMax) * 100}%`;
  return (
    <div className="w-32" title={`Target ${min}–${max} wks`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold tabular-nums text-slate-900">{cover === null ? "∞" : (Math.round(cover * 10) / 10).toFixed(1)}</span>
        <span className="text-[11px] text-slate-400">
          wks · {min}–{max}
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 rounded-full bg-emerald-100" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: pct(value) }} />
      </div>
    </div>
  );
}

/** Push status; failed shows a red badge with a Retry push button. */
export function PushBadge({ id, status, error, poId, href }: { id: number; status: PushStatus; error: string | null; poId: string | null; href?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (status === "sent") {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
          <IconCheck width={12} height={12} strokeWidth={2.4} /> Sent to Zoho
        </span>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-medium text-emerald-700 hover:underline">
            Open in Zoho ↗
          </a>
        ) : (
          <p className="max-w-[11rem] truncate font-mono text-[11px] text-slate-400" title={poId ?? undefined}>{poId}</p>
        )}
        {error && <p className="max-w-[14rem] text-[11px] text-amber-700">{error}</p>}
      </div>
    );
  }
  if (status === "not_sent") return <span className="text-xs text-slate-400">—</span>;

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<{ pushed: number; errors: string[] }>("/api/push/retry", { ids: [id] });
      setMsg(r.pushed ? "Pushed" : r.errors[0] ?? "Still failing");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white" title={error ?? undefined}>
        <IconAlert width={12} height={12} strokeWidth={2.4} /> Push failed
      </span>
      {error && <p className="max-w-[14rem] text-[11px] text-red-700">{error}</p>}
      <button className="btn btn-danger btn-sm" onClick={retry} disabled={busy}>
        <IconRefresh width={13} height={13} /> {busy ? "Retrying…" : "Retry push"}
      </button>
      {msg && <p className="text-[11px] text-slate-600">{msg}</p>}
    </div>
  );
}
