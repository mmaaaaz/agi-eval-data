import { CATEGORIES } from "./categories";
import { FAMILIES } from "./families";

export interface SampleQuestion {
  family: (typeof FAMILIES)[number]["id"];
  q: string;
  a: string;
}

export interface Sample {
  /** ledger file id from data/latest.json (row[0]) */
  id: string;
  /** filename from the ledger (row[1]) */
  name: string;
  /** category id from CATEGORIES */
  category: string;
  /** what is actually visible in the photograph, written AFTER viewing it */
  sighted: string;
  /** hot-linked thumbnail, same CDN the dataset site uses */
  thumbUrl: string;
  /** deep link into the dataset gallery */
  sourceUrl: string;
  questions: SampleQuestion[];
}

/** Filled in after the image-review pass; must end with 10 entries across
 *  at least 7 categories, covering all six question families. */
export const SAMPLES: Sample[] = [];
