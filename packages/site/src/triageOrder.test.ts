import { describe, expect, it } from "vitest";
import { bandQuotas, orderByScarcity } from "./triageOrder";

const COUNT: Record<string, number> = { "24+ MP": 2, "12-24 MP": 5, "4-12 MP": 20, "1-4 MP": 100, unknown: 3 };
const bandOf = (id: string) => id.split(":")[0];
const idOf = (r: string) => r;
const rows = [
  "1-4 MP:a", "1-4 MP:b", "24+ MP:c", "unknown:d", "12-24 MP:e", "24+ MP:f", "4-12 MP:g",
];

describe("triage steering by scarcity", () => {
  it("puts the rarest band first", () => {
    const out = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    expect(out[0]).toBe("24+ MP:c");
    expect(out[1]).toBe("24+ MP:f");
  });

  it("puts the commonest MEASURED band last, with 'unknown' after it", () => {
    // My first version of this expected 1-4 MP at the very end and failed: 'unknown' is
    // forced last overall, so it is the final element and 1-4 MP is the last of the
    // bands that carry a resolution at all. The code was right; the expectation was not.
    const out = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    expect(out[out.length - 1]).toBe("unknown:d");
    const measured = out.filter((r) => !r.startsWith("unknown"));
    expect(measured[measured.length - 1]).toBe("1-4 MP:b");
  });

  it("keeps 'unknown' out of the lead even though only 3 images carry it", () => {
    const out = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    expect(out.indexOf("unknown:d")).toBeGreaterThan(out.indexOf("4-12 MP:g"));
  });

  it("is STABLE within a band, so the queue does not shuffle underfoot", () => {
    const out = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    const a = out.indexOf("1-4 MP:a");
    const b = out.indexOf("1-4 MP:b");
    expect(a).toBeLessThan(b); // the original relative order survives
  });

  it("is a pure function of the corpus, not of prior decisions", () => {
    // Called twice with the same inputs, it must not drift — the real bug would be a
    // queue that reorders itself as the triager works.
    const one = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    const two = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    expect(one).toEqual(two);
  });

  it("never drops or duplicates a row", () => {
    const out = orderByScarcity(rows, { idOf, bandOf, counts: COUNT });
    expect(out).toHaveLength(rows.length);
    expect(new Set(out).size).toBe(rows.length);
  });

  it("handles an empty corpus and a band with no count", () => {
    expect(orderByScarcity([], { idOf, bandOf, counts: COUNT })).toEqual([]);
    const odd = orderByScarcity(["mystery:x"], { idOf, bandOf, counts: COUNT });
    expect(odd).toEqual(["mystery:x"]); // a band with no count sorts with the 0s, not a crash
  });
});


describe("band quotas are reachable", () => {
  // The real numbers that exposed the bug: a 600-image pool against a 2,500-image target.
  const POOL: Record<string, number> = {
    "1-4 MP": 434, "<1 MP": 91, "4-12 MP": 25, "12-24 MP": 25, "24+ MP": 25,
  };

  it("never asks a band for more images than it has", () => {
    // Every band used to be asked for ~4x what it contained, so the progress bar could
    // never be satisfied — a triager choosing everything still saw everything under quota.
    const { quotas } = bandQuotas(POOL, 2500);
    for (const q of quotas) expect(q.target).toBeLessThanOrEqual(q.have);
  });

  it("reports the pool as too small rather than pretending the quotas are complete", () => {
    const plan = bandQuotas(POOL, 2500);
    expect(plan.poolTooSmall).toBe(true);
    expect(plan.shortfall).toBe(1900); // 2500 wanted, 600 available
  });

  it("does not report a shortfall when the pool is big enough", () => {
    const big: Record<string, number> = { a: 2000, b: 1500 };
    const plan = bandQuotas(big, 2500);
    expect(plan.shortfall).toBe(0);
    expect(plan.poolTooSmall).toBe(false);
  });

  it("is proportionate for a band above the floor", () => {
    // My first version of this expected a rare band to be oversampled relative to its
    // size and failed. It should not be: the quota is PROPORTIONATE, and the oversampling
    // comes entirely from the floor. Asserting otherwise would have demanded a behaviour
    // the design does not have.
    const pool: Record<string, number> = { common: 9000, rare: 1000 };
    const { quotas } = bandQuotas(pool, 2000);
    const rare = quotas.find((q) => q.band === "rare")!;
    expect(rare.target).toBe(200); // 2000 * 1000/10000
  });

  it("oversamples a band whose proportionate share falls under the floor", () => {
    // This IS the oversampling, and it is what stops a 100-image band being allotted 2.
    // A ratio far above its frequency: 25% of the band's own images to exceed a target
    // where it is 0.1% of the corpus.
    const pool: Record<string, number> = { huge: 99900, tiny: 100 };
    const { quotas } = bandQuotas(pool, 2000, 25);
    const tiny = quotas.find((q) => q.band === "tiny")!;
    expect(tiny.target).toBe(25);
    expect(tiny.target / tiny.have).toBeGreaterThan(0.2);
  });

  it("keeps the rare floor", () => {
    const pool: Record<string, number> = { huge: 100000, tiny: 40 };
    const { quotas } = bandQuotas(pool, 1000, 25);
    const tiny = quotas.find((q) => q.band === "tiny")!;
    expect(tiny.target).toBe(25); // the floor, not round(1000*40/100040) = 0
  });

  it("handles an empty pool without dividing by zero", () => {
    const plan = bandQuotas({}, 2500);
    expect(plan.quotas).toEqual([]);
    expect(plan.shortfall).toBe(2500);
    expect(plan.poolTooSmall).toBe(true);
  });
});
