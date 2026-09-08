import { type EditorView, WidgetType } from "@codemirror/view";

import type { PgmProperties } from "./pgm";
import { formatRelationshipTooltip } from "./relationship-tooltip";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Shared by Reading View and Live Preview so both badges expose the same tooltip. */
export function appendRelationshipBadge(
  container: HTMLElement,
  relationshipType: string,
  tooltip: string,
): void {
  const rootDocument = container.ownerDocument;
  container.appendChild(rootDocument.createTextNode(" "));

  const badge = rootDocument.createElement("span");
  badge.className = "pgm-relationship-badge";
  badge.setAttribute("title", tooltip);
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", tooltip);
  appendArrowIcon(badge);

  const type = rootDocument.createElement("span");
  type.className = "pgm-relationship-type";
  type.textContent = `:${relationshipType}`;
  container.append(badge, type);
}

function appendArrowIcon(container: HTMLElement): void {
  const rootDocument = container.ownerDocument;
  const svg = rootDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const shaft = rootDocument.createElementNS(SVG_NS, "path");
  shaft.setAttribute("d", "M5 12h14");
  const head = rootDocument.createElementNS(SVG_NS, "path");
  head.setAttribute("d", "m13 6 6 6-6 6");
  svg.append(shaft, head);
  container.appendChild(svg);
}

export class PgmRelationshipBadgeWidget extends WidgetType {
  private readonly tooltip: string;

  constructor(
    private readonly destination: string,
    private readonly readerLabel: string,
    private readonly relationshipType: string,
    relationshipProperties: PgmProperties = { type: relationshipType },
  ) {
    super();
    this.tooltip = formatRelationshipTooltip(relationshipProperties);
  }

  override eq(other: PgmRelationshipBadgeWidget): boolean {
    return (
      this.destination === other.destination &&
      this.readerLabel === other.readerLabel &&
      this.relationshipType === other.relationshipType &&
      this.tooltip === other.tooltip
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const rootDocument = view.dom.ownerDocument;
    const link = rootDocument.createElement("a");
    link.className =
      "internal-link pgm-relationship-link pgm-editor-relationship-link";
    link.dataset.href = this.destination;
    link.dataset.pgmRelationshipBadge = "true";
    link.setAttribute("href", this.destination);
    link.setAttribute("draggable", "false");

    const label = rootDocument.createElement("span");
    label.className = "pgm-relationship-label";
    label.textContent = this.readerLabel;
    link.appendChild(label);
    appendRelationshipBadge(link, this.relationshipType, this.tooltip);
    return link;
  }
}
