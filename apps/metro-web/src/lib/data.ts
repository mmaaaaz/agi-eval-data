/**
 * Metro dataset client: shared cache/fetch/hook + selectors from @site/data,
 * plus the metro-only folder-taxonomy selectors that stay app-specific.
 *
 * The metro row tuple carries a 9th element (`folders`); the shared Row type
 * is an 8-tuple, so the folder accessors narrow through a small type alias.
 */
import type { Latest, Row as SiteRow } from "@site/data";

export {
  ownerName,
  exifOf,
  orientationOf,
  megapixels,
  readCached,
  fetchLatest,
  useLatest,
  imageRows,
  dupCounts,
  ownerStats,
  byDay,
} from "@site/data";
export type {
  Row,
  Kind,
  Orientation,
  ExifInfo,
  LatestState,
  DataConfig,
  OwnerStat,
} from "@site/data";

/** metro rows carry the folder path at index 8 (optional in the shared tuple). */
function foldersOf(row: SiteRow): readonly string[] | undefined {
  return row[8];
}

/* ---------- folder taxonomy helpers (metro-only) ---------- */

export function branchOf(row: SiteRow): string {
  return foldersOf(row)?.[0] ?? "ours";
}

export function countryOf(row: SiteRow): string {
  // ["ours", "Brazil"] → Brazil ; ["reason_map(...)", "china"] → china
  return foldersOf(row)?.[1] ?? "";
}

export function isPdf(row: SiteRow): boolean {
  return row[7] === "o";
}

/** Pretty city label from the filename: "Fortaleza Metro Map.jpg" → "Fortaleza". */
export function cityName(row: SiteRow): string {
  const base = row[1].replace(/\.[a-z0-9]+$/i, "");
  return base
    .replace(/\b(Metro|MetroRail|Metrorail|Railway|Rail|Map|Route|Network|Transit)\b/gi, "")
    .replace(/\b(v1|v2)\b/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** catalog rows: images AND pdfs */
export function catalogRows(latest: Latest): SiteRow[] {
  return latest.files.filter((r) => r[7] === "i" || r[7] === "o");
}

export interface CountryStat {
  name: string;
  branch: string;
  images: number;
  pdfs: number;
  /** file ids, newest first */
  ids: string[];
  sampleId: string;
}

/** Group catalog rows by (branch, country). Countries with no images are skipped. */
export function countriesOf(latest: Latest): CountryStat[] {
  const m = new Map<string, CountryStat>();
  for (const r of catalogRows(latest)) {
    const branch = branchOf(r);
    const country = countryOf(r);
    if (!country) continue;
    const key = `${branch}::${country}`;
    let s = m.get(key);
    if (!s) m.set(key, (s = { name: country, branch, images: 0, pdfs: 0, ids: [], sampleId: "" }));
    if (r[7] === "i") s.images++;
    else s.pdfs++;
    s.ids.push(r[0]);
  }
  for (const s of m.values()) {
    if (s.images === 0 && s.pdfs === 0) continue;
    s.sampleId = s.ids.find((id) => {
      const r = latest.files.find((f) => f[0] === id);
      return r && r[7] === "i";
    }) ?? s.ids[0] ?? "";
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}
