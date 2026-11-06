import { supabaseAdmin } from "./supabase/admin";
import { supabaseServer } from "./supabase/server";
import { authBypassed, localUser } from "./authMode";

export async function isEmailAllowed(email: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().rpc("email_allowed", { p_email: email });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.error("isEmailAllowed failed", err);
    return false;
  }
}

/** Email of the signed-in, allow-listed user, or null. */
export async function currentUserEmail(): Promise<string | null> {
  if (authBypassed()) return localUser();
  try {
    const { data, error } = await supabaseServer().auth.getUser();
    if (error || !data.user?.email) return null;
    return (await isEmailAllowed(data.user.email)) ? data.user.email : null;
  } catch (err) {
    console.error("currentUserEmail failed", err);
    return null;
  }
}
