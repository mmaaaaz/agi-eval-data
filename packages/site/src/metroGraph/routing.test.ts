import { describe, it, expect } from "vitest";
import { buildAdj, bfsShortest, dijkstra, reachableWithin, allPairs } from "./routing";
import type { RawGraph } from "./routing";

function makeGraph(stations: string[], edges: [string, string, string][], opts: Partial<RawGraph> = {}): RawGraph {
  return {
    fileId: "test",
    city: "TestCity",
    country: "TestCountry",
    branch: "ours",
    stations: stations.map((id) => ({
      id,
      label: id,
      lines: ["L1"],
      x: null,
      y: null,
      interchange: false,
    })),
    edges: edges.map(([from, to, line]) => ({
      from,
      to,
      line: line ?? "L1",
      bidirectional: true,
      weight: 1,
    })),
    lines: {},
    provenance: { annotatedBy: "test", annotatedAt: "2026-08-27", tool: "vitest" },
    ...opts,
  };
}

describe("bfsShortest", () => {
  it("linear path", () => {
    const raw = makeGraph(["A", "B", "C", "D"], [
      ["A", "B", "L1"],
      ["B", "C", "L1"],
      ["C", "D", "L1"],
    ]);
    const g = buildAdj(raw);
    const r = bfsShortest(g, "A", "D");
    expect(r).not.toBeNull();
    expect(r!.path).toEqual(["A", "B", "C", "D"]);
    expect(r!.hops).toBe(3);
    expect(r!.transfers).toBe(0);
  });

  it("branching prefers shortest", () => {
    // A-B-D and A-C-D both 2 hops; deterministic BFS picks first adjacency order
    const raw = makeGraph(["A", "B", "C", "D"], [
      ["A", "B", "L1"],
      ["A", "C", "L1"],
      ["B", "D", "L1"],
      ["C", "D", "L1"],
    ]);
    const g = buildAdj(raw);
    const r = bfsShortest(g, "A", "D");
    expect(r).not.toBeNull();
    expect(r!.hops).toBe(2);
    expect(r!.path[0]).toBe("A");
    expect(r!.path[r!.path.length - 1]).toBe("D");
  });

  it("loop handles cycles", () => {
    const raw = makeGraph(["A", "B", "C"], [
      ["A", "B", "L1"],
      ["B", "C", "L1"],
      ["C", "A", "L1"],
    ]);
    const g = buildAdj(raw);
    const r = bfsShortest(g, "A", "C");
    expect(r).not.toBeNull();
    expect(r!.hops).toBe(1);
    expect(r!.path).toEqual(["A", "C"]);
  });

  it("disconnected returns null", () => {
    const raw = makeGraph(["A", "B", "C", "D"], [["A", "B", "L1"]]);
    // C,D isolated (no edges to A,B)
    raw.stations.push({ id: "C", label: "C", lines: ["L1"], x: null, y: null, interchange: false });
    raw.stations.push({ id: "D", label: "D", lines: ["L1"], x: null, y: null, interchange: false });
    // Actually makeGraph already adds C,D but no edges for them beyond maybe missing — but A-B only
    const g = buildAdj(makeGraph(["A", "B", "C", "D"], [["A", "B", "L1"]]));
    expect(bfsShortest(g, "A", "D")).toBeNull();
    expect(bfsShortest(g, "C", "D")).toBeNull();
  });

  it("from===to zero-hop", () => {
    const raw = makeGraph(["A", "B"], [["A", "B", "L1"]]);
    const g = buildAdj(raw);
    const r = bfsShortest(g, "A", "A");
    expect(r).not.toBeNull();
    expect(r!.path).toEqual(["A"]);
    expect(r!.hops).toBe(0);
    expect(r!.transfers).toBe(0);
  });

  it("missing id returns null", () => {
    const raw = makeGraph(["A", "B"], [["A", "B", "L1"]]);
    const g = buildAdj(raw);
    expect(bfsShortest(g, "X", "A")).toBeNull();
    expect(bfsShortest(g, "A", "X")).toBeNull();
  });

  it("interchange clique allows transfer", () => {
    const raw: RawGraph = {
      fileId: "test",
      city: "TestCity",
      country: "TestCountry",
      branch: "ours",
      stations: [
        { id: "A", label: "A", lines: ["red"], x: null, y: null, interchange: false },
        { id: "B", label: "B", lines: ["red", "blue"], x: 0.5, y: 0.5, interchange: true },
        { id: "C", label: "C", lines: ["blue"], x: null, y: null, interchange: false },
      ],
      edges: [
        { from: "A", to: "B", line: "red", bidirectional: true, weight: 1 },
        { from: "B", to: "C", line: "blue", bidirectional: true, weight: 1 },
      ],
      lines: {},
      provenance: { annotatedBy: "test", annotatedAt: "2026-08-27", tool: "vitest" },
    };
    const g = buildAdj(raw);
    const r = bfsShortest(g, "A", "C");
    expect(r).not.toBeNull();
    expect(r!.path).toEqual(["A", "B", "C"]);
    expect(r!.hops).toBe(2);
    // line change red->blue counts as transfer
    expect(r!.transfers).toBe(1);
  });

  it("dijkstra weighted", () => {
    const raw = makeGraph(["A", "B", "C"], [
      ["A", "B", "L1"],
      ["B", "C", "L1"],
      ["A", "C", "L1"],
    ]);
    // Make A-C expensive
    raw.edges[2]!.weight = 10;
    const g = buildAdj(raw);
    const r = dijkstra(g, "A", "C");
    expect(r).not.toBeNull();
    // Should prefer A-B-C (cost 2) over direct A-C (cost 10)
    expect(r!.path).toEqual(["A", "B", "C"]);
  });

  it("reachableWithin", () => {
    const raw = makeGraph(["A", "B", "C", "D"], [
      ["A", "B", "L1"],
      ["B", "C", "L1"],
      ["C", "D", "L1"],
    ]);
    const g = buildAdj(raw);
    const s1 = reachableWithin(g, "A", 1);
    expect(s1.has("A")).toBe(true);
    expect(s1.has("B")).toBe(true);
    expect(s1.has("C")).toBe(false);
    const s2 = reachableWithin(g, "A", 2);
    expect(s2.has("C")).toBe(true);
    expect(s2.has("D")).toBe(false);
  });

  it("allPairs memoized", () => {
    const raw = makeGraph(["A", "B"], [["A", "B", "L1"]]);
    const g = buildAdj(raw);
    const m1 = allPairs(g);
    const m2 = allPairs(g);
    expect(m1).toBe(m2); // WeakMap memo
    expect(m1.get("A::B")?.hops).toBe(1);
    expect(m1.get("B::A")?.hops).toBe(1);
    expect(m1.get("A::A")?.hops).toBe(0);
  });

  it("bidirectional edges both directions", () => {
    const raw: RawGraph = {
      fileId: "test",
      city: "TestCity",
      country: "TestCountry",
      branch: "ours",
      stations: [
        { id: "A", label: "A", lines: ["L1"], x: null, y: null, interchange: false },
        { id: "B", label: "B", lines: ["L1"], x: null, y: null, interchange: false },
      ],
      edges: [{ from: "A", to: "B", line: "L1", bidirectional: true, weight: 1 }],
      lines: { L1: { color: "#ff0000", label: "L1", stations: ["A", "B"] } },
      provenance: { annotatedBy: "test", annotatedAt: "2026-08-27", tool: "vitest" },
    };
    const g = buildAdj(raw);
    expect(bfsShortest(g, "A", "B")?.path).toEqual(["A", "B"]);
    expect(bfsShortest(g, "B", "A")?.path).toEqual(["B", "A"]);
  });
});
