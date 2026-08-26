export type Kind = "i" | "o";

/**
 * v4 metro row: [id, name, ext, size, day, ownerEmail, md5, kind, folders]
 * folders = folder-name path from the root down to the file's parent,
 * e.g. ["ours", "Brazil"] or ["reason_map(exisiting_dataset)", "china"].
 */
export type Row = readonly [
  id: string,
  name: string,
  ext: string,
  size: number,
  day: string,
  who: string,
  md5: string,
  kind: Kind,
  folders: string[],
];

export interface DupGroup {
  md5: string;
  count: number;
  size: number;
  names: string[];
}

export interface Counts {
  all: number;
  images: number;
  pdfs: number;
  imagesRaw: number;
  imagesUnique: number;
  dupCopies: number;
  videos: number;
  bytes: number;
  countries: number;
  cities: number;
}

export interface Latest {
  version: number;
  meta: { scannedAt: string; cron: string; counts: Counts };
  files: Row[];
  owners: Record<string, string>;
  dupGroups: DupGroup[];
  /** fileId → [width, height] (images only; PDFs absent) */
  exif?: Record<string, number[]>;
  cams?: string[];
}
