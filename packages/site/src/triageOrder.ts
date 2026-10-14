/**
 * Triage steering.
 *
 * WHY THIS EXISTS
 * ---------------
 * The triage screen DISPLAYED quota progress and did not act on it. The queue was
 * filtered only by contributor and by "undecided", so every triager walked the corpus in
 * its stored order and the rare resolution bands were still lost to random choice — which
 * is exactly what the screen's own comment said the quotas were for. A progress bar that
 * shows you are ignoring the scarce images is not steering.
 *
 * The order is by BAND SCARCITY: the rarest band's images come first, so a triager who
 * stops after ten minutes has spent that time on the images there are only 142 of, not on
 * the 36,000-strong band. It is stable — it depends only on the corpus, never on what has
 * already been decided — so the queue does not reorder itself under the triager's hand,
 * which would be worse than no steering at all.
 *
 * The "unknown" band goes last: it means the metadata was missing, not that the band is
 * rare, and leading with unlabelled images would be a different bug.
 */

export interface ScarcityOptions<T> {
  /** file_id for a row, used to look up its band. */
  idOf: (row: T) => string;
  bandOf: (id: string) => string;
  /** how many corpus images fall in each band. */
  counts: Record<string, number>;
  /** bands that must never lead. */
  lastBands?: readonly string[];
}

export function orderByScarcity<T>(rows: readonly T[], opts: ScarcityOptions<T>): T[] {
  const last = new Set(opts.lastBands ?? ["unknown"]);
  const key = (row: T): [number, number] => {
    const b = opts.bandOf(opts.idOf(row));
    const isLast = last.has(b) ? 1 : 0;
    return [isLast, opts.counts[b] ?? 0];
  };
  // Decorate with the original index so the sort is STABLE: two images in the same band
  // keep their relative order, and the whole queue is a deterministic function of the
  // corpus rather than of iteration order.
  return rows
    .map((row, i) => ({ row, i, k: key(row) }))
    .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.i - b.i))
    .map((x) => x.row);
}


/**
 * Per-band quotas.
 *
 * THE BUG THIS FIXES
 * ------------------
 * The quota was `max(RARE_FLOOR, round(TARGET * have / total))`. With TARGET = 2,500 and a
 * candidate pool of 600, EVERY band was asked for about four times what it contained:
 * 1-4 MP wanted 1,808 of 434, and the rare bands wanted 104 of 25.
 *
 * So a triager who chose every single image would still see every band under quota. The
 * progress bar could not be satisfied, and it was telling them they were failing.
 *
 * A quota you cannot reach is not a goal, it is a bug. The cap is `have`: you cannot
 * choose what is not there.
 *
 * AND THE POOL SHORTFALL IS REPORTED, NOT HIDDEN. If the pool is smaller than the target,
 * capping quietly would make a too-small selection look complete — which is the more
 * dangerous failure, because the run would proceed on a pool that cannot produce the
 * benchmark the plan describes. The caller gets `shortfall` and is expected to say so.
 */
export interface BandQuota {
  band: string;
  have: number;
  target: number;
}

export interface QuotaPlan {
  quotas: BandQuota[];
  /** how many more images the pool needs to reach the target. 0 when the pool is big enough. */
  shortfall: number;
  /** true when a capped quota is holding the total below the target. */
  poolTooSmall: boolean;
}

export function bandQuotas(
  bands: Record<string, number>,
  target: number,
  rareFloor = 25,
): QuotaPlan {
  const total = Object.values(bands).reduce((a, b) => a + b, 0);
  const quotas: BandQuota[] = [];
  if (total === 0) return { quotas, shortfall: Math.max(0, target), poolTooSmall: target > 0 };
  for (const b of Object.keys(bands).sort()) {
    const have = bands[b] ?? 0;
    if (have <= 0) continue;
    const wanted = Math.max(rareFloor, Math.round((target * have) / total));
    quotas.push({ band: b, have, target: Math.min(have, wanted) });
  }
  const reachable = quotas.reduce((a, q) => a + q.target, 0);
  return {
    quotas,
    shortfall: Math.max(0, target - total),
    poolTooSmall: reachable < target,
  };
}
