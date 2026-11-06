import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await supabaseServer().auth.signOut();
  } catch (err) {
    console.error("sign out failed", err);
  }
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
