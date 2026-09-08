import type { PgmEdge, PgmNode } from "./pgm";
import { NODE_MIN_HEIGHT, NODE_WIDTH, nodeLabel, nodePresentation } from "./node-presentation";
import { spreadFocusEdges } from "./angular-layout";

/** Default dimensions; individual nodes carry their measured label dimensions. */
export const LOCAL_GRAPH_NODE_WIDTH = NODE_WIDTH;
export const LOCAL_GRAPH_NODE_HEIGHT = NODE_MIN_HEIGHT;
export const LOCAL_GRAPH_NODE_GAP = 18;
export const LOCAL_GRAPH_PADDING = 56;

/** A useful viewport even for an empty or single-node graph. */
export const LOCAL_GRAPH_MIN_WIDTH = 620;
export const LOCAL_GRAPH_MIN_HEIGHT = 420;

export interface PositionedPgmNode extends PgmNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LocalGraphLayout {
  readonly nodes: PositionedPgmNode[];
  readonly width: number;
  readonly height: number;
}

interface SimulationNode {
  readonly node: PgmNode;
  readonly width: number;
  readonly height: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  readonly fixed: boolean;
  anchor?: { x: number; y: number };
}

interface LayoutEdge {
  readonly sourceIndex: number;
  readonly targetIndex: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RADIAL_SCALE = 156;
const IDEAL_EDGE_GAP = 88;
const REPULSION_STRENGTH = 25_000;
const SPRING_STRENGTH = 0.022;
const CENTERING_STRENGTH = 0.0025;
const VELOCITY_DECAY = 0.76;
const MAX_STEP = 12;
const ITERATIONS = 220;
const COLLISION_EPSILON = 0.001;
const TYPE_ANCHOR_STRENGTH = 0.16;
const CLUSTER_ASPECT = 1.35;

/**
 * Lay out a visible local graph without mutating it.
 *
 * The algorithm intentionally has no tree, level, ownership, or traversal
 * semantics. Different types occupy adjacent sectors around the focus, with
 * larger groups arranged on several arcs. Soft position anchors retain those
 * groups while repulsion and edge springs relax the layout. A single type
 * uses the ordinary radial seed. The visible focus stays pinned at the centre.
 *
 * Node IDs are expected to be unique, as they are in a parsed PGM graph. If
 * the requested focus is not present, the first node by ID is used as a stable
 * centre so callers still receive a useful layout.
 */
export function layoutLocalGraph(
  nodes: readonly PgmNode[],
  edges: readonly PgmEdge[],
  focusNodeId: string | null,
): LocalGraphLayout {
  const sortedNodes = nodes.slice().sort((left, right) => compareText(left.id, right.id));
  if (sortedNodes.length === 0) {
    return {
      nodes: [],
      width: LOCAL_GRAPH_MIN_WIDTH,
      height: LOCAL_GRAPH_MIN_HEIGHT,
    };
  }

  const visibleFocusId = sortedNodes.some(({ id }) => id === focusNodeId)
    ? focusNodeId
    : sortedNodes[0]?.id;
  const phase = hashToUnitInterval(visibleFocusId ?? "") * Math.PI * 2;
  let radialIndex = 0;
  const simulationNodes: SimulationNode[] = sortedNodes.map((node) => {
    const { width, height } = nodePresentation(node);
    const fixed = node.id === visibleFocusId;
    if (fixed) {
      return { node, width, height, x: 0, y: 0, velocityX: 0, velocityY: 0, fixed: true };
    }

    const radius = RADIAL_SCALE * Math.sqrt(radialIndex + 1);
    const angle = phase + radialIndex * GOLDEN_ANGLE + hashJitter(node.id);
    radialIndex += 1;
    return {
      node,
      width,
      height,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      velocityX: 0,
      velocityY: 0,
      fixed: false,
    };
  });

  arrangeTypeSectors(simulationNodes);
  const layoutEdges = indexLayoutEdges(simulationNodes, edges);
  settle(simulationNodes, layoutEdges);
  const collisionFree = resolveNodeOverlaps(
    simulationNodes.map(({ node, width, height, x, y }) => ({ ...node, width, height, x, y })),
    visibleFocusId ?? undefined,
  );
  const positionedNodes = spreadFocusEdges(collisionFree, edges, visibleFocusId ?? null, LOCAL_GRAPH_NODE_GAP);

  let horizontalExtent = 0;
  let verticalExtent = 0;
  for (const { x, y, width, height } of positionedNodes) {
    horizontalExtent = Math.max(horizontalExtent, Math.abs(x) + width / 2);
    verticalExtent = Math.max(verticalExtent, Math.abs(y) + height / 2);
  }
  const width = evenCeiling(Math.max(
    LOCAL_GRAPH_MIN_WIDTH,
    2 * (horizontalExtent + LOCAL_GRAPH_PADDING),
  ));
  const height = evenCeiling(Math.max(
    LOCAL_GRAPH_MIN_HEIGHT,
    2 * (verticalExtent + LOCAL_GRAPH_PADDING),
  ));
  const centerX = width / 2;
  const centerY = height / 2;

  return {
    nodes: positionedNodes.map((node) => ({
      ...node,
      x: centerX + node.x,
      y: centerY + node.y,
    })),
    width,
    height,
  };
}

/** Grouping is visual only: every concept remains an individual graph node. */
function arrangeTypeSectors(nodes: SimulationNode[]): void {
  const groups = new Map<string, SimulationNode[]>();
  const focus = nodes.find((node) => node.fixed);
  for (const node of nodes) {
    if (node.fixed) continue;
    const group = groups.get(node.node.type) ?? [];
    group.push(node);
    groups.set(node.node.type, group);
  }
  if (groups.size < 2 || !focus) return;

  // Sublinear area weighting leaves small types enough angular room; larger
  // types use extra arcs. Balance the two largest groups across the focus.
  const weight = (group: SimulationNode[]) => Math.pow(group.reduce((sum, node) =>
    sum + (node.width + LOCAL_GRAPH_NODE_GAP) * (node.height + LOCAL_GRAPH_NODE_GAP), 0), 0.7);
  const ranked = [...groups].sort(([leftType, left], [rightType, right]) =>
    weight(right) - weight(left) || compareText(leftType, rightType));
  const sides: [typeof ranked, typeof ranked] = [[], []];
  const sideWeight = [0, 0];
  for (const group of ranked.slice(2)) {
    const side = sideWeight[0]! <= sideWeight[1]! ? 0 : 1;
    sides[side].push(group);
    sideWeight[side] = sideWeight[side]! + weight(group[1]);
  }
  const types = [ranked[0]!, ...sides[0], ranked[1]!, ...sides[1]];
  const totalWeight = types.reduce((sum, [, group]) => sum + weight(group), 0);
  const gutter = Math.min(0.12, Math.PI / (types.length * 4));
  const minimumSpan = Math.min(0.28, Math.PI / types.length);
  const available = Math.PI * 2 - types.length * (gutter + minimumSpan);
  const placed = [focus];
  let start = -(minimumSpan + available * weight(types[0]![1]) / totalWeight) / 2;

  for (const [, group] of types) {
    group.sort((left, right) => chronologicalKey(left.node) - chronologicalKey(right.node)
      || compareText(nodeLabel(left.node), nodeLabel(right.node))
      || compareText(left.node.id, right.node.id));
    const span = minimumSpan + available * weight(group) / totalWeight;
    const largest = Math.max(...group.map((node) => Math.max(node.width, node.height)));
    const radialStep = largest + LOCAL_GRAPH_NODE_GAP + 24;
    let radius = Math.max(300, (Math.max(focus.width, focus.height) + largest) / 2 + 90);
    let offset = 0;
    let ring = 0;

    while (offset < group.length) {
      let count = Math.min(group.length - offset,
        Math.max(1, Math.ceil(span * radius * CLUSTER_ASPECT / (largest + LOCAL_GRAPH_NODE_GAP))));
      let row: SimulationNode[] = [];
      // Choose the fullest arc that fits complete circle-and-title footprints.
      for (; count > 0; count -= 1) {
        row = group.slice(offset, offset + count).map((node, index) => {
          const stagger = ring === 0 ? 0 : ring % 2 === 1 ? 0.24 : -0.24;
          const angle = start + span * (index + 0.5 + stagger) / count;
          return { ...node, x: Math.cos(angle) * radius * CLUSTER_ASPECT, y: Math.sin(angle) * radius };
        });
        if (row.every((node, index) => [...placed, ...row.slice(0, index)]
          .every((other) => !simulationOverlap(node, other)))) break;
      }
      if (count > 0) {
        row.forEach((position, index) => {
          const node = group[offset + index]!;
          node.x = position.x;
          node.y = position.y;
          node.anchor = { x: position.x, y: position.y };
          placed.push(node);
        });
        offset += count;
      }
      radius += radialStep;
      ring += 1;
    }
    start += span + gutter;
  }
}

function simulationOverlap(left: SimulationNode, right: SimulationNode): boolean {
  return Math.abs(left.x - right.x) < (left.width + right.width) / 2 + LOCAL_GRAPH_NODE_GAP + 12
    && Math.abs(left.y - right.y) < (left.height + right.height) / 2 + LOCAL_GRAPH_NODE_GAP + 12;
}

/** Comparable calendar order, without implying proportional temporal distances. */
function chronologicalKey(node: PgmNode): number {
  for (const key of ["date", "year", "from"]) {
    const value = node.properties[key];
    if (typeof value === "number" && Number.isInteger(value) && Number.isFinite(value)) {
      return value * 10000 + 101;
    }
    const text = value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10) : value;
    if (typeof text !== "string") continue;
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2] ?? 1);
    const day = Number(match[3] ?? 1);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0)) continue;
    return year * 10000 + month * 100 + day;
  }
  return Infinity;
}

