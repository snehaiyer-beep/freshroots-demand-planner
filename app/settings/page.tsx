import { supabaseAdmin } from "@/lib/supabase/admin";
import { CONFIG_KEYS } from "@/lib/configValidation";
import { zohoMockMode } from "@/lib/zoho";
import { ZohoStatus } from "@/components/ZohoStatus";
import type { SkuRow } from "@/lib/types";
import { ConfigForm, MappingTable } from "@/components/SettingsForms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let config: Record<string, string> = {};
  let skus: SkuRow[] = [];
  let loadError: string | null = null;
  try {
    const db = supabaseAdmin();
    const [c, s] = await Promise.all([db.from("config").select("key, value"), db.from("skus").select("*").order("sku")]);
    if (c.error) throw new Error(c.error.message);
    if (s.error) throw new Error(s.error.message);
    config = Object.fromEntries((c.data ?? []).map((r) => [r.key as string, r.value as string]));
    skus = (s.data ?? []) as SkuRow[];
  } catch (err) {
    loadError = (err as Error).message;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-slate-500">Rule thresholds apply from the next run. Zoho: {zohoMockMode() ? "mock mode (env not set)" : "live, India DC"}.</p>
        </div>
        <ZohoStatus live={!zohoMockMode()} />
      </div>
      {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Could not load data: {loadError}</p>}
      <ConfigForm keys={[...CONFIG_KEYS]} initial={config} />
      <MappingTable skus={skus} />
    </div>
  );
}
