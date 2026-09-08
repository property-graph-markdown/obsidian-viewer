import { nodeLabel } from "./node-presentation";
import type { PgmEdge, PgmGraph } from "./pgm";

/** List every incident occurrence, including relationships outside the local view. */
export function renderNodeRelationships(
  graph: PgmGraph,
  nodeId: string,
  onSelect: (edge: PgmEdge) => void,
  ownerDocument: Document = document,
): HTMLElement {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const endpointLabel = (id: string): string => {
    const node = nodes.get(id);
    return node ? nodeLabel(node) : id;
  };
  const relationships = graph.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => ({
      edge,
      type: edge.type?.trim() || "untyped",
      direction: edge.source === nodeId ? 0 : 1,
      otherLabel: endpointLabel(edge.source === nodeId ? edge.target : edge.source),
    }))
    .sort((left, right) => left.direction - right.direction
      || compareText(left.type.toLowerCase(), right.type.toLowerCase())
      || compareText(left.otherLabel.toLowerCase(), right.otherLabel.toLowerCase())
      || compareText(left.edge.id, right.edge.id));

  const section = ownerDocument.createElement("section");
  section.className = "pgm-node-relationships";
  section.setAttribute("aria-label", "Connected relationships");
  const heading = ownerDocument.createElement("h4");
  heading.className = "pgm-node-relationship-heading";
  heading.textContent = `Relationships (${relationships.length})`;
  section.append(heading);

  if (relationships.length === 0) {
    const empty = ownerDocument.createElement("p");
    empty.className = "pgm-node-relationship-empty";
    empty.textContent = "No relationships";
    section.append(empty);
    return section;
  }

  const list = ownerDocument.createElement("div");
  list.className = "pgm-node-relationship-list";
  for (const { edge, type } of relationships) {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "pgm-node-relationship";
    button.dataset.relationshipId = edge.id;
    button.title = `${edge.source} → ${edge.target}`;
    const label = ownerDocument.createElement("span");
    label.className = "pgm-node-relationship-type";
    label.textContent = type;
    const endpoints = ownerDocument.createElement("span");
    endpoints.className = "pgm-node-relationship-path";
    endpoints.textContent = `${endpointLabel(edge.source)} → ${endpointLabel(edge.target)}`;
    button.append(label, endpoints);
    if (!edge.resolved) {
      const missing = ownerDocument.createElement("span");
      missing.className = "pgm-node-relationship-unresolved";
      missing.textContent = "Target note is not present.";
      button.append(missing);
    }
    button.addEventListener("click", () => onSelect(edge));
    list.append(button);
  }
  section.append(list);
  return section;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
