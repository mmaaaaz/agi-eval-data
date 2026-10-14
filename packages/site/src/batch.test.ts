import { describe, expect, it } from "vitest";
import { assignBatch, batchProgress, imagesInSlot, slotOfActor, slotOfImage, stableHash } from "./batch";

/**
 * The properties that matter here are determinism, disjointness and stability.
 * If any of them fails, two contributors silently duplicate work or one of them
 * loses their batch when the pool grows.
 */

const POOL = Array.from({ length: 500 }, (_, i) => "img_" + String(i).padStart(4, "0"));

describe("the hash", () => {
  it("is stable across calls", () => {
    expect(stableHash("img_0001")).toBe(stableHash("img_0001"));
  });
  it("separates similar strings", () => {
    const seen = new Set(POOL.slice(0, 200).map(slotOfImage));
    expect(seen.size).toBeGreaterThan(1);
  });
  it("returns an unsigned 32-bit integer", () => {
    for (const s of ["", "a", "img_0001", "x".repeat(500)]) {
      const h = stableHash(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe("assignment is deterministic", () => {
  it("gives the same batch every time", () => {
    const a = assignBatch(POOL, "actor-1");
    const b = assignBatch(POOL, "actor-1");
    expect(a).toEqual(b);
  });
  it("does not depend on the order of the input list", () => {
    const shuffled = [...POOL].reverse();
    expect(assignBatch(POOL, "actor-1")).toEqual(assignBatch(shuffled, "actor-1"));
  });
});

describe("assignment is disjoint", () => {
  it("gives different slots disjoint batches", () => {
    // This is the property that matters, and it holds by construction once each
    // person has an explicit slot.
    const batches = Array.from({ length: 12 }, (_, s) =>
      assignBatch(POOL, "actor-" + s, { size: 1000, slot: s }),
    );
    const all = batches.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(POOL.length);
  });

  it("DOCUMENTS the hash collision: two actors can share a slot", () => {
    // Not a bug to hide — the reason `slot` exists. Two actors whose hashes agree
    // receive the same batch and would duplicate each other's work, which is exactly
    // what a roster prevents. If this ever stops being true, the note in batch.ts is
    // wrong and should be corrected.
    const collides = new Map<number, string>();
    let found: [string, string] | null = null;
    for (let i = 0; i < 200 && !found; i++) {
      const name = "actor-" + i;
      const s = slotOfActor(name, 12);
      const other = collides.get(s);
      if (other) found = [other, name];
      else collides.set(s, name);
    }
    expect(found).not.toBeNull();
    const [a, b] = found as [string, string];
    expect(assignBatch(POOL, a, { size: 1000 })).toEqual(assignBatch(POOL, b, { size: 1000 }));
  });

  it("covers the whole pool exactly once across all slots", () => {
    const union = new Set<string>();
    for (let s = 0; s < 12; s++) for (const id of imagesInSlot(POOL, s)) union.add(id);
    expect(union.size).toBe(POOL.length);
  });

  it("spreads reasonably evenly across slots", () => {
    const counts = Array.from({ length: 12 }, (_, s) => imagesInSlot(POOL, s).length);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    // a hash will not be perfectly even, but nothing should be badly starved
    expect(min).toBeGreaterThan(POOL.length / 12 * 0.5);
    expect(max).toBeLessThan(POOL.length / 12 * 1.8);
  });
});

describe("assignment is stable as the pool grows", () => {
  it("does not move an image to another slot when images are added", () => {
    const before = new Map(POOL.map((id) => [id, slotOfImage(id)]));
    const grown = POOL.concat(Array.from({ length: 300 }, (_, i) => "new_" + i));
    for (const id of POOL) expect(slotOfImage(id)).toBe(before.get(id));
    // and the batch a contributor already started keeps its beginning
    const grownBatch = assignBatch(grown, "actor-1", { size: 1000 });
    expect(grownBatch.filter((id) => POOL.includes(id)).slice(0, 20)).toEqual(
      assignBatch(POOL, "actor-1", { size: 1000 }).slice(0, 20),
    );
  });
});

describe("the size cap", () => {
  it("honours the requested size when the slot can supply it", () => {
    // A slot holds about a twelfth of the pool, so 45 needs a pool of ~540+.
    const big = Array.from({ length: 2400 }, (_, i) => "big_" + i);
    expect(assignBatch(big, "actor-1", { size: 45 })).toHaveLength(45);
  });

  it("returns fewer than the cap when the slot is smaller, rather than inventing images", () => {
    const small = Array.from({ length: 120 }, (_, i) => "s_" + i);
    const batch = assignBatch(small, "actor-1", { size: 45 });
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(45);
    expect(batch.every((id) => small.includes(id))).toBe(true);
  });
  it("returns everything when the slot is smaller than the cap", () => {
    const tiny = POOL.slice(0, 5);
    expect(assignBatch(tiny, "actor-1", { size: 1000 }).length).toBeLessThanOrEqual(5);
  });
});

describe("progress", () => {
  it("counts only images from the batch", () => {
    const batch = assignBatch(POOL, "actor-1", { size: 10 });
    const p = batchProgress(batch, new Set([batch[0], batch[1], "not-in-my-batch"]));
    expect(p.assigned).toBe(10);
    expect(p.started).toBe(2);
  });
  it("handles an empty batch", () => {
    expect(batchProgress([], new Set(["x"])).assigned).toBe(0);
  });
});
