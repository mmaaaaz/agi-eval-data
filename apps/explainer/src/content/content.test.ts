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
import { PANEL, panelWithStatus } from "./models";
import { SAMPLES } from "./samples";

const allStrings = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
};

/** Every content surface a reader can see. Extended as content files land. */
export const EMDASH_WALK: unknown[] = [FACTS, FAMILIES, PIPELINE, EVAL_TESTS, FAQ, CATEGORIES, MILESTONES, STATUS, RESOURCES, SAMPLES];

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

  it("reads the harness panel, shows every model, and includes DeepSeek-V4.1-Flash-1017", () => {
    expect(PANEL.length).toBeGreaterThanOrEqual(17);
    expect(panelWithStatus.length).toBe(PANEL.length);
    expect(PANEL.some((m) => m.id.includes("deepseek-v4.1-flash-1017"))).toBe(true);
    expect(PANEL.some((m) => m.id === "google/gemma-4-31b-it")).toBe(true);
  });

  it("has ten samples across categories, covering all six families", () => {
    expect(SAMPLES.length).toBe(10);
    const cats = new Set(SAMPLES.map((s) => s.category));
    expect(cats.size).toBeGreaterThanOrEqual(7);
    for (const s of SAMPLES) {
      expect(s.questions.length).toBeGreaterThanOrEqual(3);
      expect(CATEGORIES.some((c) => c.id === s.category)).toBe(true);
      expect(s.thumbUrl).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/d\/.+=w\d+$/);
      expect(s.sourceUrl).toMatch(/^https:\/\/agi-eval-data\.pages\.dev\/gallery\?q=/);
      expect(s.sighted.length).toBeGreaterThan(30);
    }
    const fams = new Set(SAMPLES.flatMap((s) => s.questions.map((q) => q.family)));
    expect(fams.size).toBe(6);
  });

  it("contains no em dash anywhere in visible copy", () => {
    for (const s of allStrings(EMDASH_WALK)) expect(s).not.toContain("\u2014");
  });
});
