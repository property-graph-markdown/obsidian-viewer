import { describe, expect, it } from "vitest";

import {
  LOCAL_GRAPH_MIN_HEIGHT,
  LOCAL_GRAPH_MIN_WIDTH,
  LOCAL_GRAPH_NODE_GAP,
  LOCAL_GRAPH_PADDING,
  layoutLocalGraph,
  resolveNodeOverlaps,
  type LocalGraphLayout,
  type PositionedPgmNode,
} from "../src/local-graph-layout";
import { nodePresentation } from "../src/node-presentation";
import type { PgmEdge, PgmNode } from "../src/pgm";

function node(id: string, type = "Thing"): PgmNode {
  return {
    id,
    path: `${id}.md`,
    type,
    properties: { type, name: id },
  };
}

function edge(id: string, source: string, target: string): PgmEdge {
  return {
    id,
    source,
    target,
    text: target,
    properties: {},
    resolved: true,
  };
}

function fixture(): { nodes: PgmNode[]; edges: PgmEdge[] } {
  return {
    nodes: [
      node("focus"),
      node("alpha"),
      node("beta"),
      node("gamma"),
      node("delta"),
      node("epsilon"),
    ],
    edges: [
      edge("focus-alpha", "focus", "alpha"),
      edge("beta-focus", "beta", "focus"),
      edge("alpha-gamma", "alpha", "gamma"),
      edge("gamma-delta", "gamma", "delta"),
      edge("delta-beta", "delta", "beta"),
      edge("parallel", "alpha", "focus"),
      edge("self", "epsilon", "epsilon"),
      edge("unresolved", "focus", "not-visible"),
    ],
  };
}

function mixedTypeFixture(): { nodes: PgmNode[]; edges: PgmEdge[] } {
  const groups = [
    { type: "Archive fragment", count: 20 },
    { type: "archive fragment", count: 10 },
    { type: "λ:Signal/v2", count: 4 },
  ];
  let index = 0;
  const members = groups.flatMap(({ type, count }) => Array.from({ length: count }, () => {
    // Interleave IDs independently of type so ID sorting cannot create clusters.
    const slot = index++ * 13 % 34;
    const current = node(`item-${String(slot).padStart(2, "0")}`, type);
    return {
      ...current,
      properties: {
        ...current.properties,
        name: `Item ${slot} ${"with measured title detail ".repeat(slot % 5)}`,
      },
    };
  }));

  return {
    nodes: [node("focus", "Navigation origin"), ...members],
    // All types have the same connectivity; clustering must come from their types.
    edges: members.map(({ id }) => edge(`focus-${id}`, "focus", id)),
  };
}

function layoutGeometry(layout: LocalGraphLayout) {
  return {
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
  };
}

function expectFiniteAndInBounds(layout: LocalGraphLayout): void {
  expect(Number.isFinite(layout.width)).toBe(true);
  expect(Number.isFinite(layout.height)).toBe(true);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThan(0);

  for (const positioned of layout.nodes) {
    expect(Number.isFinite(positioned.x)).toBe(true);
    expect(Number.isFinite(positioned.y)).toBe(true);
    expect(Number.isFinite(positioned.width)).toBe(true);
    expect(Number.isFinite(positioned.height)).toBe(true);
    expect(positioned.width).toBeGreaterThan(0);
    expect(positioned.height).toBeGreaterThan(0);
    expect(positioned.x - positioned.width / 2).toBeGreaterThanOrEqual(LOCAL_GRAPH_PADDING);
    expect(positioned.x + positioned.width / 2).toBeLessThanOrEqual(layout.width - LOCAL_GRAPH_PADDING);
    expect(positioned.y - positioned.height / 2).toBeGreaterThanOrEqual(LOCAL_GRAPH_PADDING);
    expect(positioned.y + positioned.height / 2).toBeLessThanOrEqual(layout.height - LOCAL_GRAPH_PADDING);
  }
}

function expectNoOverlaps(nodes: readonly PositionedPgmNode[]): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (const right of nodes.slice(leftIndex + 1)) {
      const clearX = Math.abs(left.x - right.x) >= (left.width + right.width) / 2 + LOCAL_GRAPH_NODE_GAP - 0.000001;
      const clearY = Math.abs(left.y - right.y) >= (left.height + right.height) / 2 + LOCAL_GRAPH_NODE_GAP - 0.000001;
      expect(clearX || clearY, `${left.id} overlaps ${right.id}`).toBe(true);
    }
  }
}

