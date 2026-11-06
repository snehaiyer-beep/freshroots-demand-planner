import { NextResponse } from "next/server";
import { currentUserEmail } from "./auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Email of the allow-listed caller, or null. */
export async function apiUser(): Promise<string | null> {
  return currentUserEmail();
}

export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

export function parseIds(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}
