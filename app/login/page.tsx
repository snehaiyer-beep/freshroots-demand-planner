"use client";

import { Suspense, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { authenticate, type LoginState } from "./actions";
import { IconCheck, IconLeaf } from "@/components/icons";

const ERRORS: Record<string, string> = {
  not_allowed: "That account isn't on the allowed list.",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary w-full py-2.5 text-[15px]" disabled={pending}>
      {pending ? "Please wait…" : label}
    </button>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "setup">("signin");
  const [state, action] = useFormState<LoginState, FormData>(authenticate, { ok: false, message: "" });
  const message = state.message || ERRORS[params.get("error") ?? ""];

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        {(["signin", "setup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 transition ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {m === "signin" ? "Sign in" : "First time here"}
          </button>
        ))}
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="mode" value={mode} />
        <label className="block">
          <span className="label">Work email</span>
          <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="input mt-1.5 w-full py-2.5" />
        </label>
        <label className="block">
          <span className="label">{mode === "signin" ? "Password" : "Choose a password"}</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder={mode === "signin" ? "••••••••" : "At least 8 characters"}
            className="input mt-1.5 w-full py-2.5"
          />
        </label>
        <Submit label={mode === "signin" ? "Sign in" : "Create password & sign in"} />
        {mode === "setup" && <p className="text-xs text-slate-500">Only emails your admin has added can create a password.</p>}
        {message && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0b2a22] p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-lime-300/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
            <IconLeaf width={22} height={22} />
          </span>
          <span className="text-lg font-semibold">Freshroots</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Order the right amount, twice a week.</h2>
          <p className="mt-4 text-emerald-100/70">SAP sales and stock plus open Zoho POs, turned into clear reorder calls you approve in one place.</p>
          <ul className="mt-8 space-y-3 text-sm text-emerald-50/90">
            {[
              "Fixed, explainable rules for every SKU",
              "Exceptions flagged for a human decision",
              "Nothing reaches Zoho until you approve",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
                  <IconCheck width={14} height={14} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-700 text-white">
              <IconLeaf />
            </span>
            <span className="font-semibold">Freshroots Demand Planner</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-8 mt-1 text-sm text-slate-500">Sign in to review this week&apos;s recommendations.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
