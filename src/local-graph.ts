import type { PgmEdge, PgmGraph, PgmNode } from "./pgm";

/**
 * Disclosure state for the localized graph.
 *
 * Expanded nodes expose their incident one-hop relationships once they are
 * reachable from the focus. The focus starts expanded, but can itself be
 * contracted to a single node. Keeping disclosure separate from selection
 * makes double-click expansion and Ctrl-click refocusing deterministic.
 */
export interface LocalGraphState {
  readonly focusNodeId: string | null;
  readonly expandedNodeIds: ReadonlySet<string>;
}

export interface LocalGraphProjection {
  readonly nodes: PgmNode[];
  readonly edges: PgmEdge[];
  /** Focus plus reachable expanded nodes whose one-hop edges were exposed. */
  readonly activeOriginNodeIds: ReadonlySet<string>;
}

type GraphInput = Pick<PgmGraph, "nodes" | "edges">;

export function createLocalGraphState(focusNodeId: string | null): LocalGraphState {
  return {
    focusNodeId,
    expandedNodeIds: new Set(focusNodeId === null ? [] : [focusNodeId]),
  };
}

/** Refocusing deliberately starts a fresh, one-hop disclosure around the node. */
export function refocusLocalGraph(
  _state: LocalGraphState,
  focusNodeId: string | null,
): LocalGraphState {
  return createLocalGraphState(focusNodeId);
}

export function expandLocalNode(
  state: LocalGraphState,
  nodeId: string,
): LocalGraphState {
  return setLocalNodeExpanded(state, nodeId, true);
}

export function collapseLocalNode(
  state: LocalGraphState,
  nodeId: string,
): LocalGraphState {
  return setLocalNodeExpanded(state, nodeId, false);
}

export function toggleLocalNodeExpansion(
  state: LocalGraphState,
  nodeId: string,
): LocalGraphState {
  return setLocalNodeExpanded(state, nodeId, !state.expandedNodeIds.has(nodeId));
}

export function setLocalNodeExpanded(
  state: LocalGraphState,
  nodeId: string,
  expanded: boolean,
): LocalGraphState {
  const isExpanded = state.expandedNodeIds.has(nodeId);
  if (isExpanded === expanded) return state;

  const expandedNodeIds = new Set(state.expandedNodeIds);
  if (expanded) expandedNodeIds.add(nodeId);
  else expandedNodeIds.delete(nodeId);
  return { ...state, expandedNodeIds };
}

/**
 * Builds the localized, direction-preserving graph without mutating its input.
 *
 * Only the focus and expanded nodes reachable through already exposed hops are
 * origins. This prevents stale expansion state from creating disconnected
 * islands. Resolved edges require both endpoint Nodes to be visible. An
 * unresolved outgoing edge remains visible when its Source is an active
 * origin, even though no Target Node can be materialized.
 */
export function projectLocalGraph(
  graph: GraphInput,
  state: LocalGraphState,
): LocalGraphProjection {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const focusNodeId = state.focusNodeId;
  if (focusNodeId === null || !nodeById.has(focusNodeId)) {
    return {
      nodes: [],
      edges: [],
      activeOriginNodeIds: new Set<string>(),
    };
  }

  const incidentEdges = buildIncidentEdgeIndex(graph.edges, nodeById);
  const visibleNodeIds = new Set<string>();
  const activeOriginNodeIds = new Set<string>();
  const pendingOrigins: string[] = [];

  const activateOrigin = (nodeId: string): void => {
    if (activeOriginNodeIds.has(nodeId)) return;
    activeOriginNodeIds.add(nodeId);
    pendingOrigins.push(nodeId);
  };
  const exposeNode = (nodeId: string): void => {
    if (!nodeById.has(nodeId)) return;
    visibleNodeIds.add(nodeId);
    if (state.expandedNodeIds.has(nodeId)) activateOrigin(nodeId);
  };

  exposeNode(focusNodeId);

  for (let index = 0; index < pendingOrigins.length; index += 1) {
    const originNodeId = pendingOrigins[index];
    if (originNodeId === undefined) continue;

    for (const edge of incidentEdges.get(originNodeId) ?? []) {
      exposeNode(edge.source);
      exposeNode(edge.target);
    }
  }

  const edges = graph.edges.filter((edge) => {
    if (
      !activeOriginNodeIds.has(edge.source)
      && !activeOriginNodeIds.has(edge.target)
    ) {
      return false;
    }

    if (!visibleNodeIds.has(edge.source)) return false;
    if (nodeById.has(edge.target)) return visibleNodeIds.has(edge.target);
    return edge.resolved === false && activeOriginNodeIds.has(edge.source);
  });

  return {
    nodes: graph.nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges,
    activeOriginNodeIds,
  };
}

function buildIncidentEdgeIndex(
  edges: readonly PgmEdge[],
  nodeById: ReadonlyMap<string, PgmNode>,
): Map<string, PgmEdge[]> {
  const incidentEdges = new Map<string, PgmEdge[]>();
  const add = (nodeId: string, edge: PgmEdge): void => {
    const indexed = incidentEdges.get(nodeId);
    if (indexed) indexed.push(edge);
    else incidentEdges.set(nodeId, [edge]);
  };

  for (const edge of edges) {
    // A parsed PGM Relationship always has a materialized Source Node. Ignore
    // malformed external inputs that cannot be rendered from a Source.
    if (!nodeById.has(edge.source)) continue;
    add(edge.source, edge);
    if (edge.target !== edge.source && nodeById.has(edge.target)) {
      add(edge.target, edge);
    }
  }
  return incidentEdges;
}
