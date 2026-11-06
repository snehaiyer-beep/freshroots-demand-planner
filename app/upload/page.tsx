"use client";

import { useState } from "react";

interface UploadResult { kind: string; upserted: number; errors: { line: number; message: string }[] }

function UploadCard({ kind, title, columns }: { kind: "sales" | "stock"; title: string; columns: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as UploadResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <p className="font-mono text-xs text-slate-500">{columns}</p>
      </div>
      <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
      <button className="btn btn-primary" disabled={!file || busy} onClick={upload}>
        {busy ? "Uploading…" : "Validate & upload"}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {result && (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium text-emerald-700">{result.upserted} rows upserted</span>
            {" · "}
            <span className={result.errors.length ? "font-medium text-red-700" : "text-slate-500"}>
              {result.errors.length} row error{result.errors.length === 1 ? "" : "s"}
            </span>
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-red-200 bg-red-50">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="th">Line</th>
                    <th className="th">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.slice(0, 500).map((e) => (
                    <tr key={e.line}>
                      <td className="td tabular-nums">{e.line}</td>
                      <td className="td">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload SAP exports</h1>
        <p className="text-sm text-slate-500">
          Valid rows are upserted; invalid rows are listed and skipped. week_start accepts YYYY-MM-DD or ISO weeks like 2026-W42.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard kind="sales" title="sales.csv" columns="week_start,sku,distributor_id,units" />
        <UploadCard kind="stock" title="stock.csv" columns="sku,on_hand" />
      </div>
    </div>
  );
}
