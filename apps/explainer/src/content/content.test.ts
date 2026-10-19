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
import { FIRST_RUNS } from "./firstRuns";
import { RUNS, TYPOGRAPHIC, runForModel } from "./runs";
import { EVIDENCE } from "./evidence";
import { COST_ASSUMPTIONS, COST_ROWS, PLAN, SCENARIOS, fullRunUsd } from "./costs";

const allStrings = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
};

/** Every content surface a reader can see. Extended as content files land. */
export const EMDASH_WALK: unknown[] = [FACTS, PIPELINE, FAQ, CAPABILITY_GROUPS, LEVELS, DOMAINS, BIAS_AXES, SENSITIVITY, BIAS_TRACK, ADVERSARIAL_TRACK, HONESTY, FIRST_RUNS, MILESTONES, STATUS, RESOURCES, SAMPLES, RUNS, TYPOGRAPHIC, COST_ASSUMPTIONS, COST_ROWS, SCENARIOS];

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

  it("quotes the first demonstration runs exactly", () => {
    expect(FIRST_RUNS.rows.length).toBe(4);
    const scores = FIRST_RUNS.rows.map((r) => r.score);
    expect(scores).toContain("28 / 30");
    expect(scores).toContain("25 / 30");
    expect(scores).toContain("1 / 30");
    expect(FIRST_RUNS.rows.every((r) => r.note.length > 40)).toBe(true);
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

  it("has fifteen samples, five questions each, with valid varied domains and real codes", () => {
    expect(SAMPLES.length).toBe(15);
    const capIds = new Set(CAPABILITY_GROUPS.flatMap((g) => g.codes).map((c) => c.id));
    const levelIds = new Set(LEVELS.map((c) => c.id));
    for (const s of SAMPLES) {
      expect(DOMAINS.some((d) => d.id === s.domain)).toBe(true);
      expect(s.questions.length).toBe(5);
      expect(s.thumbUrl).toMatch(/^https:\/\/lh3\.googleusercontent\.com\/d\/.+=w\d+$/);
      expect(s.sourceUrl).toMatch(/^https:\/\/agi-eval-data\.pages\.dev\/gallery\?q=/);
      expect(s.sighted.length).toBeGreaterThan(30);
      expect(s.caps.length).toBeGreaterThanOrEqual(1);
      expect(s.levels.length).toBeGreaterThanOrEqual(1);
      for (const c of s.caps) expect(capIds.has(c)).toBe(true);
      for (const l of s.levels) expect(levelIds.has(l)).toBe(true);
    }
    expect(new Set(SAMPLES.map((s) => s.domain)).size).toBeGreaterThanOrEqual(8);
  });

  it("reports the first runs exactly as the committed traces do", () => {
    expect(RUNS.length).toBe(3);
    const ds = RUNS.find((r) => r.id === "deepseek");
    const nm = RUNS.find((r) => r.id === "nemotron");
    const bl = RUNS.find((r) => r.id === "blind");
    expect(ds?.correct).toBe(28);
    expect(nm?.correct).toBe(25);
    expect(nm?.parseFail).toBe(5);
    expect(bl?.correct).toBe(1);
    expect(bl?.abstained).toBe(28);
    for (const r of RUNS) {
      expect(r.items.length).toBe(30);
      expect(r.latency.mean).toBeGreaterThan(0);
    }
    expect(TYPOGRAPHIC.groups.length).toBe(5);
    expect(TYPOGRAPHIC.groups[0].id).toBe("control");
    expect(runForModel("deepseek/deepseek-v4.1-flash-1017")?.correct).toBe(28);
  });

  it("joins the traces into an image-first board that sums back to the run totals", () => {
    expect(EVIDENCE.length).toBe(10);
    for (const e of EVIDENCE) {
      expect(e.questions.length).toBe(3);
      expect(e.scores["blind"]?.n).toBe(3);
    }
    for (const r of RUNS) {
      const summed = EVIDENCE.reduce((n, e) => n + (e.scores[r.id]?.correct ?? 0), 0);
      expect(summed).toBe(r.correct);
    }
    expect(EVIDENCE.filter((e) => e.anyMiss).length).toBeGreaterThan(0);
    expect(EVIDENCE.filter((e) => e.anyMiss).length).toBeLessThan(EVIDENCE.length);
  });

  it("projects costs from the panel's own prices, with the arithmetic shown", () => {
    expect(COST_ROWS.length).toBe(PANEL.length);
    expect(COST_ASSUMPTIONS.items).toBe(25000);
    const ds = COST_ROWS.find((r) => r.id === "deepseek/deepseek-v4.1-flash-1017");
    expect(ds?.fullUsd).toBeCloseTo(
      fullRunUsd(0.15, 0.6, 25000),
      6,
    );
    expect(PLAN.totalUsd).toBeCloseTo(PLAN.cheapFullUsd + PLAN.frontierSliceUsd, 6);
    expect(PLAN.totalUsd).toBeLessThan(PLAN.everythingFullUsd);
    expect(SCENARIOS.length).toBe(3);
    expect(SCENARIOS[0].usd).toBe(PLAN.totalUsd);
  });

  it("contains no em dash anywhere in visible copy", () => {
    for (const s of allStrings(EMDASH_WALK)) expect(s).not.toContain("\u2014");
  });
});
