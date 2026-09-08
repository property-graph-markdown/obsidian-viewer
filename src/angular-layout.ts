import type { PositionedPgmNode } from "./local-graph-layout";
import { NODE_LABEL_TOP, NODE_RADIUS } from "./node-presentation";
import type { PgmEdge } from "./pgm";

const TAU = Math.PI * 2;
const MIN_ANGLE = Math.PI / 45;

/**
 * Refine an already collision-free layout without changing its angular order.
 * Every focus neighbour gets a distinct spoke, including neighbours on other
 * rings. Work from visible circle centres, not the circle/title box centres.
 */
export function spreadFocusEdges(
  nodes: readonly PositionedPgmNode[],
  edges: readonly PgmEdge[],
  focusId: string | null,
  gap: number,
): PositionedPgmNode[] {
  const focus = nodes.find((node) => node.id === focusId);
  if (!focus) return nodes.slice();
  const neighbourIds = new Set(edges.flatMap((edge) => edge.source === focusId ? [edge.target]
    : edge.target === focusId ? [edge.source] : []));
  neighbourIds.delete(focus.id);
  const origin = { x: focus.x, y: circleY(focus) };
  const neighbours = nodes.filter((node) => neighbourIds.has(node.id)).map((node) => ({
    node,
    radius: Math.hypot(node.x - origin.x, circleY(node) - origin.y),
    angle: Math.atan2(circleY(node) - origin.y, node.x - origin.x),
  })).sort((left, right) => left.angle - right.angle || compareIds(left.node.id, right.node.id));
  if (neighbours.length < 3) return nodes.slice();

  let cut = 0;
  let largestGap = -1;
  for (let index = 0; index < neighbours.length; index += 1) {
    const next = (index + 1) % neighbours.length;
    const distance = neighbours[next]!.angle - neighbours[index]!.angle + (next === 0 ? TAU : 0);
    if (distance > largestGap) { largestGap = distance; cut = next; }
  }
  const ordered = [...neighbours.slice(cut), ...neighbours.slice(0, cut)];
  const baseGaps = ordered.map((current, index) => {
    const next = ordered[(index + 1) % ordered.length]!;
    // Nearby circles cast a wider angular shadow than distant circles.
    const shadow = Math.asin(Math.min(0.5, (NODE_RADIUS + 8) / Math.max(1, Math.min(current.radius, next.radius))));
    return Math.max(MIN_ANGLE, shadow);
  });
  const titleExtras = ordered.map((current, index) => {
    const next = ordered[(index + 1) % ordered.length]!;
    const nearer = current.radius < next.radius ? current : next;
    const titleShadow = titleAngularReach(nearer.node, origin, nearer.angle, nearer === current ? 1 : -1);
    return Math.max(0, Math.min(Math.PI / 12, titleShadow) - baseGaps[index]!);
  });
  // Spend spare angular room on titles without sacrificing circle clearance
  // or letting long titles consume all the space between the type groups.
  const baseTotal = baseGaps.reduce((sum, value) => sum + value, 0);
  const extraTotal = titleExtras.reduce((sum, value) => sum + value, 0);
  const extraScale = extraTotal > 0 ? Math.min(1, Math.max(0, TAU * 0.8 - baseTotal) / extraTotal) : 0;
  const gaps = baseGaps.map((value, index) => value + titleExtras[index]! * extraScale);
  const total = gaps.reduce((sum, value) => sum + value, 0);
  const factor = Math.min(1, TAU * 0.85 / total);
  const offsets: number[] = [0];
  for (let index = 1; index < ordered.length; index += 1) {
    offsets.push(offsets[index - 1]! + gaps[index - 1]! * factor);
  }
  const angles = ordered.map((current) => current.angle < ordered[0]!.angle ? current.angle + TAU : current.angle);
  const adjusted = isotonicAngles(angles.map((angle, index) => angle - offsets[index]!), TAU - total * factor);
  const candidates = ordered.map((current, index) => ({ ...current, angle: adjusted[index]! + offsets[index]! }))
    .sort((left, right) => left.radius - right.radius || compareIds(left.node.id, right.node.id));

  const placed = nodes.filter((node) => !neighbourIds.has(node.id));
  const result = new Map(placed.map((node) => [node.id, node]));
  for (const { node, angle, radius } of candidates) {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const base = { x: origin.x, y: origin.y + node.height / 2 - NODE_RADIUS };
    const intervals: Array<[number, number]> = [];
    for (const other of placed) {
      const x = occupiedInterval(base.x, direction.x, other.x, (node.width + other.width) / 2 + gap + 0.01);
      const y = occupiedInterval(base.y, direction.y, other.y, (node.height + other.height) / 2 + gap + 0.01);
      if (!x || !y) continue;
      const start = Math.max(x[0], y[0]);
      const end = Math.min(x[1], y[1]);
      if (start < end) intervals.push([start, end]);
    }
    intervals.sort((left, right) => left[0] - right[0]);
    let distance = radius;
    for (const [start, end] of intervals) {
      if (start < distance && distance < end) distance = end;
    }
    // Resolve any new title collision radially, retaining the spoke angle.
    const next = { ...node, x: base.x + direction.x * distance, y: base.y + direction.y * distance };
    placed.push(next);
    result.set(node.id, next);
  }
  return nodes.map((node) => result.get(node.id) ?? node);
}

