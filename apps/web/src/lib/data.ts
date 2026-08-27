/**
 * Re-export of the shared dataset client. Kept at this path so existing
 * `../lib/data` imports across web routes keep working.
 */
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
  isImage,
  dayOf,
  ownerOf,
  md5Of,
  kindOf,
} from "@site/data";
export type {
  Row,
  Latest,
  Kind,
  Orientation,
  ExifInfo,
  LatestState,
  DataConfig,
  OwnerStat,
} from "@site/data";
