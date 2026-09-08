import type { PgmEdge } from "./pgm";

export interface PgmEdgeGroup {
  id: string;
  source: string;
  target: string;
  relationships: PgmEdge[];
  types: string[];
  forward: boolean;
  reverse: boolean;
}

/**
 * Bundle all occurrences between an unordered pair into one visual edge.
 *
 * Pair IDs use a JSON tuple so punctuation in concept IDs cannot collide.
 * Groups and occurrences are sorted deterministically by their stable IDs.
 * Each original occurrence, including exact duplicates, stays in relationships
 * with all of its properties and authored values intact. Only display types
 * are trimmed and deduplicated. No input object or array is changed.
 */
export function groupEdges(edges: readonly PgmEdge[]): PgmEdgeGroup[] {
  const pairs = new Map<string, { low: string; high: string; relationships: PgmEdge[] }>();
  for (const edge of edges) {
    const low = edge.source < edge.target ? edge.source : edge.target;
    const high = edge.source < edge.target ? edge.target : edge.source;
    const id = JSON.stringify([low, high]);
    const pair = pairs.get(id);
    if (pair) pair.relationships.push(edge);
    else pairs.set(id, { low, high, relationships: [edge] });
  }

  return [...pairs].sort(([left], [right]) => compareText(left, right)).map(([id, pair]) => {
    const relationships = pair.relationships.sort((left, right) =>
      compareText(left.id, right.id)
      || compareText(left.source, right.source)
      || compareText(left.target, right.target),
    );
    // Missing targets cannot serve as the rendered source. For valid parsed
    // graphs all unresolved occurrences in a pair share this existing end.
    const unresolved = relationships.find((edge) => !edge.resolved);
    const source = unresolved?.source ?? pair.low;
    const target = source === pair.low ? pair.high : pair.low;
    const self = source === target;
    const types = [...new Set(relationships.map((edge) => edge.type?.trim() || "untyped"))]
      .sort(compareText);
    return {
      id,
      source,
      target,
      relationships,
      types,
      forward: self || relationships.some((edge) => edge.source === source && edge.target === target),
      reverse: !self && relationships.some((edge) => edge.source === target && edge.target === source),
    };
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
