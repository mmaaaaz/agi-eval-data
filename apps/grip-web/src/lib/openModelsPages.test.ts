/**
 * End-to-end render probe for the report pages.
 *
 * Each page component is server-rendered against the SHIPPED artifact, so a bad
 * index, a null metric or a broken chart fails here instead of in the browser.
 * Only <Link> is stubbed (it needs a live router); everything else is the real
 * component code, fed the real numbers.
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
    // the param routes read Route.useParams(); give them the params under test
    createFileRoute: () => (opts: Record<string, unknown>) =>
      Object.assign({}, opts, { useParams: () => routeState.params }),
  };
});

vi.mock("../routes/open-models", async () => {
  const fs = await import("node:fs");
  const data = JSON.parse(fs.readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"));
  return { useOM: () => data, useOpenModels: () => ({ data, loading: false, error: null, source: "local" }) };
});

const { Overview } = await import("../routes/open-models.index");
const { DomainsPage } = await import("../routes/open-models.domains.index");
const { MatrixPage } = await import("../routes/open-models.matrix");
const { Compare } = await import("../routes/open-models.compare");
const { Audit } = await import("../routes/open-models.audit");
const { Method } = await import("../routes/open-models.method");
const { DomainPage } = await import("../routes/open-models.domains.$slug");
const { ModelPage } = await import("../routes/open-models.models.$id");

const artifact = JSON.parse(
  readFileSync(new URL("../../public/data/open-models.json", import.meta.url), "utf-8"),
) as Artifact;

const render = (c: () => ReactNode) => renderToStaticMarkup(createElement(c as never));
const lead = artifact.models.reduce((a, b) => ((a.totals.acc ?? 0) > (b.totals.acc ?? 0) ? a : b));
const trail = artifact.models.reduce((a, b) => ((a.totals.acc ?? 0) < (b.totals.acc ?? 0) ? a : b));

describe("report pages render against the shipped artifact", () => {
  it("overview: hero, leaderboard, findings and charts", () => {
    const html = render(Overview as never);
    expect(html).toContain("Every open-model answer, re-graded by");
    expect(html).toContain("Leaderboard");
    expect(html).toContain(lead.label);
    expect(html).toContain(((lead.totals.acc ?? 0) * 100).toFixed(2));
    expect(html).toContain("What the numbers say");
    expect(html.length).toBeGreaterThan(20000);
  });

  it("domains: the table, its controls and a real slice", () => {
    const html = render(DomainsPage as never);
    expect(html).toContain("copy TSV");
    expect(html).toContain("by domain");
    const sample = artifact.domains[0];
    expect(html).toContain(sample.label);
    expect(html).toContain(String(Math.round((sample.oracle ?? 0) * 100)));
  });

  it("matrix: heat grid across every domain and family", () => {
    const html = render(MatrixPage as never);
    expect(html).toContain("The whole benchmark on one screen");
    for (const d of artifact.domains.slice(0, 6)) expect(html).toContain(d.label);
    expect(html).toContain(artifact.benchmark.families[1]);
  });

  it("compare: wins, scatter and paired table", () => {
    const html = render(Compare as never);
    expect(html).toContain(lead.label);
    expect(html).toContain(trail.label);
    expect(html).toContain("plotted 1:1");
    expect(html).toContain("Every domain, side by side");
  });

  it("audit: classes, zeros, constants and drift", () => {
    const html = render(Audit as never);
    expect(html).toContain("Two scorers");
    expect(html).toContain(String(artifact.audit.zeroHarness.length));
    expect(html).toContain(artifact.audit.constantLevels[0].top);
    expect(html).toContain("Ground-truth drift");
  });

  it("domain detail: levels, question formats and the single-answer warning", () => {
    routeState.params = { slug: "polyhedron" };
    const html = render(DomainPage as never);
    expect(html).toContain("Polyhedra");
    expect(html).toContain("Difficulty ladder");
    expect(html).toContain("What the model is actually asked");
    expect(html).toContain("single answer");
    expect(html).toContain("L5");
    const d = artifact.domains.find((x) => x.key === "polyhedron")!;
    expect(html).toContain(d.oracleTop as string);
  });

  it("domain detail: renders the upstream question formats for every level", () => {
    routeState.params = { slug: "nested_squares" };
    const html = render(DomainPage as never);
    expect(html).toContain("Nested squares");
    const d = artifact.domains.find((x) => x.key === "nested_squares")!;
    expect(Object.keys(d.formats)).toEqual(["1", "2", "3", "4", "5"]);
    // the template, its real example and the answer format all reach the DOM
    expect(html).toContain("How many squares are in this image");
    expect(html).toContain("prompt variant");
    expect(html).toContain(String(d.formats["1"].answerFormat));
  });

  it("model card: totals, levels and grader disagreements", () => {
    routeState.params = { id: "internvl3_5-8b" };
    const html = render(ModelPage as never);
    expect(html).toContain("InternVL3.5-8B");
    expect(html).toContain("Reasoning families");
    expect(html).toContain("own scorer disagreed");
    expect(html).toContain(((artifact.models.find((m) => m.id === "internvl3_5-8b")!.totals.acc ?? 0) * 100).toFixed(2));
  });

  it("method: rule, verification and caveats", () => {
    const html = render(Method as never);
    expect(html).toContain("The frozen grading rule");
    expect(html).toContain("duplicate question ids");
    expect(html).toContain("scripts/open_models_bake.py");
    expect(html).toContain("Half sample");
  });
});
