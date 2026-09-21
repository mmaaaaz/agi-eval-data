/**
 * Grain-sweep artifact tests.
 *
 * The claims the page makes are pinned here: the deltas are recomputed from the
 * stored accuracies, the one monotone degradation is asserted monotone, and the
 * physical_stability anomaly is asserted to be flat across conditions (which is
 * why the page calls it a run difference rather than a robustness effect).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Grain } from "./reanalysisTypes";

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models-grain.json", import.meta.url), "utf-8"),
) as Grain;

vi.mock("../lib/reanalysis", () => ({
  useGrain: () => ({ data: artifact, loading: false, error: null }),
  useReanalysis: () => ({ data: null, loading: false, error: null, source: null }),
  // re-export nothing else the page needs
}));

const { GrainPage } = await import("../routes/open-models.grain");

const LABELS = Object.keys(artifact.models);
const SIGMA = ["sigma15", "sigma25", "sigma40"];

describe("grain artifact", () => {
  it("has three models x three conditions, each 42,500 records bar one", () => {
    expect(LABELS.length).toBe(3);
    for (const l of LABELS) {
      const m = artifact.models[l];
      expect(m.per_condition.map((c) => c.condition).sort()).toEqual([...SIGMA].sort());
      for (const c of m.per_condition) {
        expect(c.n, l + c.condition).toBeGreaterThan(42000);
        expect(c.cells).toBe(170);
      }
    }
    const short = artifact.models["Qwen3-VL-8B-Instruct"].completeness["sigma40"];
    expect(short.missing).toBe(187);
    expect(short.records).toBe(42313);
  });

  it("recomputes every delta from the two accuracy columns", () => {
    for (const l of LABELS) {
      for (const c of artifact.models[l].per_condition) {
        expect(Math.abs((c.grain_exact as number) - (c.main_exact as number) - (c.delta_pooled as number)), l).toBeLessThan(1e-12);
        expect(c.delta_ci![0]).toBeLessThanOrEqual(c.delta_pooled as number);
        expect(c.delta_ci![1]).toBeGreaterThanOrEqual(c.delta_pooled as number);
        expect(c.delta_parsed_pooled as number).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it("finds shadow_inference degrading monotonically in all three runs", () => {
    for (const l of LABELS) {
      const by = artifact.models[l].by_domain.filter((x) => x.key === "shadow_inference");
      const v = SIGMA.map((c) => by.find((x) => x.condition === c)!.delta as number);
      expect(v[0], l).toBeGreaterThan(v[1]);
      expect(v[1], l).toBeGreaterThan(v[2]);
      expect(v[2], l).toBeLessThan(-0.1);
    }
  });

  it("finds the Qwen physical_stability gain to be flat across conditions", () => {
    const by = artifact.models["Qwen3-VL-8B-Instruct"].by_domain.filter((x) => x.key === "physical_stability");
    const v = SIGMA.map((c) => by.find((x) => x.condition === c)!.delta as number);
    expect(Math.min(...v)).toBeGreaterThan(0.4);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.01);
  });

  it("shows the extraction confound in the parsed-only column for Qwen", () => {
    const m = artifact.models["Qwen3-VL-8B-Instruct"];
    for (const c of m.per_condition) {
      expect(c.unparsed_main).toBeGreaterThan(0.03);
      expect(c.unparsed_grain).toBeLessThan(0.01);
      expect(c.delta_parsed_pooled as number).toBeLessThan(0);
    }
    expect(m.per_condition[0].delta_pooled as number).toBeGreaterThan(0);
  });
});

describe("grain page", () => {
  const html = renderToStaticMarkup(createElement(GrainPage as never));

  it("renders the degradation table and the curve", () => {
    expect(html).toContain("What does image corruption");
    expect(html).toContain("Accuracy under each condition");
    expect(html).toContain("Does it get worse as the label rises?");
    for (const l of LABELS) expect(html).toContain(l);
  });

  it("renders both caveats and the completeness note", () => {
    expect(html).toContain("a real robustness signal");
    expect(html).toContain("not a robustness effect");
    expect(html).toContain("short by 187 records");
    expect(html).toContain("scripts/open_models_grain.py");
  });
});
