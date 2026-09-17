/**
 * End-to-end render probe for every report page.
 *
 * Each page component is server-rendered against the SHIPPED artifact, so a bad
 * index, a null metric or a broken chart fails here instead of in the browser.
 * Only <Link>/<select>/Route params are stubbed; everything else is real.
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Artifact } from "./openModelsTypes";

const routeState = vi.hoisted(() => ({ params: {} as Record<string, string> }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to?: unknown; params?: Record<string, string>; children?: ReactNode }) => {
      let href = typeof props.to === "string" ? props.to : "#";
      for (const [k, v] of Object.entries(props.params ?? {})) href = href.replace("$" + k, v);
      return createElement("a", { href }, props.children);
    },
    createFileRoute: () => (opts: Record<string, unknown>) =>
      Object.assign({}, opts, { useParams: () => routeState.params }),
  };
});

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"),
) as Artifact;

vi.mock("../routes/open-models", async () => {
  const fs = await import("node:fs");
  const data = JSON.parse(fs.readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"));
  return {
    useOM: () => data,
    useFocus: () => ({ focus: null, setFocus: () => {} }),
    useOpenModels: () => ({ data, loading: false, error: null, source: "local" }),
  };
});

const { Overview } = await import("../routes/open-models.index");
const { DomainsPage } = await import("../routes/open-models.domains.index");
const { MatrixPage } = await import("../routes/open-models.matrix");
const { Compare } = await import("../routes/open-models.compare");
const { Audit } = await import("../routes/open-models.audit");
const { Method } = await import("../routes/open-models.method");
const { DomainPage } = await import("../routes/open-models.domains.$slug");
const { ModelPage } = await import("../routes/open-models.models.$id");

const render = (c: () => ReactNode) => renderToStaticMarkup(createElement(c as never));
const order = [...artifact.models].sort((x, y) => (y.totals.acc ?? 0) - (x.totals.acc ?? 0));
const lead = order[0];
const trail = order[order.length - 1];

describe("report pages render against the shipped artifact", () => {
  it("overview: three headline numbers, a field mean and a glossary", () => {
    const html = render(Overview as never);
    expect(html).toContain("field mean");
    expect(html).toContain("vs guessing");
    expect(html).toContain("no usable answer");
    expect(html).toContain("what do these numbers mean?");
    // the retired jargon must not survive anywhere a reader can see it
    expect(html).not.toContain("self-score");
    expect(html).not.toContain("partial credit");
    expect(html).not.toMatch(/own score(?!r)/);
    expect(html).not.toContain(">headroom<");
  });

  it("overview: hero, leaderboard, findings, curve, families and winner map", () => {
    const html = render(Overview as never);
    expect(html).toContain("one frozen grading rule");
    expect(html).toContain("All " + artifact.models.length + " runs, ranked");
    expect(html).toContain("What the field says");
    expect(html).toContain("Who leads each domain");
    expect(html).toContain(((lead.totals.acc ?? 0) * 100).toFixed(2));
    expect(html).toContain(((trail.totals.acc ?? 0) * 100).toFixed(2));
    for (const m of artifact.models) expect(html, m.id).toContain(m.label);
    expect(html.length).toBeGreaterThan(30000);
  });

  it("domains: matrix-style table with a leader column and a field mean", () => {
    const html = render(DomainsPage as never);
    expect(html).toContain("field mean");
    expect(html).toContain("guessing");
    expect(html).toContain("copy TSV");
    expect(html).toContain(artifact.domains[0].label);
    expect(html).toContain("leads");
    expect(html).toContain(artifact.models[0].meta.short as string);
  });

  it("matrix: values and winner modes", () => {
    const html = render(MatrixPage as never);
    expect(html).toContain("One run, the whole benchmark");
    expect(html).toContain(artifact.benchmark.families[1]);
    for (const d of artifact.domains.slice(0, 6)) expect(html).toContain(d.label);
  });

  it("compare: any two runs, scatter and paired table", () => {
    const html = render(Compare as never);
    expect(html).toContain(lead.label);
    expect(html).toContain(trail.label);
    expect(html).toContain("plotted 1:1");
    expect(html).toContain("Every domain, side by side");
  });

  it("audit: graders, classes, zeros, movement and provenance", () => {
    const html = render(Audit as never);
    expect(html).toContain("Two scorers");
    expect(html).toContain(String(artifact.audit.zeroHarness.length));
    expect(html).toContain(artifact.audit.constantLevels[0].top);
    expect(html).toContain("Ground truth, pairing and drift");
    expect(html).toContain("unsolved by every run");
  });

  it("method: rule, verification, field table and caveats", () => {
    const html = render(Method as never);
    expect(html).toContain("The frozen grading rule");
    expect(html).toContain("The runs in this report");
    expect(html).toContain("duplicate question ids");
    expect(html).toContain("scripts/open_models_bake.py");
    for (const m of artifact.models) expect(html, m.id).toContain(m.meta.org as string);
  });

  it("domain detail: levels, question formats and per-run grading", () => {
    routeState.params = { slug: "polyhedron" };
    const html = render(DomainPage as never);
    const d = artifact.domains.find((x) => x.key === "polyhedron")!;
    expect(html).toContain("Polyhedra");
    expect(html).toContain("Difficulty ladder");
    expect(html).toContain("What the models are actually asked");
    expect(html).toContain("single answer");
    expect(html).toContain(d.oracleTop as string);
    expect(html).toContain("parted ways here");
  });

  it("domain detail: renders the upstream question formats for every level", () => {
    routeState.params = { slug: "nested_squares" };
    const html = render(DomainPage as never);
    const d = artifact.domains.find((x) => x.key === "nested_squares")!;
    expect(Object.keys(d.formats)).toEqual(["1", "2", "3", "4", "5"]);
    expect(html).toContain("How many squares are in this image");
    expect(html).toContain("prompt variant");
  });

  it("model card: totals, levels, standing and disagreements", () => {
    routeState.params = { id: "qwen3-vl-8b-instruct" };
    const html = render(ModelPage as never);
    expect(html).toContain("Qwen3-VL-8B-Instruct");
    expect(html).toContain("overall rank");
    expect(html).toContain("Reasoning families");
    expect(html).toContain("own scorer disagreed");
    expect(html).toContain(((lead.totals.acc ?? 0) * 100).toFixed(2));
  });

  it("model card for a non-leader shows its gap to the leader", () => {
    routeState.params = { id: "deepseek-vl2-small" };
    const html = render(ModelPage as never);
    expect(html).toContain("DeepSeek-VL2-Small");
    expect(html).toContain("vs leader");
    expect(html).toContain("16.1B total");
  });
});
