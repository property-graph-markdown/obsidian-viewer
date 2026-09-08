import type { PositionedPgmNode } from "./local-graph-layout";
import { NODE_RADIUS } from "./node-presentation";
import type { PgmEdge } from "./pgm";

type NodeGeometry = Pick<PositionedPgmNode, "x" | "y" | "width" | "height">;

export interface EdgeGeometry {
  readonly path: string;
  /** Actual curve midpoint and its tangent, kept upright for a text caption. */
  readonly label: { x: number; y: number; angle: number };
}

const PARALLEL_EDGE_SPACING = 56;

/** Assign distinct deterministic routes to parallel, reciprocal and self edges. */
export function assignEdgeBends(edges: readonly PgmEdge[]): Map<string, number> {
  const groups = new Map<string, PgmEdge[]>();
  for (const edge of edges) {
    const low = edge.source < edge.target ? edge.source : edge.target;
    const high = edge.source < edge.target ? edge.target : edge.source;
    const key = `${low}\u0000${high}`;
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }

  const result = new Map<string, number>();
  for (const [, group] of [...groups].sort(([left], [right]) => compareText(left, right))) {
    group.sort((left, right) =>
      compareText(left.source, right.source) || compareText(left.id, right.id),
    );
    const center = (group.length - 1) / 2;
    group.forEach((edge, index) => {
      if (edge.source === edge.target) {
        result.set(edge.id, index * 20);
        return;
      }
      const worldBend = (index - center) * PARALLEL_EDGE_SPACING;
      const direction = edge.source <= edge.target ? 1 : -1;
      result.set(edge.id, worldBend * direction);
    });
  }
  return result;
}

/** Compatibility name for existing viewer callers. */
export const edgeBends = assignEdgeBends;

/** Place an unresolved endpoint relative to its source circle, not its label. */
export function unresolvedTarget(
  source: PositionedPgmNode,
  targetId: string,
  index: number,
): PositionedPgmNode {
  const seed = hashString(`${targetId}:${index}`);
  const angle = (seed % 360) * Math.PI / 180;
  return {
    id: `unresolved:${targetId}`,
    path: "",
    type: "",
    properties: {},
    width: 0,
    height: 0,
    x: source.x + Math.cos(angle) * (NODE_RADIUS + 100),
    y: circleY(source) + Math.sin(angle) * (NODE_RADIUS + 100),
  };
}

/**
 * Draw a line, quadratic route, or cubic self loop between circle borders.
 * Node y is the centre of the combined circle/title box; the visible circle
 * sits at the top of that box. Unresolved targets are already endpoint points.
 */
export function edgeGeometry(
  source: NodeGeometry,
  target: NodeGeometry,
  self: boolean,
  targetIsNode: boolean,
  bend: number,
): EdgeGeometry {
  const sourceY = circleY(source);
  const targetY = targetIsNode ? circleY(target) : target.y;
  if (self) {
    const attachmentY = 12;
    const x = source.x + Math.sqrt(NODE_RADIUS ** 2 - attachmentY ** 2);
    const radius = 68 + Math.abs(bend);
    const startY = sourceY - attachmentY;
    const endY = sourceY + attachmentY;
    const path = `M ${x} ${startY} C ${x + radius} ${sourceY - radius}, ${x + radius} ${sourceY + radius}, ${x} ${endY}`;
    return { path, label: { x: x + radius * 0.75, y: sourceY, angle: 90 } };
  }

  const dx = target.x - source.x;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy);
  // Dragging can momentarily make two circle centres coincide. A fixed
  // direction keeps both endpoints on their circles and all geometry finite.
  const unitX = distance < 0.001 ? 1 : dx / distance;
  const unitY = distance < 0.001 ? 0 : dy / distance;
  let x1 = source.x + unitX * NODE_RADIUS;
  let y1 = sourceY + unitY * NODE_RADIUS;
  let x2 = target.x - (targetIsNode ? unitX * NODE_RADIUS : 0);
  let y2 = targetY - (targetIsNode ? unitY * NODE_RADIUS : 0);
  const length = Math.max(Math.hypot(x2 - x1, y2 - y1), 0.001);
  const normalX = -(y2 - y1) / length;
  const normalY = (x2 - x1) / length;
  let controlX = (x1 + x2) / 2 + normalX * bend;
  let controlY = (y1 + y2) / 2 + normalY * bend;
  if (bend !== 0 && distance >= 0.001) {
    // Build the fan from the circle centres, then project each attachment
    // toward its control point. Parallel routes get distinct ports and their
    // tangents leave/enter each circle radially. Equal-radius endpoints remain
    // symmetric, keeping the caption at the half-length point of the curve.
    controlX = (source.x + target.x) / 2 - unitY * bend;
    controlY = (sourceY + targetY) / 2 + unitX * bend;
    const sourceControlDistance = Math.hypot(controlX - source.x, controlY - sourceY);
    x1 = source.x + (controlX - source.x) / sourceControlDistance * NODE_RADIUS;
    y1 = sourceY + (controlY - sourceY) / sourceControlDistance * NODE_RADIUS;
    if (targetIsNode) {
      const targetControlDistance = Math.hypot(controlX - target.x, controlY - targetY);
      x2 = target.x + (controlX - target.x) / targetControlDistance * NODE_RADIUS;
      y2 = targetY + (controlY - targetY) / targetControlDistance * NODE_RADIUS;
    }
  }
  const path = bend === 0
    ? `M ${x1} ${y1} L ${x2} ${y2}`
    : `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`;
  // At t=0.5 the quadratic tangent is parallel to the endpoint chord.
  let angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return {
    path,
    label: { x: (x1 + 2 * controlX + x2) / 4, y: (y1 + 2 * controlY + y2) / 4, angle },
  };
}

function circleY(node: NodeGeometry): number {
  return node.y - node.height / 2 + NODE_RADIUS;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
