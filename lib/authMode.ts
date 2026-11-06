/**
 * No-login mode: with AUTH_DISABLED=true the app skips sign-in everywhere (local and deployed).
 * Remove the variable (or set it to anything else) to require login again.
 */
export function authBypassed(): boolean {
  return process.env.AUTH_DISABLED === "true";
}

/** Name recorded as approved_by in no-login mode. */
export function localUser(): string {
  return process.env.LOCAL_USER_EMAIL?.trim() || "planner";
}