function titleAngularReach(
  node: PositionedPgmNode,
  origin: { x: number; y: number },
  angle: number,
  side: number,
): number {
  const left = node.x - node.width / 2 - 4;
  const right = node.x + node.width / 2 + 4;
  const top = node.y - node.height / 2 + NODE_LABEL_TOP - 4;
  const bottom = node.y + node.height / 2 + 4;
  let reach = 0;
  for (const [x, y] of [[left, top], [left, bottom], [right, top], [right, bottom]]) {
    const difference = Math.atan2(y! - origin.y, x! - origin.x) - angle;
    const relative = Math.atan2(Math.sin(difference), Math.cos(difference));
    reach = Math.max(reach, relative * side);
  }
  return reach;
}

/** Least-squares monotone projection, with enough room left for the wrap gap. */
function isotonicAngles(values: readonly number[], maxRange: number): number[] {
  const blocks: Array<{ start: number; end: number; sum: number; count: number }> = [];
  values.forEach((value, index) => {
    blocks.push({ start: index, end: index, sum: value, count: 1 });
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!;
      const left = blocks[blocks.length - 2]!;
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.splice(-2, 2, { start: left.start, end: right.end, sum: left.sum + right.sum, count: left.count + right.count });
    }
  });
  const means = blocks.flatMap((block) => Array<number>(block.count).fill(block.sum / block.count));
  if (means[means.length - 1]! - means[0]! <= maxRange) return means;
  let lower = means[0]! - maxRange;
  let upper = means[means.length - 1]!;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const start = (lower + upper) / 2;
    const derivative = means.reduce((sum, value) => sum + Math.max(start, Math.min(start + maxRange, value)) - value, 0);
    if (derivative > 0) upper = start;
    else lower = start;
  }
  const start = (lower + upper) / 2;
  return means.map((value) => Math.max(start, Math.min(start + maxRange, value)));
}

function occupiedInterval(base: number, velocity: number, centre: number, clearance: number): [number, number] | null {
  if (Math.abs(velocity) < 1e-9) return Math.abs(base - centre) < clearance ? [-Infinity, Infinity] : null;
  const first = (centre - clearance - base) / velocity;
  const second = (centre + clearance - base) / velocity;
  return [Math.min(first, second), Math.max(first, second)];
}

function circleY(node: PositionedPgmNode): number { return node.y - node.height / 2 + NODE_RADIUS; }
function compareIds(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
