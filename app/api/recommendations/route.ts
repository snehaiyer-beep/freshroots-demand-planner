import { NextResponse } from "next/server";
import { applyDecision, type Decision } from "@/lib/approvals";
import { apiUser, jsonError, parseIds } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body { ids?: unknown; kind?: unknown; qty?: unknown; reason?: unknown; note?: unknown }

export async function POST(req: Request) {
  const email = await apiUser();
  if (!email) return jsonError("Unauthorized", 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError("Invalid JSON");
  }
  const ids = parseIds(body.ids);
  if (ids.length === 0) return jsonError("No recommendations selected");
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;

  let decision: Decision;
  if (body.kind === "approve") decision = { kind: "approve" };
  else if (body.kind === "reject") decision = { kind: "reject", note };
  else if (body.kind === "edit") decision = { kind: "edit", qty: Number(body.qty), reason: String(body.reason ?? ""), note };
  else return jsonError("kind must be approve, edit or reject");

  try {
    return NextResponse.json(await applyDecision(ids, decision, email));
  } catch (err) {
    console.error("decision failed", err);
    return jsonError((err as Error).message, 500);
  }
}