function positionedNode(id: string, x: number, y: number, width = 216, height = 58): PositionedPgmNode {
  return { ...node(id), x, y, width, height };
}

describe("layoutLocalGraph", () => {
  it("is deterministic independent of input order and does not mutate its inputs", () => {
    const graph = fixture();
    const originalNodes = structuredClone(graph.nodes);
    const originalEdges = structuredClone(graph.edges);

    const first = layoutLocalGraph(graph.nodes, graph.edges, "focus");
    const reordered = layoutLocalGraph(
      graph.nodes.slice().reverse(),
      [graph.edges[5], ...graph.edges.slice(0, 5).reverse(), ...graph.edges.slice(6)].filter(
        (item): item is PgmEdge => item !== undefined,
      ),
      "focus",
    );
    const repeated = layoutLocalGraph(graph.nodes, graph.edges, "focus");

    expect(reordered).toEqual(first);
    expect(repeated).toEqual(first);
    expect(graph.nodes).toEqual(originalNodes);
    expect(graph.edges).toEqual(originalEdges);
  });

  it("keeps the visible focus exactly at the SVG centre", () => {
    const graph = fixture();
    const layout = layoutLocalGraph(graph.nodes, graph.edges, "focus");
    const focus = layout.nodes.find(({ id }) => id === "focus");

    expect(focus).toBeDefined();
    expect(focus?.x).toBe(layout.width / 2);
    expect(focus?.y).toBe(layout.height / 2);
  });

  it("returns finite, in-bounds positions for a connected graph", () => {
    const nodes = Array.from({ length: 24 }, (_, index) => node(`node-${index}`));
    const edges = Array.from({ length: 42 }, (_, index) =>
      edge(
        `edge-${index}`,
        `node-${index % nodes.length}`,
        `node-${(index * 7 + 3) % nodes.length}`,
      ),
    );
    const layout = layoutLocalGraph(nodes, edges, "node-0");

    expect(layout.nodes).toHaveLength(nodes.length);
    expectFiniteAndInBounds(layout);
    expectNoOverlaps(layout.nodes);
  });

  it("returns a stable minimum viewport for an empty graph", () => {
    const layout = layoutLocalGraph([], [], "missing");

    expect(layout).toEqual({
      nodes: [],
      width: LOCAL_GRAPH_MIN_WIDTH,
      height: LOCAL_GRAPH_MIN_HEIGHT,
    });
    expectFiniteAndInBounds(layout);
  });

  it("lays out isolated nodes and centres a single isolated focus", () => {
    const single = layoutLocalGraph([node("focus")], [], "focus");
    expect(single.nodes[0]).toMatchObject({
      id: "focus",
      x: LOCAL_GRAPH_MIN_WIDTH / 2,
      y: LOCAL_GRAPH_MIN_HEIGHT / 2,
    });
    expect(single.width).toBe(LOCAL_GRAPH_MIN_WIDTH);
    expect(single.height).toBe(LOCAL_GRAPH_MIN_HEIGHT);

    const isolated = layoutLocalGraph(
      [node("focus"), node("one"), node("two"), node("three"), node("four")],
      [],
      "focus",
    );
    expectFiniteAndInBounds(isolated);
    expect(new Set(isolated.nodes.map(({ x, y }) => `${x}:${y}`)).size).toBe(
      isolated.nodes.length,
    );
    expectNoOverlaps(isolated.nodes);
  });

  it("keeps dense graphs collision-free with measured multiline node sizes", () => {
    const nodes = Array.from({ length: 72 }, (_, index) => ({
      ...node(`node-${index}`),
      properties: { name: `Concept ${index} ${"with a longer node title ".repeat(index % 8)}` },
    }));
    const edges = nodes.flatMap((source, index) => nodes.slice(index + 1).map((target) =>
      edge(`${source.id}-${target.id}`, source.id, target.id),
    ));
    const layout = layoutLocalGraph(nodes, edges, "node-23");

    expectFiniteAndInBounds(layout);
    expectNoOverlaps(layout.nodes);
    for (const current of layout.nodes) {
      const presentation = nodePresentation(current);
      expect(current.width).toBe(presentation.width);
      expect(current.height).toBe(presentation.height);
    }
    expect(new Set(layout.nodes.map(({ height }) => height)).size).toBeGreaterThan(1);
    expect(layout.nodes.find(({ id }) => id === "node-23")).toMatchObject({
      x: layout.width / 2,
      y: layout.height / 2,
    });
  });

  it("includes complete unusually long labels in the padded viewport", () => {
    const longTitle = {
      ...node("long-title"),
      properties: { name: "A title spanning many rows without clipping. ".repeat(80) },
    };
    const graph = [node("focus"), longTitle, node("nearby")];
    const layout = layoutLocalGraph(graph, [edge("long", "focus", "long-title")], "focus");

    expect(layout.nodes.find(({ id }) => id === "long-title")?.height).toBeGreaterThan(420);
    expectFiniteAndInBounds(layout);
    expectNoOverlaps(layout.nodes);
  });

  it("clusters unbalanced exact types around the pinned focus while protecting full title footprints", () => {
    const graph = mixedTypeFixture();
    const layout = layoutLocalGraph(graph.nodes, graph.edges, "focus");
    const members = layout.nodes.filter(({ id }) => id !== "focus");
    const sameTypeNeighbours = members.filter((current) => {
      const neighbours = layout.nodes.filter(({ id }) => id !== current.id);
      const distance = (other: PositionedPgmNode): number => Math.hypot(
        current.x - other.x, current.y - other.y,
      );
      const nearestDistance = Math.min(...neighbours.map(distance));
      return neighbours.some((other) => other.type === current.type
        && distance(other) <= nearestDistance + 0.000001);
    });

    expect(sameTypeNeighbours.length / members.length).toBeGreaterThanOrEqual(0.7);
    expectFiniteAndInBounds(layout);
    expectNoOverlaps(layout.nodes);
    expect(new Set(layout.nodes.map(({ height }) => height)).size).toBeGreaterThan(1);
    for (const current of layout.nodes) {
      const { width, height } = nodePresentation(current);
      expect(current).toMatchObject({ width, height });
    }
    expect(layout.nodes.find(({ id }) => id === "focus")).toMatchObject({
      x: layout.width / 2,
      y: layout.height / 2,
    });
  });

  it("keeps mixed-type clustering deterministic across input permutations without mutating the graph", () => {
    const graph = mixedTypeFixture();
    const snapshot = structuredClone(graph);
    const layout = layoutLocalGraph(graph.nodes, graph.edges, "focus");
    const interleaved = [
      ...graph.nodes.filter((_, index) => index % 2 === 1),
      ...graph.nodes.filter((_, index) => index % 2 === 0),
    ];

    expect(layoutLocalGraph(graph.nodes.slice().reverse(), graph.edges.slice().reverse(), "focus"))
      .toEqual(layout);
    expect(layoutLocalGraph(interleaved, [...graph.edges.slice(11), ...graph.edges.slice(0, 11)], "focus"))
      .toEqual(layout);
    expect(graph).toEqual(snapshot);
  });

  it("orders dated members by chronology without making spacing proportional to elapsed time", () => {
    const records: PgmNode[] = [
      { ...node("a", "Temporal record"), properties: { name: "A", date: "1900-02-03" } },
      { ...node("b", "Temporal record"), properties: { name: "B", year: 1800 } },
      { ...node("c", "Temporal record"), properties: { name: "C", from: "1850-11" } },
      { ...node("d", "Temporal record"), properties: { name: "D", date: "2000" } },
      node("undated", "Temporal record"),
      node("context", "Context record"),
    ];
    const focus = node("focus", "Navigation origin");
    const edges = records.map(({ id }) => edge(`focus-${id}`, "focus", id));
    const layout = layoutLocalGraph([focus, ...records], edges, "focus");
    const stretchedProperties: Record<string, PgmNode["properties"]> = {
      a: { date: "1601-02-03" },
      b: { year: 1000 },
      c: { from: "1600" },
      d: { date: "2200" },
    };
    const stretchedDates = records.map((record) => ({
      ...record,
      properties: {
        ...record.properties,
        ...stretchedProperties[record.id],
      },
    }));
    const changedOrder = records.map((record) => record.id === "b"
      ? { ...record, properties: { ...record.properties, year: 2100 } }
      : record);

    expect(layoutGeometry(layoutLocalGraph([focus, ...stretchedDates], edges, "focus")))
      .toEqual(layoutGeometry(layout));
    expect(layoutGeometry(layoutLocalGraph([focus, ...changedOrder], edges, "focus")))
      .not.toEqual(layoutGeometry(layout));
    expectFiniteAndInBounds(layout);
    expectNoOverlaps(layout.nodes);
  });

  it.each([null, "missing", "singleton-16"])(
    "keeps many arbitrary singleton types finite and collision-free with focus %s",
    (focusId) => {
      const specialTypes = ["Thing", "thing", "Thing ", "Δ", "測定", "__proto__", "constructor", ""];
      const nodes = Array.from({ length: 36 }, (_, index) => ({
        ...node(`singleton-${String(index).padStart(2, "0")}`, specialTypes[index] ?? `Custom/type-${index}`),
        properties: { name: `Isolated ${index} ${"long label ".repeat(index % 4)}` },
      }));
      const layout = layoutLocalGraph(nodes, [], focusId);
      const expectedFocusId = focusId === "singleton-16" ? focusId : "singleton-00";

      expect(layout.nodes).toHaveLength(nodes.length);
      expectFiniteAndInBounds(layout);
      expectNoOverlaps(layout.nodes);
      expect(layoutLocalGraph(nodes.slice().reverse(), [], focusId)).toEqual(layout);
      expect(layout.nodes.find(({ id }) => id === expectedFocusId)).toMatchObject({
        x: layout.width / 2,
        y: layout.height / 2,
      });
    },
  );
});

