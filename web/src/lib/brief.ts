/** One-line URL context injected per user turn (skipped when it adds nothing). */
export function viewingContext(pathname: string, search: Record<string, unknown>): string {
  // normalize: strip trailing slashes so "/ask/" and "/ask" behave the same
  const path = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === "" || v === "*" || v === false || v == null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (path === "/ask" && !qs) return "";
  return `VIEWING: ${path}${qs ? `?${qs}` : ""} (the user's current dashboard view — questions like "these" or "here" refer to it)`;
}
