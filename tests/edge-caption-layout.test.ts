import { describe, expect, it } from "vitest";

import { placeEdgeCaptions, type EdgeCaptionLayout } from "../src/edge-caption-layout";
import { NODE_MIN_HEIGHT, NODE_RADIUS, NODE_WIDTH } from "../src/node-presentation";

function caption(id: string, values: Partial<EdgeCaptionLayout> = {}): EdgeCaptionLayout {
  return { id, x: 0, y: 0, width: 80, height: 22, angle: 0, maxShift: 180, ...values };
}

function nodeAtCircle(x: number, y: number) {
  return { x, y: y + NODE_MIN_HEIGHT / 2 - NODE_RADIUS, width: NODE_WIDTH, height: NODE_MIN_HEIGHT };
}

describe("placeEdgeCaptions", () => {
  it("retains clear midpoints, angles, and caller-owned geometry", () => {
    const captions = [caption("one", { x: 18, y: 27, angle: -35 })];
    const snapshot = structuredClone(captions);

    expect(placeEdgeCaptions(captions, []).get("one")).toEqual({ x: 18, y: 27, angle: -35 });
    expect(captions).toEqual(snapshot);
  });

  it("separates crossing text rectangles by sliding along the unchanged baseline", () => {
    const result = placeEdgeCaptions([
      caption("first", { angle: 0 }), caption("second", { angle: 90 }),
    ], []);
    const first = result.get("first")!;
    const second = result.get("second")!;

    expect(first).toEqual({ x: 0, y: 0, angle: 0 });
    expect(second.x).toBeCloseTo(0);
    expect(Math.abs(second.y)).toBeGreaterThan(51);
    expect(Math.abs(second.y)).toBeLessThanOrEqual(180);
    expect(second.angle).toBe(90);
  });

  it("uses rotated footprints without moving already-clear parallel captions", () => {
    const result = placeEdgeCaptions([
      caption("first", { width: 200, angle: 45 }),
      caption("second", { width: 200, angle: 45, y: 60 }),
    ], []);

    // Their axis-aligned bounding boxes overlap, but the text rectangles do not.
    expect(result.get("first")).toEqual({ x: 0, y: 0, angle: 45 });
    expect(result.get("second")).toEqual({ x: 0, y: 60, angle: 45 });
  });

  it("protects the actual node circle without treating its entire title width as circle width", () => {
    const result = placeEdgeCaptions([caption("near-circle")], [nodeAtCircle(0, 0)]).get("near-circle")!;

    expect(result.y).toBe(0);
    expect(Math.abs(result.x)).toBeGreaterThanOrEqual(80);
    expect(Math.abs(result.x)).toBeLessThan(100);
  });

  it("protects the wider title field below each node circle", () => {
    const result = placeEdgeCaptions([caption("near-title", { y: 50 })], [nodeAtCircle(0, 0)])
      .get("near-title")!;

    expect(result.y).toBe(50);
    expect(Math.abs(result.x)).toBeGreaterThanOrEqual(NODE_WIDTH / 2 + 40);
    expect(Math.abs(result.x)).toBeLessThanOrEqual(180);
  });

  it("moves text away from a crossing foreign edge while ignoring its own connection", () => {
    const captions = [caption("own", { maxShift: 100 })];
    const ownEdge = { id: "own", x1: -200, y1: 0, x2: 200, y2: 0 };
    const foreignEdge = { id: "other", x1: 0, y1: -100, x2: 0, y2: 100 };

    expect(placeEdgeCaptions(captions, [], [ownEdge]).get("own"))
      .toEqual({ x: 0, y: 0, angle: 0 });
    const moved = placeEdgeCaptions(captions, [], [ownEdge, foreignEdge]).get("own")!;
    expect(moved.y).toBe(0);
    expect(Math.abs(moved.x)).toBeGreaterThanOrEqual(45);
    expect(Math.abs(moved.x)).toBeLessThanOrEqual(100);
  });

  it("keeps fixed loop anchors and gives constrained captions priority", () => {
    const result = placeEdgeCaptions([
      caption("movable"), caption("fixed", { maxShift: 0 }),
    ], []);

    expect(result.get("fixed")).toEqual({ x: 0, y: 0, angle: 0 });
    expect(Math.abs(result.get("movable")!.x)).toBeGreaterThanOrEqual(80);
  });

  it("is stable across permutations and repeated placement, including edge and node obstacles", () => {
    const captions = [caption("a"), caption("b", { angle: 65 }), caption("c", { x: 130 })];
    const nodes = [nodeAtCircle(-90, 0), nodeAtCircle(220, 40)];
    const edges = [
      { id: "other-1", x1: 90, y1: -100, x2: 90, y2: 100 },
      { id: "other-2", x1: -300, y1: 45, x2: 300, y2: 45 },
    ];
    const first = placeEdgeCaptions(captions, nodes, edges);
    const reversed = placeEdgeCaptions(captions.slice().reverse(), nodes.slice().reverse(), edges.slice().reverse());

    expect(reversed).toEqual(first);
    expect(placeEdgeCaptions(captions, nodes, edges)).toEqual(first);
  });

  it("stays finite and within the allowed edge span when no collision-free slot exists", () => {
    const result = placeEdgeCaptions([
      caption("short", { maxShift: 6 }),
      caption("empty", { width: 0, height: 0, maxShift: 0 }),
    ], [nodeAtCircle(0, 0)]);

    for (const anchor of result.values()) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
    }
    expect(Math.abs(result.get("short")!.x)).toBeLessThanOrEqual(6);
    expect(result.get("empty")).toEqual({ x: 0, y: 0, angle: 0 });
  });
});
