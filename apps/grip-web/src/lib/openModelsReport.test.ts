/**
 * Regression + render tests for the open-model report.
 *
 * The two original runs are pinned against the figures the standalone report
 * published, so a change in the grader or the bake cannot silently move the
 * headline. Everything else is checked as an invariant over the whole field.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Artifact } from "./openModelsTypes";
import { METRICS, accOf, metricValue, pct, ramp, rowFor } from "./openModelsFmt";
import { DivergeBars, FamilyMatrix, HeatGrid, LevelSlope, LevelTable, Scatter, WinnerGrid } from "../components/open-models/charts";

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"),
) as Artifact;

const byId = (id: string) => artifact.models.find((m) => m.id === id)!;
const round = (x: number, d = 4) => Number(x.toFixed(d));

describe("artifact shape", () => {
  it("has one row per model on every domain", () => {
    expect(artifact.schema).toBe(1);
    expect(artifact.models.length).toBeGreaterThan(1);
    for (const d of artifact.domains) {
      expect(d.per.length, d.key).toBe(artifact.models.length);
      expect(new Set(d.per.map((p) => p.model)).size).toBe(artifact.models.length);
      expect(d.family).toBeGreaterThanOrEqual(0);
      expect(d.family).toBeLessThan(artifact.benchmark.families.length);
    }
  });

  it("gives every run a unique, compact name for dense visuals", () => {
    const shorts = artifact.models.map((m) => m.meta.short);
    for (const s of shorts) expect(typeof s, "short name").toBe("string");
    expect(new Set(shorts).size).toBe(artifact.models.length);
  });

  it("keeps level questions balanced and equal to the domain totals", () => {
    for (const m of artifact.models) {
      const lv = m.totals.levels.map((l) => l.n);
      expect(new Set(lv).size, m.id).toBe(1);
      expect(lv[0] * 5).toBe(m.totals.n);
    }
  });

  it("rebuilds the headline accuracy from the per-domain rows", () => {
    for (const m of artifact.models) {
      const rebuilt = artifact.domains.reduce((s, d) => s + (accOf(d, m.id) ?? 0) * (rowFor(d, m.id)?.n ?? 0), 0);
      expect(Math.abs(rebuilt - (m.totals.acc ?? 0) * m.totals.n)).toBeLessThan(artifact.domains.length);
    }
  });

  it("agrees between the stored level totals and the domain rows", () => {
    for (const m of artifact.models) {
      for (let i = 0; i < 5; i++) {
        const fromDomains = artifact.domains.reduce((s, d) => s + (rowFor(d, m.id)?.levels[i]?.n ?? 0), 0);
        expect(fromDomains, m.id + " L" + (i + 1)).toBe(m.totals.levels[i].n);
      }
    }
  });
});

describe("figures match the published report", () => {
  const ivl = byId("internvl3_5-8b");
  const ds = byId("deepseek-vl2-small");

  it("holds the two original headline accuracies", () => {
    expect(round(ivl.totals.acc!)).toBe(0.3693);
    expect(round(ds.totals.acc!)).toBe(0.2958);
    expect(round(ivl.totals.as!)).toBe(0.3727);
    expect(round(ds.totals.as!)).toBe(0.3093);
    expect(round(ivl.totals.partial!)).toBe(0.3869);
    expect(round(ds.totals.partial!)).toBe(0.3103);
  });

  it("holds the grader-agreement and unparsed-answer rates", () => {
    expect(round(ivl.totals.agreement!)).toBe(0.9798);
    expect(round(ds.totals.agreement!)).toBe(0.9735);
    expect(round(ivl.totals.pfRate!)).toBe(0.0058);
    expect(round(ds.totals.pfRate!)).toBe(0.1545);
    expect(ivl.totals.over).toBe(2980);
    expect(ds.totals.over).toBe(5039);
  });

  it("holds the structural findings", () => {
    expect(artifact.domains.length).toBe(34);
    expect(artifact.audit.constantLevels.length).toBe(6);
    // levels every run scored 0 on with its own harness
    expect(artifact.audit.zeroHarness.length).toBe(10);
    for (const c of artifact.audit.constantLevels) expect(c.oracle).toBeGreaterThanOrEqual(0.9);
  });

  it("finds no run clears the L5 majority-answer baseline", () => {
    const l5 = artifact.models[0].totals.levels[4].oracle ?? 0;
    for (const m of artifact.models) expect(m.totals.levels[4].acc ?? 0, m.id).toBeLessThan(l5);
  });

  it("ranks the same way the site does", () => {
    const order = [...artifact.models].sort((a, b) => (b.totals.acc ?? 0) - (a.totals.acc ?? 0));
    expect(order[0].id).toBe("qwen3-vl-8b-instruct");
    expect(order[order.length - 1].id).toBe("deepseek-vl2-small");
  });
});

describe("integrity", () => {
  it("keeps the comparison paired: every run shares one ground truth", () => {
    const p = artifact.integrity.gtPairing;
    const comparable = artifact.models.slice(1).reduce((s, m) => s + m.totals.n, 0);
    expect(p.mismatch).toBe(0);
    expect(p.missing).toBe(0);
    expect(p.checked).toBe(comparable);
    for (const m of artifact.models.slice(1)) {
      expect(m.gtPairing.mismatch, m.id).toBe(0);
      expect(m.gtPairing.missing, m.id).toBe(0);
    }
  });

  it("reports ground-truth drift as a minority of the run", () => {
    const d = artifact.integrity.gtDrift;
    expect(d.mismatch).toBeGreaterThan(0);
    expect(d.mismatch).toBeLessThan(d.checked);
    expect(artifact.integrity.dupIds).toBe(0);
  });

  it("keeps the majority-answer baseline identical across runs", () => {
    const oracles = artifact.models.map((m) => round(m.totals.oracle!, 3));
    expect(new Set(oracles).size).toBe(1);
  });

  it("reports the spread of run sizes instead of assuming they are equal", () => {
    const [lo, hi] = artifact.benchmark.questionsRange;
    expect(lo).toBeLessThanOrEqual(hi);
    expect(lo).toBe(Math.min(...artifact.models.map((m) => m.totals.n)));
    expect(hi).toBe(Math.max(...artifact.models.map((m) => m.totals.n)));
  });
});

describe("derived helpers", () => {
  it("orders models by accuracy and resolves domain rows", () => {
    const d = artifact.domains[0];
    for (const m of artifact.models) expect(rowFor(d, m.id)?.model).toBe(m.id);
    expect(accOf(d, "nope")).toBeNull();
  });

  it("computes headroom and formats percentages", () => {
    expect(metricValue({ acc: 0.4, as: 0.4, partial: 0.4, oracle: 0.1 }, "headroom")).toBeCloseTo(0.3, 6);
    expect(pct(0.3693, 2)).toBe("36.93%");
    expect(pct(null)).toBe("—");
  });

  it("uses one name per idea, and only one of them is an accuracy", () => {
    const shorts = METRICS.map((m) => m.short);
    expect(shorts).toEqual(["accuracy", "own scorer", "partly right", "vs guessing"]);
    expect(new Set(shorts).size).toBe(4);
    // "own scorer" is the only cross-check that reports a score; the rest are context or diagnostics
    expect(METRICS.filter((m) => /accuracy/.test(m.short)).length).toBe(1);
  });

  it("has a monotone colour ramp", () => {
    expect(ramp(0)).not.toBe(ramp(1));
    expect(ramp(0.5)).toMatch(/^rgb\(/);
  });
});

describe("renders without a router", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it("renders the difficulty curve for every run", () => {
    const out = html(createElement(LevelSlope, { models: artifact.models, levels: artifact.benchmark.levels, metric: "acc", focus: null }));
    for (const m of artifact.models) expect(out, m.id).toContain(m.meta.short!);
    expect(out).toContain("L1");
    expect(out).toContain("52.2");
  });

  it("shows the field mean alongside the runs", () => {
    const matrix = html(createElement(FamilyMatrix, { models: artifact.models, focus: null }));
    expect(matrix).toContain("Solid Geometry");
    expect(matrix).toContain(">field<");
    expect(matrix).toContain(">guess<");

    const curve = html(createElement(LevelSlope, { models: artifact.models, levels: artifact.benchmark.levels, metric: "acc", focus: null }));
    expect(curve).toContain("field mean");
  });

  it("renders the family matrix and the level table", () => {
    expect(html(createElement(FamilyMatrix, { models: artifact.models, focus: null }))).toContain("Solid Geometry");
    const table = html(
      createElement(LevelTable, {
        levels: artifact.benchmark.levels,
        series: artifact.models.map((m) => ({
          id: m.id,
          label: m.label,
          accent: m.accent,
          cells: m.totals.levels.map((l) => ({ acc: l.acc, partial: l.partial, n: l.n, pf: l.pf, oracle: l.oracle ?? null })),
        })),
      }),
    );
    expect(table).toContain("Extrapolative/Counterfactual Reasoning");
  });

  it("renders the heat grid, winner map, divergence chart and scatter", () => {
    const grid = html(
      createElement(HeatGrid, {
        domains: artifact.domains,
        levels: artifact.benchmark.levels,
        model: artifact.models[0],
        metric: "acc",
        families: artifact.benchmark.families,
      }),
    );
    expect(grid).toContain("Hex pathfinding");

    const winners = html(
      createElement(WinnerGrid, {
        domains: artifact.domains,
        levels: artifact.benchmark.levels,
        models: artifact.models,
        families: artifact.benchmark.families,
        focus: null,
      }),
    );
    expect(winners).toContain("Projectile motion");
    expect(winners).toContain("Qwen-I");

    const div = html(createElement(DivergeBars, { domains: artifact.domains, a: artifact.models[0], b: artifact.models[1], limit: 4 }));
    expect(div).toContain(artifact.models[1].label);
    const scatter = html(createElement(Scatter, { domains: artifact.domains, a: artifact.models[0], b: artifact.models[1] }));
    expect(scatter).toContain("<svg");
  });
});
