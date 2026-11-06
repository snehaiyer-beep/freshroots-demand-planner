import { NextResponse } from "next/server";
import { pushPOs } from "@/lib/zoho";
import { apiUser, jsonError, parseIds } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await apiUser())) return jsonError("Unauthorized", 401);
  try {
    const body = (await req.json()) as { ids?: unknown };
    const ids = parseIds(body.ids);
    if (ids.length === 0) return jsonError("No recommendations selected");
    return NextResponse.json(await pushPOs(ids));
  } catch (err) {
    console.error("retry failed", err);
    return jsonError((err as Error).message, 500);
  }
}
