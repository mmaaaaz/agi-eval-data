import { describe, expect, it } from "vitest";
import { FACTS } from "./facts";
import { FAMILIES } from "./families";
import { PIPELINE } from "./pipeline";
import { EVAL_TESTS } from "./evalTests";
import { FAQ } from "./faq";
import { CATEGORIES } from "./categories";
import { MILESTONES } from "./roadmap";
import { STATUS } from "./status";
import { RESOURCES } from "./resources";

const allStrings = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
};

/** Every content surface a reader can see. Extended as content files land. */
export const EMDASH_WALK: unknown[] = [FACTS, FAMILIES, PIPELINE, EVAL_TESTS, FAQ, CATEGORIES, MILESTONES, STATUS, RESOURCES];

describe("content invariants", () => {
  it("computes total and QA pairs from their parts", () => {
    expect(FACTS.benchmark.total).toBe(5000);
    expect(FACTS.benchmark.qaPairs).toBe(25000);
    expect(FACTS.benchmark.families).toBe(FAMILIES.length);
  });

  it("six families with real examples, nine tests, seven steps", () => {
    expect(FAMILIES.length).toBe(6);
    for (const f of FAMILIES) expect(f.example.length).toBeGreaterThan(15);
    expect(EVAL_TESTS.length).toBe(9);
    expect(PIPELINE.length).toBe(7);
  });

  it("twenty FAQ entries, all real answers", () => {
    expect(FAQ.length).toBe(20);
    for (const e of FAQ) {
      expect(e.q.endsWith("?")).toBe(true);
      expect(e.a.length).toBeGreaterThan(60);
    }
  });

  it("ten categories, unique ids, all marked planned for now", () => {
    expect(CATEGORIES.length).toBe(10);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(10);
    for (const c of CATEGORIES) expect(c.planned).toBe(true);
  });

  it("five milestones with at least two items each", () => {
    expect(MILESTONES.length).toBe(5);
    for (const m of MILESTONES) expect(m.items.length).toBeGreaterThanOrEqual(2);
  });

  it("resources include BBQ-V and only safe hrefs", () => {
    expect(RESOURCES.some((r) => r.id === "bbq-v")).toBe(true);
    for (const r of RESOURCES) expect(/^(https:\/\/|\/)/.test(r.href)).toBe(true);
  });

  it("contains no em dash anywhere in visible copy", () => {
    for (const s of allStrings(EMDASH_WALK)) expect(s).not.toContain("\u2014");
  });
});