/**
 * Remove rectangle collisions without recentering or mutating the graph.
 *
 * The pinned node and nodes already clear of every other node stay exactly in
 * place. Remaining nodes are placed in ID order, retaining their position when
 * possible. A colliding node takes the nearest free slot along its current
 * horizontal or vertical axis. Merging the occupied intervals gives a finite,
 * collision-free placement even when all nodes begin at the same point; a
 * bounded number of force iterations alone cannot provide that guarantee.
 * Result order matches the caller's order.
 */
export function resolveNodeOverlaps(
  nodes: readonly PositionedPgmNode[],
  pinnedNodeId?: string,
): PositionedPgmNode[] {
  const collidingIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right !== undefined && rectanglesOverlap(left, right)) {
        collidingIds.add(left.id);
        collidingIds.add(right.id);
      }
    }
  }

  const ordered = nodes.slice().sort((left, right) =>
    Number(right.id === pinnedNodeId) - Number(left.id === pinnedNodeId)
    || Number(collidingIds.has(left.id)) - Number(collidingIds.has(right.id))
    || compareText(left.id, right.id),
  );
  const placed: PositionedPgmNode[] = [];
  const resultById = new Map<string, PositionedPgmNode>();

  for (const node of ordered) {
    let next = { ...node };
    if (node.id !== pinnedNodeId && placed.some((other) => rectanglesOverlap(node, other))) {
      const horizontal = freeAxisPositions(node, placed, "x");
      const vertical = freeAxisPositions(node, placed, "y");
      const candidates = [
        { ...node, x: horizontal[0] },
        { ...node, x: horizontal[1] },
        { ...node, y: vertical[0] },
        { ...node, y: vertical[1] },
      ];
      next = candidates.reduce((best, candidate) =>
        Math.hypot(candidate.x - node.x, candidate.y - node.y)
          < Math.hypot(best.x - node.x, best.y - node.y)
          ? candidate
          : best,
      );
    }
    placed.push(next);
    resultById.set(node.id, next);
  }

  return nodes.map((node) => resultById.get(node.id) ?? { ...node });
}

