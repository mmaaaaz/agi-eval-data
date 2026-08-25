/**
 * Shared text normalization for the questions pipeline.
 * Consumed by BOTH the relay Worker (dedupe enforcement) and the web app
 * (live near-match checks) — the two MUST stay identical or dedupe drifts.
 * A workspace migration (packages/shared) can absorb this file as-is.
 */

/** Canonical question identity: lowercase, punctuation stripped, whitespace collapsed. */
export function normQ(q: string): string {
  return q.toLowerCase().replace(/[?!.,'"():;`]/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse a comma-separated tag string into clean unique tags. */
export function normTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const t of raw.split(",")) {
    const tag = t.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** Whitespace-collapsed SQL — identity for the eval cache and the UI dedupe. */
export function normSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
