/** Image + doc URL builders — the ONLY place that knows how upstream content is served.
 *
 *  Images live in the public upstream repo under Git LFS. raw.githubusercontent
 *  serves the LFS POINTER TEXT for these paths (verified) — the media host serves
 *  the real PNG bytes anonymously with CORS * (verified 2026-08-30).
 *  jsDelivr can NOT resolve LFS blobs either — never use it for images.
 */

export const UPSTREAM_REPO = "bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset";

const MEDIA = `https://media.githubusercontent.com/media/${UPSTREAM_REPO}/main`;
const RAW = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main`;

/** Real PNG bytes for a repo-relative dataset path (LFS-backed). */
export function gripImageUrl(repoPath: string): string {
  return `${MEDIA}/${repoPath.replace(/^\/+/, "")}`;
}

/** Pointer-free raw text (JSON/MD/TXT docs — NOT for LFS images). */
export function upstreamJsonUrl(repoPath: string): string {
  return `${RAW}/${repoPath.replace(/^\/+/, "")}`;
}

/** Human-facing github.com blob page (for docs links). */
export function upstreamBlobUrl(repoPath: string): string {
  return `https://github.com/${UPSTREAM_REPO}/blob/main/${repoPath.replace(/^\/+/, "")}`;
}
