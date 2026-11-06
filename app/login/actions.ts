"use server";

import { redirect } from "next/navigation";
import { isEmailAllowed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export interface LoginState { ok: boolean; message: string }

const MIN_PASSWORD = 8;

/**
 * Email + password login. mode "setup" lets an allow-listed email create its password the first time.
 * Emails not in allowed_users can never sign in or create an account.
 */
export async function authenticate(_prev: LoginState, form: FormData): Promise<LoginState> {
  const mode = form.get("mode") === "setup" ? "setup" : "signin";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
  if (password.length < MIN_PASSWORD) return { ok: false, message: `Password must be at least ${MIN_PASSWORD} characters.` };
  if (!(await isEmailAllowed(email))) {
    return { ok: false, message: "This email isn't on the allowed list. Ask an admin to add you." };
  }

  if (mode === "setup") {
    try {
      const { error } = await supabaseAdmin().auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) {
          return { ok: false, message: "You already have a password. Sign in instead." };
        }
        throw error;
      }
    } catch (err) {
      console.error("create user failed", err);
      return { ok: false, message: "Couldn't create your account. Try again in a minute." };
    }
  }

  try {
    const { error } = await supabaseServer().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: "Wrong email or password." };
  } catch (err) {
    console.error("sign in failed", err);
    return { ok: false, message: "Couldn't sign in. Try again in a minute." };
  }
  redirect("/");
}
