/** POST JSON and return the parsed body; throws with the server's error message on failure. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export interface DecisionResponse {
  applied: number[];
  blocked: { id: number; sku: string; message: string }[];
  push: { pushed: number; failed: number; skipped: number; errors: string[] };
}

export function describeDecision(r: DecisionResponse): string {
  const parts = [`${r.applied.length} updated`];
  if (r.push.pushed) parts.push(`${r.push.pushed} pushed to Zoho`);
  if (r.push.failed) parts.push(`${r.push.failed} push failed (approval kept — retry from the row)`);
  if (r.blocked.length) parts.push(`blocked: ${r.blocked.map((b) => `${b.sku} (${b.message})`).join(", ")}`);
  return parts.join(" · ");
}
