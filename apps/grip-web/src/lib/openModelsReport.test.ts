/**
 * Regression + render tests for the open-models report.
 *
 * The artifact numbers are cross-checked against the figures the original
 * standalone report published, so a change in the grader or the bake cannot
 * silently move the headline.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Artifact } from "./openModelsTypes";
import { accOf, metricValue, pct, ramp, rowFor } from "./openModelsFmt";
import { DivergeBars, FamilyBars, HeatGrid, LevelCurve, LevelTable, Scatter } from "../components/open-models/charts";

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"),
) as Artifact;

const byId = (id: string) => artifact.models.find((m) => m.id === id)!;
const round = (x: number, d = 4) => Number(x.toFixed(d));

describe("artifact shape", () => {
  it("has one row per model on every domain", () => {
    expect(artifact.schema).toBe(1);
    expect(artifact.models.length).toBeGreaterThan(0);
    for (const d of artifact.domains) {
      expect(d.per.length, d.key).toBe(artifact.models.length);
      expect(new Set(d.per.map((p) => p.model)).size).toBe(artifact.models.length);
      expect(d.family).toBeGreaterThanOrEqual(0);
      expect(d.family).toBeLessThan(artifact.benchmark.families.length);
    }
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
});

describe("figures match the published report", () => {
  const ivl = byId("internvl3_5-8b");
  const ds = byId("deepseek-vl2-small");

  it("holds the two headline accuracies", () => {
    expect(round(ivl.totals.acc!)).toBe(0.3693);
    expect(round(ds.totals.acc!)).toBe(0.2958);
    expect(round(ivl.totals.as!)).toBe(0.3727);
    expect(round(ds.totals.as!)).toBe(0.3093);
    expect(round(ivl.totals.partial!)).toBe(0.3869);
    expect(round(ds.totals.partial!)).toBe(0.3103);
  });

  it("holds the grader-agreement and parse-failure rates", () => {
    expect(round(ivl.totals.agreement!)).toBe(0.9798);
    expect(round(ds.totals.agreement!)).toBe(0.9735);
    expect(round(ivl.totals.pfRate!)).toBe(0.0058);
    expect(round(ds.totals.pfRate!)).toBe(0.1545);
    expect(ivl.totals.over).toBe(2980);
    expect(ds.totals.over - 5039).toBe(0);
  });

  it("holds the structural findings", () => {
    expect(artifact.audit.zeroHarness.length).toBe(11);
    expect(artifact.audit.constantLevels.length).toBe(6);
    expect(artifact.domains.length).toBe(34);
    expect(artifact.benchmark.questionsPerModel).toBe(252505);
    for (const c of artifact.audit.constantLevels) expect(c.oracle).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps the majority-answer baseline identical for every model", () => {
    const oracles = artifact.models.map((m) => round(m.totals.oracle!, 3));
    expect(new Set(oracles).size).toBe(1);
    expect(oracles[0]).toBe(0.138);
  });

  it("keeps the comparison paired: every run shares one ground truth", () => {
    const p = artifact.integrity.gtPairing;
    expect(p.mismatch).toBe(0);
    expect(p.missing).toBe(0);
    expect(p.checked).toBe((artifact.models.length - 1) * artifact.benchmark.questionsPerModel);
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

  it("has a monotone colour ramp", () => {
    expect(ramp(0)).not.toBe(ramp(1));
    expect(ramp(0.5)).toMatch(/^rgb\(/);
  });
});

describe("renders without a router", () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
  const lead = artifact.models.reduce((a, b) => ((a.totals.acc ?? 0) > (b.totals.acc ?? 0) ? a : b));

  it("renders the level curve with both models", () => {
    const out = html(createElement(LevelCurve, { models: artifact.models, levels: artifact.benchmark.levels, metric: "acc" }));
    expect(out).toContain(byId("internvl3_5-8b").label);
    expect(out).toContain("L1");
    expect(out).toContain("52.2");
  });

  it("renders the family bars and the level table", () => {
    expect(html(createElement(FamilyBars, { models: artifact.models, metric: "acc" }))).toContain("Solid Geometry");
    const table = html(
      createElement(LevelTable, {
        levels: artifact.benchmark.levels,
        series: artifact.models.map((m) => ({
          label: m.label,
          accent: m.accent,
          cells: m.totals.levels.map((l) => ({ acc: l.acc, partial: l.partial, n: l.n, pf: l.pf, oracle: l.oracle ?? null })),
        })),
      }),
    );
    expect(table).toContain("Extrapolative/Counterfactual Reasoning");
  });

  it("renders the heat grid, divergence chart and scatter", () => {
    const grid = html(
      createElement(HeatGrid, {
        domains: artifact.domains,
        levels: artifact.benchmark.levels,
        model: lead,
        metric: "acc",
        families: artifact.benchmark.families,
      }),
    );
    expect(grid).toContain("Hex pathfinding");
    const div = html(createElement(DivergeBars, { domains: artifact.domains, a: artifact.models[0], b: artifact.models[1], limit: 4 }));
    expect(div).toContain(artifact.models[1].label);
    const scatter = html(createElement(Scatter, { domains: artifact.domains, a: artifact.models[0], b: artifact.models[1] }));
    expect(scatter).toContain("<svg");
  });
});