describe("resolveNodeOverlaps", () => {
  it("leaves collision-free nodes at their exact coordinates without mutating them", () => {
    const nodes = [positionedNode("a", -800, 30), positionedNode("b", 260, -310)];
    const snapshot = structuredClone(nodes);
    const result = resolveNodeOverlaps(nodes);

    expect(result).toEqual(snapshot);
    expect(nodes).toEqual(snapshot);
    expect(result).not.toBe(nodes);
    expect(result[0]).not.toBe(nodes[0]);
  });

  it("separates coincident heterogeneous rectangles and preserves a pinned drag position", () => {
    const nodes = Array.from({ length: 90 }, (_, index) => positionedNode(
      `node-${index}`, 815, -190, 80 + (index % 9) * 75, 45 + (index % 7) * 110,
    ));
    const snapshot = structuredClone(nodes);
    const result = resolveNodeOverlaps(nodes, "node-73");

    expectNoOverlaps(result);
    expect(result.find(({ id }) => id === "node-73")).toEqual(snapshot[73]);
    expect(result.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id));
    expect(result.map(({ width, height }) => ({ width, height }))).toEqual(
      nodes.map(({ width, height }) => ({ width, height })),
    );
    expect(nodes).toEqual(snapshot);
    expect(resolveNodeOverlaps(result, "node-73")).toEqual(result);
  });

  it("is deterministic independent of input order, including coincident nodes without a pin", () => {
    const nodes = Array.from({ length: 24 }, (_, index) => positionedNode(
      `node-${index}`, index % 3, index % 4, 100 + index * 10, 60 + index * 8,
    ));
    const first = resolveNodeOverlaps(nodes);
    const reversed = resolveNodeOverlaps(nodes.slice().reverse()).reverse();

    expect(reversed).toEqual(first);
    expect(resolveNodeOverlaps(nodes)).toEqual(first);
    expectNoOverlaps(first);
  });

  it("protects initially clear bystanders while moving a colliding node around occupied slots", () => {
    const nodes = [
      positionedNode("a-overlap", 0, 0, 300, 120),
      positionedNode("z-pinned", 0, 0, 300, 120),
      positionedNode("left", -340, 0, 300, 120),
      positionedNode("right", 340, 0, 300, 120),
      positionedNode("up", 0, -160, 300, 120),
      positionedNode("down", 0, 160, 300, 120),
    ];
    const result = resolveNodeOverlaps(nodes, "z-pinned");

    expectNoOverlaps(result);
    expect(result.slice(1)).toEqual(nodes.slice(1));
    expect(result[0]).not.toEqual(nodes[0]);
  });

  it("handles empty input and a missing pin", () => {
    expect(resolveNodeOverlaps([], "missing")).toEqual([]);
    const nodes = [positionedNode("a", 0, 0), positionedNode("b", 0, 0)];
    expectNoOverlaps(resolveNodeOverlaps(nodes, "missing"));
  });
});
