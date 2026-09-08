import { describe, expect, it } from "vitest";

import { spreadFocusEdges } from "../src/angular-layout";
import { LOCAL_GRAPH_NODE_GAP, type PositionedPgmNode } from "../src/local-graph-layout";
import { NODE_RADIUS, NODE_WIDTH } from "../src/node-presentation";
import type { PgmEdge } from "../src/pgm";

function node(id: string, x: number, circleY: number, height = 102): PositionedPgmNode {
  return { id, x, y: circleY + height / 2 - NODE_RADIUS, width: NODE_WIDTH, height,
    path: `${id}.md`, type: "Record", properties: { name: id } };
}

function circleY(current: PositionedPgmNode): number {
  return current.y - current.height / 2 + NODE_RADIUS;
}

function polarNode(id: string, focus: PositionedPgmNode, radius: number, degrees: number, height: number) {
  const angle = degrees * Math.PI / 180;
  return node(id, focus.x + Math.cos(angle) * radius, circleY(focus) + Math.sin(angle) * radius, height);
}

function edge(id: string, source: string, target: string): PgmEdge {
  return { id, source, target, text: id, properties: {}, resolved: true };
}

function fixture(angles = [11.9, 12, 12.05, 12.1, 12.18, 12.2]) {
  const focus = node("focus", -120, 75, 190);
  const members = angles.map((angle, index) => polarNode(
    `member-${index}`, focus, 500 + index * 450, angle, [102, 168, 256, 344][index % 4]!,
  ));
  return {
    nodes: [focus, ...members],
    edges: members.map(({ id }, index) => index % 2 === 0
      ? edge(`focus-${id}`, focus.id, id) : edge(`${id}-focus`, id, focus.id)),
  };
}

function expectNoOverlaps(nodes: readonly PositionedPgmNode[]): void {
  for (const [index, left] of nodes.entries()) {
    for (const right of nodes.slice(index + 1)) {
      const clearX = Math.abs(left.x - right.x) >= (left.width + right.width) / 2 + LOCAL_GRAPH_NODE_GAP - 0.000001;
      const clearY = Math.abs(left.y - right.y) >= (left.height + right.height) / 2 + LOCAL_GRAPH_NODE_GAP - 0.000001;
      expect(clearX || clearY, `${left.id} overlaps ${right.id}`).toBe(true);
    }
  }
}

function spokeAngles(nodes: readonly PositionedPgmNode[], ids: readonly string[]): number[] {
  const focus = nodes.find(({ id }) => id === "focus")!;
  return ids.map((id) => {
    const current = nodes.find((item) => item.id === id)!;
    return (Math.atan2(circleY(current) - circleY(focus), current.x - focus.x) + Math.PI * 2) % (Math.PI * 2);
  }).sort((left, right) => left - right);
}

function expectDistinctSpokes(nodes: readonly PositionedPgmNode[], ids: readonly string[]): void {
  const angles = spokeAngles(nodes, ids);
  for (const [index, angle] of angles.entries()) {
    const next = angles[(index + 1) % angles.length]! + (index === angles.length - 1 ? Math.PI * 2 : 0);
    expect((next - angle) * 180 / Math.PI).toBeGreaterThanOrEqual(4 - 0.000001);
  }
}

describe("spreadFocusEdges", () => {
  it("separates nearly collinear neighbours on different rings using their actual circle centres", () => {
    const graph = fixture();
    const snapshot = structuredClone(graph);
    expectNoOverlaps(graph.nodes);

    const result = spreadFocusEdges(graph.nodes, graph.edges, "focus", LOCAL_GRAPH_NODE_GAP);

    expectDistinctSpokes(result, graph.nodes.slice(1).map(({ id }) => id));
    expectNoOverlaps(result);
    expect(result[0]).toEqual(graph.nodes[0]);
    expect(result.map(({ id, width, height }) => ({ id, width, height })))
      .toEqual(graph.nodes.map(({ id, width, height }) => ({ id, width, height })));
    expect(result.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(graph).toEqual(snapshot);
  });

  it("is deterministic across input permutations and repeated calls", () => {
    const graph = fixture();
    const first = spreadFocusEdges(graph.nodes, graph.edges, "focus", LOCAL_GRAPH_NODE_GAP);
    const reversed = spreadFocusEdges(graph.nodes.slice().reverse(), graph.edges.slice().reverse(), "focus", LOCAL_GRAPH_NODE_GAP);

    expect(reversed.reverse()).toEqual(first);
    expect(spreadFocusEdges(graph.nodes, graph.edges, "focus", LOCAL_GRAPH_NODE_GAP)).toEqual(first);
  });

  it("preserves the same spokes when duplicate, reciprocal, self, or unrelated edges are added", () => {
    const graph = fixture();
    const extras = [
      ...graph.edges.map((current) => ({ ...current, id: `${current.id}-duplicate` })),
      ...graph.edges.map((current) => ({ ...current, id: `${current.id}-reverse`, source: current.target, target: current.source })),
      edge("focus-self", "focus", "focus"),
      edge("member-self", "member-2", "member-2"),
      edge("unrelated", "member-1", "member-3"),
      edge("unresolved", "focus", "not-visible"),
    ];

    expect(spreadFocusEdges(graph.nodes, [...extras, ...graph.edges], "focus", LOCAL_GRAPH_NODE_GAP))
      .toEqual(spreadFocusEdges(graph.nodes, graph.edges, "focus", LOCAL_GRAPH_NODE_GAP));
  });

  it("separates a cluster crossing the -π/+π seam without sending it around the circle", () => {
    const graph = fixture([178.8, 179.9, -179.95, -179.5, -178.7]);
    expectNoOverlaps(graph.nodes);
    const result = spreadFocusEdges(graph.nodes, graph.edges, "focus", LOCAL_GRAPH_NODE_GAP);
    const ids = graph.nodes.slice(1).map(({ id }) => id);

    expectDistinctSpokes(result, ids);
    expectNoOverlaps(result);
    for (const angle of spokeAngles(result, ids)) {
      expect(Math.abs(angle - Math.PI) * 180 / Math.PI).toBeLessThan(30);
    }
    expect(result[0]).toEqual(graph.nodes[0]);
  });

  it("moves an adjusted spoke outward when it would hit a stationary title footprint", () => {
    const focus = node("focus", 0, 0, 190);
    const members = [
      polarNode("near", focus, 500, 90, 102),
      polarNode("middle", focus, 1100, 90.05, 256),
      polarNode("far", focus, 1700, 90.1, 168),
    ];
    const bystander = node("bystander", NODE_WIDTH + LOCAL_GRAPH_NODE_GAP + 16, 500);
    const nodes = [focus, ...members, bystander];
    const edges = members.map(({ id }) => edge(`focus-${id}`, "focus", id));
    expectNoOverlaps(nodes);

    const result = spreadFocusEdges(nodes, edges, "focus", LOCAL_GRAPH_NODE_GAP);
    const near = result.find(({ id }) => id === "near")!;

    expect(Math.hypot(near.x, circleY(near))).toBeGreaterThan(500);
    expectNoOverlaps(result);
    expectDistinctSpokes(result, members.map(({ id }) => id));
    expect(result.find(({ id }) => id === "bystander")).toEqual(bystander);
    expect(result.find(({ id }) => id === "focus")).toEqual(focus);
  });
});
