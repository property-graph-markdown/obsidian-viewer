import { describe, expect, it } from "vitest";

import {
  collapseLocalNode,
  createLocalGraphState,
  expandLocalNode,
  projectLocalGraph,
  refocusLocalGraph,
  toggleLocalNodeExpansion,
} from "../src/local-graph";
import type { PgmEdge, PgmGraph, PgmNode } from "../src/pgm";

function node(id: string): PgmNode {
  return {
    id,
    path: `${id}.md`,
    type: "Thing",
    properties: { type: "Thing", name: id },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  options: Partial<Pick<PgmEdge, "type" | "properties" | "resolved">> = {},
): PgmEdge {
  return {
    id,
    source,
    target,
    text: target,
    properties: options.properties ?? {},
    resolved: options.resolved ?? true,
    ...(options.type === undefined ? {} : { type: options.type }),
  };
}

function fixture(): PgmGraph {
  return {
    nodes: [
      node("focus"),
      node("out"),
      node("in"),
      node("shared"),
      node("out-leaf"),
      node("in-leaf"),
      node("deep-leaf"),
      node("isolated"),
    ],
    edges: [
      edge("focus-out", "focus", "out", {
        type: "outgoing_to",
        properties: { type: "outgoing_to", weight: 2 },
      }),
      edge("in-focus", "in", "focus", {
        type: "incoming_from",
        properties: { type: "incoming_from", role: "source" },
      }),
      edge("neighbors-cross", "out", "in", { type: "crosses" }),
      edge("out-shared", "out", "shared", { type: "shares" }),
      edge("shared-in", "shared", "in", { type: "returns_to" }),
      edge("out-leaf", "out", "out-leaf"),
      edge("in-leaf", "in-leaf", "in"),
      edge("shared-deep", "shared", "deep-leaf"),
      edge("focus-self", "focus", "focus", { type: "self" }),
      edge("focus-missing", "focus", "missing", {
        type: "references",
        properties: { type: "references", confidence: 0.8 },
        resolved: false,
      }),
      edge("out-missing", "out", "another-missing", { resolved: false }),
    ],
    diagnostics: [],
  };
}

function ids(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map(({ id }) => id);
}

describe("projectLocalGraph", () => {
  it("starts with the focus and its direct incoming and outgoing neighbors", () => {
    const graph = fixture();
    const projection = projectLocalGraph(graph, createLocalGraphState("focus"));

    expect(ids(projection.nodes)).toEqual(["focus", "out", "in"]);
    expect(ids(projection.edges)).toEqual([
      "focus-out",
      "in-focus",
      "focus-self",
      "focus-missing",
    ]);
    expect([...projection.activeOriginNodeIds]).toEqual(["focus"]);

    expect(projection.edges[0]).toBe(graph.edges[0]);
    expect(projection.edges[0]).toMatchObject({
      source: "focus",
      target: "out",
      type: "outgoing_to",
      properties: { type: "outgoing_to", weight: 2 },
    });
    expect(projection.edges[1]).toMatchObject({
      source: "in",
      target: "focus",
      type: "incoming_from",
      properties: { type: "incoming_from", role: "source" },
    });
  });

  it("adds one hop for each reachable expanded node without inducing unrelated edges", () => {
    const graph = fixture();
    const state = expandLocalNode(createLocalGraphState("focus"), "out");
    const projection = projectLocalGraph(graph, state);

    expect(ids(projection.nodes)).toEqual([
      "focus",
      "out",
      "in",
      "shared",
      "out-leaf",
    ]);
    expect(ids(projection.edges)).toEqual([
      "focus-out",
      "in-focus",
      "neighbors-cross",
      "out-shared",
      "out-leaf",
      "focus-self",
      "focus-missing",
      "out-missing",
    ]);
    expect(ids(projection.edges)).not.toContain("shared-in");
    expect([...projection.activeOriginNodeIds]).toEqual(["focus", "out"]);
  });

  it("activates nested expansions only while they remain reachable from the focus", () => {
    const graph = fixture();
    let state = createLocalGraphState("focus");
    state = expandLocalNode(state, "out");
    state = expandLocalNode(state, "shared");

    const expanded = projectLocalGraph(graph, state);
    expect(ids(expanded.nodes)).toContain("deep-leaf");
    expect([...expanded.activeOriginNodeIds]).toEqual(["focus", "out", "shared"]);

    state = collapseLocalNode(state, "out");
    const collapsed = projectLocalGraph(graph, state);
    expect(ids(collapsed.nodes)).toEqual(["focus", "out", "in"]);
    expect(ids(collapsed.edges)).not.toContain("shared-deep");
    expect([...collapsed.activeOriginNodeIds]).toEqual(["focus"]);
  });

  it("keeps nodes and edges that another expanded origin still exposes after collapse", () => {
    const graph = fixture();
    let state = createLocalGraphState("focus");
    state = expandLocalNode(state, "out");
    state = expandLocalNode(state, "in");
    state = collapseLocalNode(state, "out");

    const projection = projectLocalGraph(graph, state);
    expect(ids(projection.nodes)).toEqual([
      "focus",
      "out",
      "in",
      "shared",
      "in-leaf",
    ]);
    expect(ids(projection.edges)).toEqual([
      "focus-out",
      "in-focus",
      "neighbors-cross",
      "shared-in",
      "in-leaf",
      "focus-self",
      "focus-missing",
    ]);
    expect([...projection.activeOriginNodeIds]).toEqual(["focus", "in"]);
  });

  it("keeps unresolved edges from active origins without inventing target nodes", () => {
    const projection = projectLocalGraph(fixture(), createLocalGraphState("focus"));
    const unresolved = projection.edges.find(({ id }) => id === "focus-missing");

    expect(unresolved).toMatchObject({
      source: "focus",
      target: "missing",
      resolved: false,
      properties: { type: "references", confidence: 0.8 },
    });
    expect(ids(projection.nodes)).not.toContain("missing");
    expect(ids(projection.edges)).not.toContain("out-missing");
  });

  it("returns an empty projection for a missing or cleared focus", () => {
    const graph = fixture();
    expect(projectLocalGraph(graph, createLocalGraphState("unknown"))).toMatchObject({
      nodes: [],
      edges: [],
    });
    expect(projectLocalGraph(graph, createLocalGraphState(null))).toMatchObject({
      nodes: [],
      edges: [],
    });
  });
});

describe("localized graph state", () => {
  it("updates disclosure immutably and toggles a node", () => {
    const initial = createLocalGraphState("focus");
    const expanded = toggleLocalNodeExpansion(initial, "out");
    const collapsed = toggleLocalNodeExpansion(expanded, "out");

    expect([...initial.expandedNodeIds]).toEqual(["focus"]);
    expect([...expanded.expandedNodeIds]).toEqual(["focus", "out"]);
    expect([...collapsed.expandedNodeIds]).toEqual(["focus"]);
  });

  it("lets the focus contract to itself and expand back to its first hop", () => {
    const graph = fixture();
    const initial = createLocalGraphState("focus");
    const contracted = collapseLocalNode(initial, "focus");

    expect(ids(projectLocalGraph(graph, contracted).nodes)).toEqual(["focus"]);
    expect(projectLocalGraph(graph, contracted).edges).toEqual([]);

    const expanded = expandLocalNode(contracted, "focus");
    expect(ids(projectLocalGraph(graph, expanded).nodes)).toEqual([
      "focus",
      "out",
      "in",
    ]);
  });

  it("refocuses with a fresh one-hop disclosure", () => {
    const graph = fixture();
    const expanded = expandLocalNode(createLocalGraphState("focus"), "in");
    const refocused = refocusLocalGraph(expanded, "out");
    const projection = projectLocalGraph(graph, refocused);

    expect(refocused.focusNodeId).toBe("out");
    expect([...refocused.expandedNodeIds]).toEqual(["out"]);
    expect(ids(projection.nodes)).toEqual([
      "focus",
      "out",
      "in",
      "shared",
      "out-leaf",
    ]);
    expect(ids(projection.nodes)).not.toContain("in-leaf");
    expect(ids(projection.edges)).toContain("out-missing");
  });
});