function rectanglesOverlap(left: PositionedPgmNode, right: PositionedPgmNode): boolean {
  return Math.abs(right.x - left.x) < (left.width + right.width) / 2 + LOCAL_GRAPH_NODE_GAP
    && Math.abs(right.y - left.y) < (left.height + right.height) / 2 + LOCAL_GRAPH_NODE_GAP;
}

function freeAxisPositions(
  node: PositionedPgmNode,
  obstacles: readonly PositionedPgmNode[],
  axis: "x" | "y",
): readonly [number, number] {
  const crossAxis = axis === "x" ? "y" : "x";
  const dimension = axis === "x" ? "width" : "height";
  const crossDimension = axis === "x" ? "height" : "width";
  const intervals = obstacles.flatMap((other): Array<[number, number]> => {
    const crossClearance = (node[crossDimension] + other[crossDimension]) / 2 + LOCAL_GRAPH_NODE_GAP;
    if (Math.abs(node[crossAxis] - other[crossAxis]) >= crossClearance) return [];
    const clearance = (node[dimension] + other[dimension]) / 2
      + LOCAL_GRAPH_NODE_GAP + COLLISION_EPSILON;
    return [[other[axis] - clearance, other[axis] + clearance]];
  }).sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([...interval]);
    }
  }
  const occupied = merged.find(([start, end]) => start < node[axis] && node[axis] < end);
  return occupied ?? [node[axis], node[axis]];
}

