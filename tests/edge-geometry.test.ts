import { describe, expect, it } from "vitest";

import { assignEdgeBends, edgeGeometry, unresolvedTarget } from "../src/edge-geometry";
import type { PositionedPgmNode } from "../src/local-graph-layout";
import { NODE_RADIUS } from "../src/node-presentation";
import type { PgmEdge } from "../src/pgm";

function node(id: string, x: number, circleY: number, height = 98): PositionedPgmNode {
  return { id, x, y: circleY + height / 2 - NODE_RADIUS, width: 216, height,
    path: `${id}.md`, type: "Concept", properties: {} };
}

function edge(id: string, source: string, target: string): PgmEdge {
  return { id, source, target, text: id, properties: {}, resolved: true };
}

function points(path: string): Array<{ x: number; y: number }> {
  const numbers = path.replace(/[MLQC,]/g, " ").trim().split(/\s+/).map(Number);
  expect(numbers.every(Number.isFinite)).toBe(true);
  return Array.from({ length: numbers.length / 2 }, (_, index) => ({
    x: numbers[index * 2]!, y: numbers[index * 2 + 1]!,
  }));
}

function expectCirclePoint(point: { x: number; y: number }, circle: PositionedPgmNode): void {
  const y = circle.y - circle.height / 2 + NODE_RADIUS;
  expect(Math.hypot(point.x - circle.x, point.y - y)).toBeCloseTo(NODE_RADIUS, 8);
}

describe("edgeGeometry", () => {
  it("connects circle borders rather than the centres of their differently sized title boxes", () => {
    const source = node("a", 100, 80);
    const target = node("b", 400, 80, 260);
    const result = edgeGeometry(source, target, false, true, 0);

    expect(result.path).toBe("M 136 80 L 364 80");
    expect(result.label).toEqual({ x: 250, y: 80, angle: 0 });
    const [start, end] = points(result.path);
    expectCirclePoint(start!, source);
    expectCirclePoint(end!, target);
  });

  it("places a quadratic caption on its actual midpoint with the readable midpoint tangent", () => {
    const source = node("a", 400, 100, 160);
    const target = node("b", 100, 300, 220);
    const result = edgeGeometry(source, target, false, true, 84);
    const [start, control, end] = points(result.path);

    expectCirclePoint(start!, source);
    expectCirclePoint(end!, target);
    expect(result.label.x).toBeCloseTo((start!.x + 2 * control!.x + end!.x) / 4, 8);
    expect(result.label.y).toBeCloseTo((start!.y + 2 * control!.y + end!.y) / 4, 8);
    expect(result.label.angle).toBeGreaterThanOrEqual(-90);
    expect(result.label.angle).toBeLessThanOrEqual(90);
    const tangent = Math.atan2(end!.y - start!.y, end!.x - start!.x);
    expect(Math.abs(Math.cos(result.label.angle * Math.PI / 180 - tangent))).toBeCloseTo(1, 8);
  });

  it("departs and arrives radially at distinct curved ports while preserving curve symmetry", () => {
    const source = node("a", 40, 80, 170);
    const target = node("b", 370, 260, 230);
    const result = edgeGeometry(source, target, false, true, 96);
    const [start, control, end] = points(result.path);
    const sourceRadius = { x: start!.x - source.x, y: start!.y - 80 };
    const departure = { x: control!.x - start!.x, y: control!.y - start!.y };
    const targetInward = { x: target.x - end!.x, y: 260 - end!.y };
    const arrival = { x: end!.x - control!.x, y: end!.y - control!.y };

    expectCirclePoint(start!, source);
    expectCirclePoint(end!, target);
    expect(sourceRadius.x * departure.y - sourceRadius.y * departure.x).toBeCloseTo(0, 7);
    expect(targetInward.x * arrival.y - targetInward.y * arrival.x).toBeCloseTo(0, 7);
    expect(sourceRadius.x * departure.x + sourceRadius.y * departure.y).toBeGreaterThan(0);
    expect(targetInward.x * arrival.x + targetInward.y * arrival.y).toBeGreaterThan(0);
    expect(Math.hypot(control!.x - start!.x, control!.y - start!.y))
      .toBeCloseTo(Math.hypot(control!.x - end!.x, control!.y - end!.y), 8);
  });

  it("uses a symmetric self loop whose caption is centred on the actual cubic curve", () => {
    const source = node("self", 100, 240, 320);
    const result = edgeGeometry(source, source, true, true, 20);
    const [start, control1, control2, end] = points(result.path);

    expectCirclePoint(start!, source);
    expectCirclePoint(end!, source);
    expect(result.label.x).toBeCloseTo((start!.x + 3 * control1!.x + 3 * control2!.x + end!.x) / 8, 8);
    expect(result.label.y).toBeCloseTo((start!.y + 3 * control1!.y + 3 * control2!.y + end!.y) / 8, 8);
    expect(result.label.y).toBe(240);
    expect(result.label.angle).toBe(90);
    expect(result.label.x).toBeGreaterThan(source.x + NODE_RADIUS);
  });

  it("remains finite and attaches to circles when dragged nodes temporarily coincide", () => {
    const source = node("a", 150, -120, 170);
    const target = node("b", 150, -120, 340);
    for (const bend of [0, -56, 56]) {
      const result = edgeGeometry(source, target, false, true, bend);
      const pathPoints = points(result.path);
      expectCirclePoint(pathPoints[0]!, source);
      expectCirclePoint(pathPoints[pathPoints.length - 1]!, target);
      expect(Object.values(result.label).every(Number.isFinite)).toBe(true);
    }
  });

  it("keeps captions upright on vertical and leftward routes", () => {
    const source = node("a", 0, 0);
    for (const [x, y] of [[0, 300], [0, -300], [-300, -20], [-300, 20]]) {
      const result = edgeGeometry(source, node("b", x!, y!), false, true, 28);
      expect(result.label.angle).toBeGreaterThanOrEqual(-90);
      expect(result.label.angle).toBeLessThanOrEqual(90);
      expect(Object.values(result.label).every(Number.isFinite)).toBe(true);
    }
  });
});

