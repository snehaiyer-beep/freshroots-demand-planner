import { latestRun, recsForRun, type RecWithSku, type RunRow } from "@/lib/data";
import { parseConfig } from "@/lib/rules";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { zohoMockMode } from "@/lib/zoho";
import { ZohoStatus } from "@/components/ZohoStatus";
import { PageHeader } from "@/components/Nav";
import { RecommendationsTable, type Windows } from "@/components/RecommendationsTable";
import { RunNowButton } from "@/components/RunNowButton";
import { IconAlert } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  let run: RunRow | null = null;
  let recs: RecWithSku[] = [];
  let windows: Windows = { normal: { min: 6, max: 14 }, perishable: { min: 3, max: 4 } };
  let loadError: string | null = null;
  try {
    const [r, cfg] = await Promise.all([latestRun(), supabaseAdmin().from("config").select("key, value")]);
    run = r;
    if (run) recs = await recsForRun(run.id);
    const c = parseConfig(cfg.data ?? []);
    windows = { normal: { min: c.minWks, max: c.maxWks }, perishable: { min: c.perMinWks, max: c.perMaxWks } };
  } catch (err) {
    loadError = (err as Error).message;
  }

  const pendingExceptions = recs.filter((r) => r.action === "EXCEPTION" && r.status === "pending").length;
  const decided = recs.filter((r) => r.status !== "pending").length;
  const when = run ? new Date(run.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div>
      <PageHeader
        title="Recommendations"
        subtitle={
          run ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Run #{run.id} · {when} IST</span>
              <span className="text-slate-300">|</span>
              <span>
                {decided}/{recs.length} decided
              </span>
              <ZohoStatus live={!zohoMockMode()} />
            </span>
          ) : (
            "No runs yet. Press Run now to compute this week's recommendations."
          )
        }
        actions={<RunNowButton />}
      />

      {pendingExceptions > 0 && (
        <a
          href="/exceptions"
          className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 transition hover:bg-amber-100/70"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-200/60 text-amber-800">
            <IconAlert width={16} height={16} />
          </span>
          <span>
            <strong>{pendingExceptions}</strong> SKU{pendingExceptions === 1 ? " needs" : "s need"} Raghav&apos;s review before anything is ordered.
          </span>
          <span className="ml-auto font-medium">Review →</span>
        </a>
      )}
      {loadError && <p className="mb-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Could not load data: {loadError}</p>}

      <RecommendationsTable recs={recs} windows={windows} zohoOrgId={zohoMockMode() ? null : process.env.ZOHO_ORG_ID ?? null} />
    </div>
  );
}