function indexLayoutEdges(
  nodes: readonly SimulationNode[],
  edges: readonly PgmEdge[],
): LayoutEdge[] {
  const nodeIndexById = new Map(nodes.map(({ node }, index) => [node.id, index]));
  const uniquePairs = new Set<string>();
  const result: LayoutEdge[] = [];

  const sortedEdges = edges.slice().sort((left, right) =>
    compareText(left.source, right.source)
    || compareText(left.target, right.target)
    || compareText(left.id, right.id),
  );

  for (const edge of sortedEdges) {
    const sourceIndex = nodeIndexById.get(edge.source);
    const targetIndex = nodeIndexById.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      continue;
    }

    const low = edge.source < edge.target ? edge.source : edge.target;
    const high = edge.source < edge.target ? edge.target : edge.source;
    const key = `${low}\u0000${high}`;
    if (uniquePairs.has(key)) continue;
    uniquePairs.add(key);
    result.push({ sourceIndex, targetIndex });
  }

  return result;
}

function settle(nodes: SimulationNode[], edges: readonly LayoutEdge[]): void {
  const forceX = new Array<number>(nodes.length).fill(0);
  const forceY = new Array<number>(nodes.length).fill(0);

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    forceX.fill(0);
    forceY.fill(0);

    applyRepulsion(nodes, forceX, forceY);
    applySprings(nodes, edges, forceX, forceY);

    for (let index = 0; index < nodes.length; index += 1) {
      const current = nodes[index];
      if (current === undefined || current.fixed) continue;

      if (current.anchor) {
        forceX[index] = (forceX[index] ?? 0) + (current.anchor.x - current.x) * TYPE_ANCHOR_STRENGTH;
        forceY[index] = (forceY[index] ?? 0) + (current.anchor.y - current.y) * TYPE_ANCHOR_STRENGTH;
      } else {
        forceX[index] = (forceX[index] ?? 0) - current.x * CENTERING_STRENGTH;
        forceY[index] = (forceY[index] ?? 0) - current.y * CENTERING_STRENGTH;
      }

      current.velocityX = (current.velocityX + (forceX[index] ?? 0)) * VELOCITY_DECAY;
      current.velocityY = (current.velocityY + (forceY[index] ?? 0)) * VELOCITY_DECAY;
      const speed = Math.hypot(current.velocityX, current.velocityY);
      if (speed > MAX_STEP) {
        const scale = MAX_STEP / speed;
        current.velocityX *= scale;
        current.velocityY *= scale;
      }
      current.x += current.velocityX;
      current.y += current.velocityY;
    }

    separateOverlaps(nodes);
  }

  // Eliminate floating-point drift from the focus after all collision passes.
  const fixed = nodes.find((node) => node.fixed);
  if (fixed !== undefined) {
    fixed.x = 0;
    fixed.y = 0;
    fixed.velocityX = 0;
    fixed.velocityY = 0;
  }
}

