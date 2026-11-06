import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { apiUser, isCron, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!isCron(req) && !(await apiUser())) return jsonError("Unauthorized", 401);
  try {
    const summary = await runPipeline();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("run failed", err);
    return jsonError(`Run failed: ${(err as Error).message}`, 500);
  }
}

// Vercel Cron calls GET with "Authorization: Bearer $CRON_SECRET"; the dashboard uses POST.
export const GET = handle;
export const POST = handle;
