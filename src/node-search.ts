import type { PgmEdge, PgmNode } from "./pgm";
import { nodeTitle } from "./node-presentation";

/** Keep the graph focus and nodes matching every keyword in their displayed title. */
export function graphMatches(
  nodes: readonly PgmNode[],
  edges: readonly PgmEdge[],
  rawQuery: string,
  focusNodeId: string | null = null,
): { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } {
  const keywords = searchText(rawQuery).trim().split(/\s+/u).filter(Boolean);
  if (keywords.length === 0) {
    return {
      nodeIds: new Set(nodes.map((node) => node.id)),
      edgeIds: new Set(edges.map((edge) => edge.id)),
    };
  }

  const nodeIds = new Set(nodes.filter((node) => {
    if (node.id === focusNodeId) return true;
    const title = searchText(nodeTitle(node));
    return keywords.every((keyword) => title.includes(keyword));
  }).map((node) => node.id));
  const edgeIds = new Set(edges.filter((edge) =>
    nodeIds.has(edge.source) && nodeIds.has(edge.target),
  ).map((edge) => edge.id));
  return { nodeIds, edgeIds };
}

function searchText(value: string): string {
  return value.normalize("NFC").toLowerCase();
}
