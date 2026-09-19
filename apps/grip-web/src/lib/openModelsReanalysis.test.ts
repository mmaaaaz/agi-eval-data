/**
 * Reanalysis artifact + page tests.
 *
 * The adjusted scores are recomputed from the stored per-cell n / correct /
 * baseline in the test itself, so a broken transform or an aggregate that
 * quietly includes a constant cell fails here.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Reanalysis } from "./reanalysisTypes";

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models-reanalysis.json", import.meta.url), "utf-8"),
) as Reanalysis;

vi.mock("../lib/reanalysis", () => ({
  useReanalysis: () => ({ data: artifact, loading: false, error: null, source: "local" }),
}));

const { ReanalysisPage } = await import("../routes/open-models.reanalysis");

const MODELS = Object.keys(artifact.models);

describe("reanalysis artifact", () => {
  it("covers 34 x 5 cells per model and excludes the constant ones", () => {
    for (const id of MODELS) {
      const m = artifact.models[id];
      expect(m.cells.length, id).toBe(170);
      expect(m.constant_cells.length, id).toBe(6);
      expect(m.overall.cells_used, id).toBe(170 - 6);
      for (const c of m.constant_cells) expect(c.baseline, id).toBe(1);
    }
  });

  it("has L5 stored for every model", () => {
    for (const id of MODELS) {
      const counts = artifact.level_counts[id];
      for (const lv of ["1", "2", "3", "4", "5"]) expect(counts[lv], id + " L" + lv).toBeGreaterThan(0);
      expect(artifact.l5_verdicts[id].l5_present).toBe(true);
      expect(artifact.l5_verdicts[id].verdict).toBe("a");
    }
  });

  it("recomputes MACRO and POOLED from the per-cell rows", () => {
    for (const id of MODELS) {
      const m = artifact.models[id];
      const used = m.cells.filter((c) => c.adjusted != null);
      const macro = used.reduce((s, c) => s + (c.adjusted as number), 0) / used.length;
      expect(Math.abs(macro - (m.overall.macro as number)), id).toBeLessThan(1e-9);

      const n = used.reduce((s, c) => s + c.n, 0);
      const corr = used.reduce((s, c) => s + c.exact_n, 0);
      const base = used.reduce((s, c) => s + (c.baseline as number) * c.n, 0);
      const pooled = (corr - base) / (n - base);
      expect(Math.abs(pooled - (m.overall.pooled as number)), id).toBeLessThan(1e-9);
      expect(n).toBe(m.overall.n);
    }
  });

  it("keeps every adjusted score finite and within its arithmetic bounds", () => {
    // adjusted = (acc - base) / (1 - base), so with acc >= 0 the floor is
    // -base/(1-base) (below -1 when the baseline is large) and the ceiling is 1.
    for (const id of MODELS) {
      for (const c of artifact.models[id].cells) {
        if (c.adjusted == null) continue;
        const base = c.baseline as number;
        expect(Number.isFinite(c.adjusted), id).toBe(true);
        expect(c.adjusted).toBeGreaterThanOrEqual(-base / (1 - base) - 1e-9);
        expect(c.adjusted).toBeLessThanOrEqual(1 + 1e-9);
        expect(base).toBeGreaterThan(0);
        expect(base).toBeLessThan(1);
        // the transform must agree with its own inputs
        expect(Math.abs(c.adjusted - (c.raw_exact - base) / (1 - base)), id + c.domain).toBeLessThan(1e-9);
      }
    }
  });

  it("flags the two runs that sit below a constant answer", () => {
    const below = MODELS.filter((id) => (artifact.models[id].overall.macro as number) < 0).sort();
    expect(below).toEqual(["DeepSeek-VL2-Small", "Kimi-VL-A3B-Thinking"]);
  });

  it("reports every run below baseline on impossible_object", () => {
    for (const id of MODELS) {
      const row = artifact.models[id].domains.find((d) => d.key === "impossible_object");
      expect(row, id).toBeTruthy();
      expect(row!.adjusted as number, id).toBeLessThan(0);
      expect(row!.baseline).toBeCloseTo(0.3977, 3);
    }
  });

  it("has a paired Qwen family difference with a CI that excludes zero", () => {
    const fams = artifact.qwen_pair?.families ?? [];
    expect(fams.length).toBe(9);
    for (const f of fams) {
      // a paired CI excluding zero is what the page claims for every family
      expect(f.difference_ci[0] > 0 || f.difference_ci[1] < 0, f.family).toBe(true);
    }
  });

  it("states the blocked sections instead of guessing them", () => {
    expect(artifact.subset_8500.status).toBe("blocked");
    expect(artifact.subset_8500.missing_input ?? "").toContain("8,500");
    expect(artifact.frontier_comparison.status).toBe("blocked");
    expect((artifact.serving_configuration.not_recoverable ?? []).length).toBeGreaterThan(4);
  });
});

describe("reanalysis page", () => {
  const html = renderToStaticMarkup(createElement(ReanalysisPage as never));

  it("renders the headline numbers", () => {
    expect(html).toContain("The same answers, scored against");
    expect(html).toContain("Qwen3-VL-8B-Instruct");
    expect(html).toContain("below the baseline");
  });

  it("shows the L5 verdict and the transform table", () => {
    expect(html).toContain("L5 was never missing");
    expect(html).toContain("Raw accuracy, baseline, adjusted");
    expect(html).toContain("adjusted MACRO");
  });

  it("shows the cross-checks and the blocked sections", () => {
    expect(html).toContain("impossible_object");
    expect(html).toContain("Qwen3-VL-8B-Instruct vs Qwen3-VL-8B-Thinking");
    expect(html).toContain("blocked: the 8,500-row tier comparison");
    expect(html).toContain("serving configuration");
  });
});
