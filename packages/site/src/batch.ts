/**
 * Deterministic batch assignment.
 *
 * The problem: a 45,000-image pool and a dozen contributors will duplicate each
 * other's work unless someone decides who writes about what. Central assignment
 * needs coordination, a roster and a re-run every time the pool changes.
 *
 * The approach: give each IMAGE an intrinsic slot by hashing its id, and give each
 * CONTRIBUTOR a slot by hashing theirs. Nobody coordinates with anybody, and two
 * people cannot land on the same image.
 *
 * TWO KNOWN LIMITS, because they are real and a test proves them:
 *
 * 1. Hash-based slots do not guarantee every slot is staffed, so some images are
 *    never assigned to anyone. For a benchmark that is fine — the target is a few
 *    percent of the pool, not coverage of it.
 * 2. Two actors CAN hash to the same slot and then share a batch, which is exactly
 *    the duplication batches exist to prevent. The remedy is `slot`: the team lead
 *    sets one explicit slot per person once, and the assignment becomes disjoint by
 *    construction. The hash is only the zero-configuration default.
 *
 * Anyone can always search the full gallery beyond their batch.
 */

export const BATCH_SIZE = 45;
export const DEFAULT_SLOTS = 12;

/** FNV-1a, 32-bit. Small, fast, and stable across runs and machines. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The slot an image belongs to. Intrinsic to the image, so it never changes. */
export function slotOfImage(fileId: string, slots = DEFAULT_SLOTS): number {
  return stableHash("image:" + fileId) % slots;
}

/** The slot a contributor works in. */
export function slotOfActor(actorId: string, slots = DEFAULT_SLOTS): number {
  return stableHash("actor:" + actorId) % slots;
}

/** Every image belonging to one slot, in a stable order. */
export function imagesInSlot(fileIds: readonly string[], slot: number, slots = DEFAULT_SLOTS): string[] {
  const mine = fileIds.filter((id) => slotOfImage(id, slots) === slot);
  // Ordered by hash rather than by input position, so the order does not depend on
  // how the caller happened to build the list.
  return mine.sort((a, b) => {
    const ha = stableHash("order:" + a);
    const hb = stableHash("order:" + b);
    return ha === hb ? (a < b ? -1 : a > b ? 1 : 0) : ha - hb;
  });
}

/**
 * The batch for one contributor.
 *
 * Pass `slot` explicitly for a roster (disjoint by construction). Without it the slot
 * is derived from the actor id, which is convenient and can collide — see the note
 * at the top of this file.
 */
export function assignBatch(
  fileIds: readonly string[],
  actorId: string,
  opts: { slots?: number; size?: number; slot?: number } = {},
): string[] {
  const slots = opts.slots ?? DEFAULT_SLOTS;
  const size = opts.size ?? BATCH_SIZE;
  const slot = opts.slot ?? slotOfActor(actorId, slots);
  return imagesInSlot(fileIds, slot, slots).slice(0, size);
}

export interface BatchProgress {
  assigned: number;
  started: number;
  done: number;
}

/** How far through their batch a contributor is, given the images they have written on. */
export function batchProgress(batch: readonly string[], touched: ReadonlySet<string>): BatchProgress {
  let started = 0;
  for (const id of batch) if (touched.has(id)) started++;
  return { assigned: batch.length, started, done: started };
}
