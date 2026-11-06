/** Zoho connection pill: green "Zoho Inventory · live" or grey "Zoho mock mode". */
export function ZohoStatus({ live, orgName }: { live: boolean; orgName?: string | null }) {
  if (!live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/70 px-2.5 py-1 text-xs font-medium text-slate-600">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Zoho mock mode
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      Zoho Inventory connected{orgName ? ` · ${orgName}` : ""}
    </span>
  );
}