function applyRepulsion(
  nodes: readonly SimulationNode[],
  forceX: number[],
  forceY: number[],
): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right === undefined) continue;

      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        const direction = deterministicDirection(left.node.id, right.node.id);
        dx = direction.x;
        dy = direction.y;
        distance = 1;
      }

      const magnitude = REPULSION_STRENGTH / (distance * distance);
      const x = dx / distance * magnitude;
      const y = dy / distance * magnitude;
      forceX[leftIndex] = (forceX[leftIndex] ?? 0) - x;
      forceY[leftIndex] = (forceY[leftIndex] ?? 0) - y;
      forceX[rightIndex] = (forceX[rightIndex] ?? 0) + x;
      forceY[rightIndex] = (forceY[rightIndex] ?? 0) + y;
    }
  }
}

function applySprings(
  nodes: readonly SimulationNode[],
  edges: readonly LayoutEdge[],
  forceX: number[],
  forceY: number[],
): void {
  for (const edge of edges) {
    const source = nodes[edge.sourceIndex];
    const target = nodes[edge.targetIndex];
    if (source === undefined || target === undefined) continue;

    let dx = target.x - source.x;
    let dy = target.y - source.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      const direction = deterministicDirection(source.node.id, target.node.id);
      dx = direction.x;
      dy = direction.y;
      distance = 1;
    }

    const unitX = dx / distance;
    const unitY = dy / distance;
    const idealDistance = rectangleRadius(source, unitX, unitY)
      + rectangleRadius(target, unitX, unitY) + IDEAL_EDGE_GAP;
    const magnitude = (distance - idealDistance) * SPRING_STRENGTH;
    const x = dx / distance * magnitude;
    const y = dy / distance * magnitude;
    forceX[edge.sourceIndex] = (forceX[edge.sourceIndex] ?? 0) + x;
    forceY[edge.sourceIndex] = (forceY[edge.sourceIndex] ?? 0) + y;
    forceX[edge.targetIndex] = (forceX[edge.targetIndex] ?? 0) - x;
    forceY[edge.targetIndex] = (forceY[edge.targetIndex] ?? 0) - y;
  }
}

function separateOverlaps(nodes: SimulationNode[]): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right === undefined) continue;

      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const requiredX = (left.width + right.width) / 2 + LOCAL_GRAPH_NODE_GAP;
      const requiredY = (left.height + right.height) / 2 + LOCAL_GRAPH_NODE_GAP;
      const overlapX = requiredX - Math.abs(dx);
      const overlapY = requiredY - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;

      const direction = deterministicDirection(left.node.id, right.node.id);
      if (overlapX < overlapY) {
        moveApart(left, right, Math.sign(dx || direction.x) * (overlapX + COLLISION_EPSILON), 0);
      } else {
        moveApart(left, right, 0, Math.sign(dy || direction.y) * (overlapY + COLLISION_EPSILON));
      }
    }
  }
}

/** Distance from a rectangle's centre to its border along a unit direction. */
function rectangleRadius(
  node: Pick<SimulationNode, "width" | "height">,
  unitX: number,
  unitY: number,
): number {
  return Math.min(
    Math.abs(unitX) < 0.000001 ? Infinity : node.width / 2 / Math.abs(unitX),
    Math.abs(unitY) < 0.000001 ? Infinity : node.height / 2 / Math.abs(unitY),
  );
}

function moveApart(
  left: SimulationNode,
  right: SimulationNode,
  deltaX: number,
  deltaY: number,
): void {
  if (left.fixed && right.fixed) return;
  if (left.fixed) {
    right.x += deltaX;
    right.y += deltaY;
    right.velocityX = 0;
    right.velocityY = 0;
    return;
  }
  if (right.fixed) {
    left.x -= deltaX;
    left.y -= deltaY;
    left.velocityX = 0;
    left.velocityY = 0;
    return;
  }

  left.x -= deltaX / 2;
  left.y -= deltaY / 2;
  right.x += deltaX / 2;
  right.y += deltaY / 2;
  left.velocityX = 0;
  left.velocityY = 0;
  right.velocityX = 0;
  right.velocityY = 0;
}

function deterministicDirection(left: string, right: string): { x: number; y: number } {
  const angle = hashToUnitInterval(`${left}\u0000${right}`) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function hashJitter(value: string): number {
  return (hashToUnitInterval(value) - 0.5) * 0.18;
}

function hashToUnitInterval(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function evenCeiling(value: number): number {
  return Math.ceil(value / 2) * 2;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
