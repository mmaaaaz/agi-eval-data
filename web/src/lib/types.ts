export type Kind = "i" | "v" | "o";

/** [id, name, ext, size, day, ownerEmail, md5, kind] */
export type Row = readonly [
  id: string,
  name: string,
  ext: string,
  size: number,
  day: string,
  who: string,
  md5: string,
  kind: Kind,
];

export interface DupGroup {
  md5: string;
  count: number;
  size: number;
  names: string[];
}

export interface Counts {
  all: number;
  imagesRaw: number;
  imagesUnique: number;
  dupCopies: number;
  videos: number;
  bytes: number;
}

export interface Latest {
  version: number;
  meta: { scannedAt: string; cron: string; counts: Counts };
  files: Row[];
  owners: Record<string, string>;
  dupGroups: DupGroup[];
  /** v3: fileId → [width, height, cameraIndex?] (cameraIndex absent = unknown) */
  exif?: Record<string, number[]>;
  cams?: string[];
}
