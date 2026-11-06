import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateConfigEntry } from "@/lib/configValidation";
import { apiUser, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await apiUser())) return jsonError("Unauthorized", 401);
  try {
    const body = (await req.json()) as { entries?: { key: unknown; value: unknown }[] };
    const entries = (body.entries ?? []).map((e) => ({ key: String(e.key), value: String(e.value).trim() }));
    const errors = entries.map((e) => validateConfigEntry(e.key, e.value)).filter((e): e is string => e !== null);
    if (errors.length) return jsonError(errors.join("; "));
    const { error } = await supabaseAdmin().from("config").upsert(entries);
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: entries.length });
  } catch (err) {
    console.error("config save failed", err);
    return jsonError((err as Error).message, 500);
  }
}
