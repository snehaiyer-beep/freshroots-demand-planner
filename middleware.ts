import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authBypassed } from "./lib/authMode";

const PUBLIC_PATHS = ["/login", "/api/"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  // Local no-login mode: skip sign-in entirely, and send /login straight to the dashboard.
  if (authBypassed()) {
    return path.startsWith("/login") ? NextResponse.redirect(new URL("/", request.url)) : response;
  }
  // API routes authenticate themselves (Bearer CRON_SECRET or session).
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const toLogin = (error?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = error ? `?error=${error}` : "";
    return NextResponse.redirect(url);
  };

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return toLogin();
    const { data: allowed, error } = await supabase.rpc("is_allowed");
    if (error || allowed !== true) {
      await supabase.auth.signOut();
      return toLogin("not_allowed");
    }
  } catch (err) {
    console.error("middleware auth failed", err);
    return toLogin();
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
