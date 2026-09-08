import type { PositionedPgmNode } from "./local-graph-layout";
import { NODE_LABEL_TOP, NODE_RADIUS } from "./node-presentation";

interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
}

export interface EdgeCaptionLayout extends Rectangle {
  readonly id: string;
  /** Maximum translation in either direction along the unchanged baseline. */
  readonly maxShift: number;
}

export interface CaptionEdgeSegment {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface BlockedInterval {
  readonly start: number;
  readonly end: number;
  readonly weight: number;
}

type NodeFootprint = Pick<PositionedPgmNode, "x" | "y" | "width" | "height">;
type CaptionAnchor = Pick<Rectangle, "x" | "y" | "angle">;
const CLEARANCE = 4;
const EPSILON = 0.000001;

/**
 * Slide captions along their existing straight baselines, keeping the nearest
 * free position to the midpoint. Work in graph coordinates so zooming cannot
 * change the result. Constrained captions go first, with stable ID tie breaks.
 */
export function placeEdgeCaptions(
  captions: readonly EdgeCaptionLayout[],
  nodes: readonly NodeFootprint[],
  edges: readonly CaptionEdgeSegment[] = [],
): Map<string, CaptionAnchor> {
  const placed: Rectangle[] = [];
  const result = new Map<string, CaptionAnchor>();
  const ordered = captions.slice().sort((left, right) => left.maxShift - right.maxShift
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  for (const caption of ordered) {
    const intervals: BlockedInterval[] = [];
    if (caption.width > 0 && caption.height > 0) {
      for (const node of nodes) {
        const top = node.y - node.height / 2;
        const circle = circleInterval(caption, node.x, top + NODE_RADIUS, NODE_RADIUS);
        if (circle) intervals.push(circle);
        const title = rectangleInterval(caption, {
          x: node.x, y: top + NODE_LABEL_TOP + (node.height - NODE_LABEL_TOP) / 2,
          width: node.width, height: Math.max(0, node.height - NODE_LABEL_TOP), angle: 0,
        }, 20);
        if (title) intervals.push(title);
      }
      for (const other of placed) {
        const interval = rectangleInterval(caption, other, 20);
        if (interval) intervals.push(interval);
      }
      for (const edge of edges) {
        if (edge.id === caption.id) continue;
        const dx = edge.x2 - edge.x1;
        const dy = edge.y2 - edge.y1;
        const interval = rectangleInterval(caption, {
          x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2,
          width: Math.hypot(dx, dy), height: 2,
          angle: Math.atan2(dy, dx) * 180 / Math.PI,
        }, 1);
        if (interval) intervals.push(interval);
      }
    }

    const offset = nearestOffset(intervals, Math.max(0, caption.maxShift));
    const [direction] = axes(caption.angle);
    const anchor = {
      x: caption.x + direction.x * offset,
      y: caption.y + direction.y * offset,
      angle: caption.angle,
    };
    result.set(caption.id, anchor);
    if (caption.width > 0 && caption.height > 0) placed.push({ ...caption, ...anchor });
  }
  return result;
}

/** Separating-axis constraints give the exact blocked translation interval. */
function rectangleInterval(
  caption: Rectangle,
  obstacle: Rectangle,
  weight: number,
): BlockedInterval | null {
  const captionAxes = axes(caption.angle);
  const obstacleAxes = axes(obstacle.angle);
  let start = -Infinity;
  let end = Infinity;
  for (const axis of [...captionAxes, ...obstacleAxes]) {
    const extent = projectedRadius(caption, captionAxes, axis)
      + projectedRadius(obstacle, obstacleAxes, axis) + CLEARANCE;
    const distance = (obstacle.x - caption.x) * axis.x + (obstacle.y - caption.y) * axis.y;
    const speed = dot(captionAxes[0], axis);
    if (Math.abs(speed) < EPSILON) {
      if (Math.abs(distance) >= extent) return null;
      continue;
    }
    const first = (distance - extent) / speed;
    const last = (distance + extent) / speed;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start >= end) return null;
  }
  return { start: start - EPSILON, end: end + EPSILON, weight };
}

function circleInterval(caption: Rectangle, x: number, y: number, radius: number): BlockedInterval | null {
  const [along, across] = axes(caption.angle);
  const dx = x - caption.x;
  const dy = y - caption.y;
  const acrossDistance = Math.max(0, Math.abs(dx * across.x + dy * across.y) - caption.height / 2);
  const paddedRadius = radius + CLEARANCE;
  if (acrossDistance >= paddedRadius) return null;
  const center = dx * along.x + dy * along.y;
  const reach = caption.width / 2 + Math.sqrt(paddedRadius ** 2 - acrossDistance ** 2);
  return { start: center - reach - EPSILON, end: center + reach + EPSILON, weight: 20 };
}

function nearestOffset(intervals: readonly BlockedInterval[], limit: number): number {
  const ordered = intervals.slice().sort((left, right) => left.start - right.start
    || left.end - right.end || left.weight - right.weight);
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  const candidates = [0, -limit, limit, ...ordered.flatMap(({ start, end }) => [clamp(start), clamp(end)])];
  let best = 0;
  let bestScore = [Infinity, Infinity, Infinity];
  for (const candidate of candidates) {
    let collisions = 0;
    let penetration = 0;
    for (const { start, end, weight } of ordered) {
      if (candidate <= start || candidate >= end) continue;
      collisions += weight;
      penetration += Math.min(candidate - start, end - candidate) * weight;
    }
    // If no free slot exists, prefer fewer collisions, especially with nodes,
    // then less penetration. Never escape the usable part of the connection.
    const score = [collisions, penetration, Math.abs(candidate)];
    const firstDifference = score.findIndex((value, index) => value !== bestScore[index]);
    if (firstDifference >= 0 && score[firstDifference]! < bestScore[firstDifference]!) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

type Axis = { x: number; y: number };

function axes(angle: number): readonly [Axis, Axis] {
  const radians = angle * Math.PI / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  return [{ x, y }, { x: -y, y: x }];
}

function dot(left: Axis, right: Axis): number {
  return left.x * right.x + left.y * right.y;
}

function projectedRadius(rectangle: Rectangle, basis: readonly [Axis, Axis], axis: Axis): number {
  return rectangle.width / 2 * Math.abs(dot(basis[0], axis))
    + rectangle.height / 2 * Math.abs(dot(basis[1], axis));
}