describe("assignEdgeBends", () => {
  it("gives parallel and reciprocal edges distinct world routes and caption positions", () => {
    const source = node("a", 0, 0);
    const target = node("b", 400, 0);
    const edges = [edge("a1", "a", "b"), edge("a2", "a", "b"), edge("b1", "b", "a"), edge("b2", "b", "a")];
    const bends = assignEdgeBends(edges);
    const positions = edges.map((current) => edgeGeometry(
      current.source === "a" ? source : target,
      current.target === "b" ? target : source,
      false, true, bends.get(current.id)!,
    ));

    expect(new Set(positions.map(({ path }) => path)).size).toBe(edges.length);
    const portsAtA = positions.map((geometry, index) => {
      const pathPoints = points(geometry.path);
      const port = edges[index]!.source === "a" ? pathPoints[0]! : pathPoints[pathPoints.length - 1]!;
      expectCirclePoint(port, source);
      return `${port.x.toFixed(8)}:${port.y.toFixed(8)}`;
    });
    const portsAtB = positions.map((geometry, index) => {
      const pathPoints = points(geometry.path);
      const port = edges[index]!.source === "b" ? pathPoints[0]! : pathPoints[pathPoints.length - 1]!;
      expectCirclePoint(port, target);
      return `${port.x.toFixed(8)}:${port.y.toFixed(8)}`;
    });
    expect(new Set(portsAtA).size).toBe(edges.length);
    expect(new Set(portsAtB).size).toBe(edges.length);
    const labelYs = positions.map(({ label }) => label.y).sort((left, right) => left - right);
    for (let index = 1; index < labelYs.length; index += 1) {
      expect(labelYs[index]! - labelYs[index - 1]!).toBeGreaterThanOrEqual(28);
    }
  });

  it("is independent of input order, never mutates edges, and distinguishes self loops", () => {
    const edges = [edge("loop2", "a", "a"), edge("ba", "b", "a"), edge("loop1", "a", "a"), edge("ab", "a", "b")];
    const original = structuredClone(edges);
    const bends = assignEdgeBends(edges);

    expect([...assignEdgeBends(edges.slice().reverse())]).toEqual([...bends]);
    expect(edges).toEqual(original);
    const source = node("a", 0, 0);
    const first = edgeGeometry(source, source, true, true, bends.get("loop1")!);
    const second = edgeGeometry(source, source, true, true, bends.get("loop2")!);
    expect(first.path).not.toBe(second.path);
    expect(first.label.x).not.toBe(second.label.x);
    expect(assignEdgeBends([]).size).toBe(0);
  });
});

describe("unresolvedTarget", () => {
  it("uses deterministic circle-relative coordinates and draws to the endpoint itself", () => {
    const source = node("source", 140, 290, 380);
    const original = structuredClone(source);
    const target = unresolvedTarget(source, "absent", 3);
    const result = edgeGeometry(source, target, false, false, 0);
    const [start, end] = points(result.path);

    expect(target).toEqual(unresolvedTarget(source, "absent", 3));
    expect(Math.hypot(target.x - source.x, target.y - 290)).toBeCloseTo(NODE_RADIUS + 100, 8);
    expectCirclePoint(start!, source);
    expect(end).toEqual({ x: target.x, y: target.y });
    expect(target.width).toBe(0);
    expect(target.height).toBe(0);
    expect(source).toEqual(original);
  });
});
