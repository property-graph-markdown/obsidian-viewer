import type { PositionedPgmNode } from "./local-graph-layout";
import { NODE_RADIUS } from "./node-presentation";

export type GraphSelectionItem = { kind: "node"; id: string } | { kind: "edge"; id: string };

export function selectionKey(item: GraphSelectionItem): string {
  return `${item.kind}:${item.id}`;
}

/** Shift-click toggles one item without changing the order of other items. */
export function toggleSelection(
  items: readonly GraphSelectionItem[],
  item: GraphSelectionItem,
): GraphSelectionItem[] {
  const key = selectionKey(item);
  const selected = items.some((existing) => selectionKey(existing) === key);
  return selected
    ? mergeSelection([], items.filter((existing) => selectionKey(existing) !== key))
    : mergeSelection(items, [item]);
}

/** Additive marquee selection keeps the existing selection and its order. */
export function mergeSelection(
  items: readonly GraphSelectionItem[],
  added: readonly GraphSelectionItem[],
): GraphSelectionItem[] {
  const merged = new Map<string, GraphSelectionItem>();
  for (const item of [...items, ...added]) {
    const key = selectionKey(item);
    if (!merged.has(key)) merged.set(key, item);
  }
  return Array.from(merged.values());
}

/** Test the circle centre, so long labels do not change marquee selection. */
export function nodeIdsInMarquee(
  nodes: Iterable<PositionedPgmNode>,
  rect: { x1: number; y1: number; x2: number; y2: number },
): string[] {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  const ids: string[] = [];
  for (const node of nodes) {
    // Layout x/y mark the full node bounds' centre; the circle sits above its label.
    const circleY = node.y - node.height / 2 + NODE_RADIUS;
    if (node.x >= left && node.x <= right && circleY >= top && circleY <= bottom) {
      ids.push(node.id);
    }
  }
  return ids;
}
