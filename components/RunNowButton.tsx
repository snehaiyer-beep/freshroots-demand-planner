"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "./http";
import { IconPlay } from "./icons";

interface RunSummary { runId: number; count: number; byAction: Record<string, number>; poSync: string }

export function RunNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<RunSummary>("/api/run", {});
      setMsg({ ok: true, text: `Run #${r.runId} done · ${r.count} SKUs · ${r.poSync}` });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button className="btn btn-primary px-4 py-2" onClick={run} disabled={busy}>
        <IconPlay width={15} height={15} className={busy ? "animate-pulse" : ""} />
        {busy ? "Running…" : "Run now"}
      </button>
      {msg && <p className={`max-w-sm text-right text-xs ${msg.ok ? "text-slate-500" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
