/** Route → what "these / here" means on that page. Order matters. */
const ROUTE_HINTS: [RegExp, string][] = [
  [/^\/gallery\/?$/, "the image gallery — 'these' means the images matching the visible filters (who/ext/orient/minmp in the query string)"],
  [/^\/gallery\/insights/, "the dataset insights page (orientation, resolution, file types, cameras)"],
  [/^\/gallery\/duplicates/, "the duplicates page — 'these' means the byte-identical duplicate groups listed"],
  [/^\/gallery\/contributors\/.+$/, "a single contributor's page — 'these' means that contributor's images"],
  [/^\/gallery\/contributors$/, "the contributors ranking table"],
  [/^\/contribute\/evaluate/, "the model evaluation page (grading VLM responses)"],
  [/^\/contribute\/?$/, "the question authoring page"],
  [/^\/project/, "the project description page"],
  [/^\/$/, "the overview page"],
];

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
  const hint = ROUTE_HINTS.find(([re]) => re.test(path))?.[1];
  const base = `VIEWING: ${path}${qs ? `?${qs}` : ""}${hint ? ` — ${hint}` : " (the user's current dashboard view — questions like 'these' or 'here' refer to it)"}`;
  return base;
}
