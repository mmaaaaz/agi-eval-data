import type { Latest } from "./types";
import { exifOf, orientationOf } from "./data";
import { fmtB, fmtN } from "./format";

/** Compact, token-lean dataset brief for the chat system prompt (~2.5 KB). */
export function datasetBrief(latest: Latest): string {
  const c = latest.meta.counts;
  const imgs = latest.files.filter((f) => f[7] === "i");

  const perOwner = new Map<string, { raw: number; uniq: Set<string>; bytes: number; days: Set<string> }>();
  for (const r of latest.files) {
    const o = perOwner.get(r[5]) ?? { raw: 0, uniq: new Set<string>(), bytes: 0, days: new Set<string>() };
    o.bytes += r[3];
    if (r[4] !== "?") o.days.add(r[4]);
    if (r[7] === "i") {
      o.raw++;
      if (r[6]) o.uniq.add(r[6]);
    }
    perOwner.set(r[5], o);
  }

  const exts = new Map<string, number>();
  let land = 0, por = 0, sq = 0, withExif = 0;
  const cams = new Map<string, number>();
  for (const r of imgs) {
    exts.set(r[2], (exts.get(r[2]) ?? 0) + 1);
    const e = exifOf(latest, r[0]);
    if (!e) continue;
    withExif++;
    const o = orientationOf(e.w, e.h);
    if (o === "landscape") land++; else if (o === "portrait") por++; else sq++;
    if (e.camera) cams.set(e.camera, (cams.get(e.camera) ?? 0) + 1);
  }
  const topExt = [...exts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([e, n]) => `${e}:${fmtN(n)}`).join(", ");
  const topCams = [...cams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([cam, n]) => `${cam}:${fmtN(n)}`).join(", ");

  const ownerLines = [...perOwner.entries()]
    .sort((a, b) => b[1].raw - a[1].raw)
    .map(([email, o]) => {
      const name = latest.owners[email] ?? email;
      return `- ${name} <${email}>: ${fmtN(o.raw)} pics, ${fmtN(o.uniq.size)} unique, ${fmtB(o.bytes)}, ${o.days.size} active days`;
    })
    .join("\n");

  return [
    `DATASET BRIEF — agi-eval-data (scanned ${latest.meta.scannedAt})`,
    `An AGI benchmark dataset: real-world images where vision models fail + geometric reasoning problems.`,
    ``,
    `COUNTS: ${fmtN(c.all)} items total | ${fmtN(c.imagesRaw)} image files | ${fmtN(c.imagesUnique)} unique after md5 dedup | ${fmtN(c.dupCopies)} duplicate copies | ${fmtN(c.videos)} videos (excluded) | ${fmtB(c.bytes)} stored`,
    `UPLOAD WINDOW: ${[...new Set(imgs.map((r) => r[4]).filter((d) => d !== "?"))].sort()[0] ?? "?"} → ${[...new Set(imgs.map((r) => r[4]).filter((d) => d !== "?"))].sort().at(-1) ?? "?"}`,
    `EXTENSIONS: ${topExt}`,
    withExif ? `EXIF: ${fmtN(withExif)} images with metadata | orientation L${land}/P${por}/S${sq} | cameras: ${topCams}` : `EXIF: not loaded yet`,
    ``,
    `CONTRIBUTORS (${perOwner.size}):`,
    ownerLines,
    ``,
    `DUPLICATES: ${fmtN(latest.dupGroups.length)} byte-identical groups (${fmtN(c.dupCopies)} extra copies). md5 dedup only — re-compressed variants are not flagged.`,
    ``,
    `You also have the run_sql tool over tables:`,
    `- images(id VARCHAR, name VARCHAR, ext VARCHAR, size BIGINT, day DATE-as-string 'YYYY-MM-DD', owner VARCHAR(email), md5 VARCHAR, kind VARCHAR['i'|'v'|'o'])`,
    `- owners(email VARCHAR, name VARCHAR)`,
    `- dup_groups(md5 VARCHAR, copies BIGINT, bytes BIGINT)`,
    `Rules: single SELECT only, always include LIMIT (auto-capped 200). kind 'i'=image 'v'=video 'o'=other. day compares as string 'YYYY-MM-DD'. owner is the email; join owners for display names.`,
  ].join("\n");
}

/** One-line URL context injected per user turn. */
export function viewingContext(pathname: string, search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v === "" || v === "*" || v === false || v == null) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return `VIEWING: ${pathname}${qs ? `?${qs}` : ""} (the user's current dashboard view — questions like "these" or "here" refer to it)`;
}
