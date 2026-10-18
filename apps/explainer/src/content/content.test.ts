import { describe, expect, it } from "vitest";
import { FACTS } from "./facts";
import { PIPELINE } from "./pipeline";
import { FAQ } from "./faq";
import { MILESTONES } from "./roadmap";
import { STATUS } from "./status";
import { RESOURCES } from "./resources";
import { PANEL, panelWithStatus } from "./models";
import { SAMPLES } from "./samples";
import { BIAS_AXES, CAPABILITY_GROUPS, DOMAINS, LEVELS, SENSITIVITY } from "./taxonomy";
import { ADVERSARIAL_TRACK, BIAS_TRACK, HONESTY } from "./experiments";

const allStrings = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
};

/** Every content surface a reader can see. Extended as content files land. */
export const EMDASH_WALK: unknown[] = [FACTS, PIPELINE, FAQ, CAPABILITY_GROUPS, LEVELS, DOMAINS, BIAS_AXES, SENSITIVITY, BIAS_TRACK, ADVERSARIAL_TRACK, HONESTY, MILESTONES, STATUS, RESOURCES, SAMPLES];

describe("content invariants", () => {
  it("computes the dataset split from its parts", () => {
    expect(FACTS.dataset.total).toBe(50000);
    expect(FACTS.dataset.handPicked).toBe(5000);
    expect(FACTS.dataset.communityOpen).toBe(45000);
    expect(FACTS.benchmark.qaPairs).toBe(25000);
  });

  it("mirrors the full taxonomy: 21 capabilities, 5 levels, 11 domains", () => {
    expect(CAPABILITY_GROUPS.length).toBe(4);
    expect(CAPABILITY_GROUPS.flatMap((g) => g.codes).length).toBe(21);
    expect(LEVELS.length).toBe(5);
    expect(DOMAINS.length).toBe(11);
    for (const c of CAPABILITY_GROUPS.flatMap((g) => g.codes)) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.note.length).toBeGreaterThan(10);
    }
  });

  it("adds the fairness axis and the sensitivity flags, all codes unique", () => {
    expect(BIAS_AXES.length).toBe(5);
    expect(SENSITIVITY.length).toBe(5);
    const ids = [
      ...CAPABILITY_GROUPS.flatMap((g) => g.codes),
      ...LEVELS,
      ...DOMAINS,
      ...BIAS_AXES,
      ...SENSITIVITY,
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of [...BIAS_AXES, ...SENSITIVITY]) expect(c.note.length).toBeGreaterThan(10);
  });

  it("covers bias, adversarial and honesty experiments", () => {
    expect(BIAS_TRACK.items.length).toBeGreaterThanOrEqual(3);
    expect(ADVERSARIAL_TRACK.items.length).toBeGreaterThanOrEqual(2);
    expect(HONESTY.length).toBe(9);
  });

  it("twenty FAQ entries, all real answers", () => {
    expect(FAQ.length).toBe(20);
    for (const e of FAQ) {
      expect(e.q.endsWith("?")).toBe(true);
      expect(e.a.length).toBeGreaterThan(60);
    }
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

  it("has ten samples with valid, varied domains", () => {
    expect(SAMPLES.length).toBe(10);
    for (const s of SAMPLES) {
      expect(DOMAINS.some((d) => d.id === s.domain)).toBe(true);
      expect(s.questions.length).toBeGreaterThanOrEqual(3);
      expect(s.thumbUrl).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/d\/.+=w\d+$/);
      expect(s.sourceUrl).toMatch(/^https:\/\/agi-eval-data\.pages\.dev\/gallery\?q=/);
      expect(s.sighted.length).toBeGreaterThan(30);
    }
    expect(new Set(SAMPLES.map((s) => s.domain)).size).toBeGreaterThanOrEqual(5);
  });

  it("contains no em dash anywhere in visible copy", () => {
    for (const s of allStrings(EMDASH_WALK)) expect(s).not.toContain("\u2014");
  });
});
