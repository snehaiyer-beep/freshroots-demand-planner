"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { IconAlert, IconBox, IconLeaf, IconList, IconLogout, IconSettings, IconTarget, IconUpload } from "./icons";

const LINKS = [
  { href: "/", label: "Recommendations", icon: IconList },
  { href: "/exceptions", label: "Exceptions", icon: IconAlert },
  { href: "/upload", label: "Upload data", icon: IconUpload },
  { href: "/pos", label: "Purchase orders", icon: IconBox },
  { href: "/accuracy", label: "Accuracy", icon: IconTarget },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
        <IconLeaf width={20} height={20} />
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-white">Freshroots</div>
        <div className="text-xs text-emerald-200/70">Demand Planner</div>
      </div>
    </div>
  );
}

/** App chrome: dark sidebar on desktop, compact top bar on mobile. Hidden on /login. */
export function Shell({ email, localMode = false, zohoLive = false, children }: { email: string | null; localMode?: boolean; zohoLive?: boolean; children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith("/login")) return <>{children}</>;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0b2a22] px-4 py-5 md:sticky md:top-0 md:flex md:h-screen">
        <Brand />
        <nav className="mt-8 flex flex-col gap-0.5">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                isActive(href) ? "bg-white/10 font-medium text-white" : "text-emerald-100/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className={isActive(href) ? "text-emerald-300" : ""} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-4">
          <div className="mb-3 flex items-center gap-2 px-3 text-xs">
            <span className={`h-2 w-2 rounded-full ${zohoLive ? "bg-emerald-400" : "bg-slate-500"}`} />
            <span className={zohoLive ? "text-emerald-100" : "text-emerald-100/60"}>{zohoLive ? "Zoho Inventory · live" : "Zoho · mock mode"}</span>
          </div>
          {email && <p className="truncate px-3 text-xs text-emerald-100/60" title={email}>{email}</p>}
          {localMode ? (
            <p className="mt-1 px-3 py-2 text-xs text-emerald-200/70">No sign-in required</p>
          ) : (
            <form action="/auth/signout" method="post">
              <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-emerald-100/70 transition hover:bg-white/5 hover:text-white">
                <IconLogout /> Sign out
              </button>
            </form>
          )}
        </div>
      </aside>

      <header className="sticky top-0 z-20 bg-[#0b2a22] px-4 py-3 md:hidden">
        <div className="flex items-center justify-between">
          <Brand />
          {!localMode && (
            <form action="/auth/signout" method="post">
              <button className="rounded-lg p-2 text-emerald-100/80 hover:bg-white/10" aria-label="Sign out">
                <IconLogout />
              </button>
            </form>
          )}
        </div>
        <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-1">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${isActive(href) ? "bg-white/15 text-white" : "text-emerald-100/70"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}
