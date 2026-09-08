import {
  ItemView,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

import {
  parsePgmVault,
  type PgmEdge,
  type PgmGraph,
  type PgmNode,
} from "./pgm";

const VIEW_TYPE_PGM = "pgm-viewer";
const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_WIDTH = 168;
const NODE_HEIGHT = 58;
let markerCounter = 0;

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

interface PositionedNode extends PgmNode {
  x: number;
  y: number;
}

export default class PgmViewerPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_PGM, (leaf) => new PgmView(leaf));

    this.addRibbonIcon("git-fork", "Open PGM Viewer", () => {
      void this.openViewer();
    });

    this.addCommand({
      id: "open-pgm-viewer",
      name: "Open graph view",
      callback: () => {
        void this.openViewer();
      },
    });

    const refresh = () => this.refreshOpenViews();
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") refresh();
      }),
    );
  }

  override onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PGM);
  }

  private async openViewer(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PGM)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");

    if (!existing) {
      await leaf.setViewState({ type: VIEW_TYPE_PGM, active: true });
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  private refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PGM)) {
      const view = leaf.view;
      if (view instanceof PgmView) view.scheduleRefresh();
    }
  }
}

class PgmView extends ItemView {
  private readonly markerId = `pgm-arrow-${markerCounter++}`;
  private graph: PgmGraph | null = null;
  private query = "";
  private selection: Selection = null;
  private refreshTimer: number | undefined;
  private refreshGeneration = 0;

  override getViewType(): string {
    return VIEW_TYPE_PGM;
  }

  override getDisplayText(): string {
    return "PGM Viewer";
  }

  override getIcon(): string {
    return "git-fork";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("pgm-viewer");
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    window.clearTimeout(this.refreshTimer);
    this.refreshGeneration += 1;
  }

  scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      void this.refresh();
    }, 250);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.renderLoading();

    try {
      const files = this.app.vault
        .getMarkdownFiles()
        .slice()
        .sort((a, b) => compareText(a.path, b.path));
      const documents = await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          content: await this.app.vault.cachedRead(file),
        })),
      );

      if (generation !== this.refreshGeneration) return;
      this.graph = parsePgmVault(documents);
      this.reconcileSelection();
      this.render();
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      this.renderFatalError(error);
    }
  }

  private reconcileSelection(): void {
    if (!this.graph || !this.selection) return;
    const items = this.selection.kind === "node" ? this.graph.nodes : this.graph.edges;
    if (!items.some((item) => item.id === this.selection?.id)) this.selection = null;
  }

  private renderLoading(): void {
    this.contentEl.replaceChildren();
    const state = element("div", "pgm-state");
    state.append(element("span", "pgm-spinner"), textElement("p", "Reading this vault…"));
    this.contentEl.append(state);
  }

  private renderFatalError(error: unknown): void {
    this.contentEl.replaceChildren();
    const state = element("div", "pgm-state pgm-state-error");
    state.append(
      textElement("h2", "The graph could not be read"),
      textElement("p", error instanceof Error ? error.message : "An unexpected error occurred."),
    );
    const retry = textElement("button", "Try again", "pgm-button");
    retry.type = "button";
    retry.addEventListener("click", () => void this.refresh());
    state.append(retry);
    this.contentEl.append(state);
  }

  private render(): void {
    if (!this.graph) return;
    this.contentEl.replaceChildren();

    const shell = element("div", "pgm-shell");
    const header = element("header", "pgm-header");
    const title = element("div", "pgm-title");
    title.append(textElement("h2", "PGM"), this.renderSummary());

    const controls = element("div", "pgm-controls");
    const search = document.createElement("input");
    search.className = "pgm-search";
    search.type = "search";
    search.placeholder = "Filter concepts or relationships";
    search.ariaLabel = "Filter graph";
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderGraphArea(shell, header);
      search.focus();
      search.setSelectionRange(this.query.length, this.query.length);
    });

    const refresh = textElement("button", "Refresh", "pgm-button pgm-refresh");
    refresh.type = "button";
    refresh.addEventListener("click", () => void this.refresh());
    controls.append(search, refresh);
    header.append(title, controls);
    shell.append(header);
    this.contentEl.append(shell);
    this.renderGraphArea(shell, header);
  }

  private renderSummary(): HTMLElement {
    if (!this.graph) return textElement("p", "", "pgm-summary");
    const nodes = this.graph.nodes.length;
    const edges = this.graph.edges.length;
    const skipped = this.graph.diagnostics.length;
    const suffix = skipped > 0 ? ` · ${skipped} diagnostic${skipped === 1 ? "" : "s"}` : "";
    return textElement(
      "p",
      `${nodes} concept${nodes === 1 ? "" : "s"} · ${edges} relationship${edges === 1 ? "" : "s"}${suffix}`,
      "pgm-summary",
    );
  }

  private renderGraphArea(shell: HTMLElement, header: HTMLElement): void {
    for (const child of Array.from(shell.children)) {
      if (child !== header) child.remove();
    }
    if (!this.graph) return;

    if (this.graph.nodes.length === 0) {
      const hasDiagnostics = this.graph.diagnostics.length > 0;
      const state = element(
        "div",
        `pgm-state ${hasDiagnostics ? "pgm-state-error" : "pgm-state-empty"}`,
      );
      const first = this.graph.diagnostics[0];
      state.append(
        textElement("h2", hasDiagnostics ? "No readable PGM concepts" : "No PGM concepts yet"),
        textElement(
          "p",
          hasDiagnostics
            ? `${this.graph.diagnostics.length} diagnostic${this.graph.diagnostics.length === 1 ? "" : "s"}. ${first?.message ?? "Check the note frontmatter."}`
            : "Add YAML frontmatter with a non-empty string type to a Markdown note.",
        ),
      );
      shell.append(state);
      return;
    }

    const { nodes, edges } = filterGraph(this.graph, this.query);
    if (nodes.length === 0) {
      const state = element("div", "pgm-state pgm-state-empty");
      state.append(
        textElement("h2", "Nothing matches"),
        textElement("p", `No concepts or relationships match “${this.query}”.`),
      );
      shell.append(state);
      return;
    }

    const body = element("div", "pgm-body");
    const canvas = element("div", "pgm-canvas");
    canvas.append(this.renderSvg(nodes, edges));
    body.append(canvas, this.renderDetails());
    shell.append(body);
  }

  private renderSvg(nodes: PgmNode[], edges: PgmEdge[]): SVGSVGElement {
    const positioned = layoutNodes(nodes);
    const byId = new Map(positioned.map((node) => [node.id, node]));
    const columns = Math.max(1, Math.ceil(Math.sqrt(positioned.length * 1.4)));
    const rows = Math.ceil(positioned.length / columns);
    const width = Math.max(620, columns * 220 + 80);
    const height = Math.max(420, rows * 150 + 100);

    const svg = svgElement("svg");
    svg.classList.add("pgm-graph");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svg.style.setProperty("--pgm-graph-width", `${width}px`);
    svg.style.setProperty("--pgm-graph-height", `${height}px`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Property graph with ${nodes.length} concepts and ${edges.length} relationships`);

    const defs = svgElement("defs");
    const marker = svgElement("marker");
    marker.id = this.markerId;
    marker.classList.add("pgm-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrow = svgElement("path");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    marker.append(arrow);
    defs.append(marker);
    svg.append(defs);

    const edgeLayer = svgElement("g");
    edgeLayer.classList.add("pgm-edges");
    const bends = edgeBends(edges);
    edges.forEach((edge, index) => {
      const source = byId.get(edge.source);
      if (!source) return;
      const target = byId.get(edge.target);
      edgeLayer.append(this.renderEdge(edge, source, target, index, bends.get(edge.id) ?? 0));
    });
    svg.append(edgeLayer);

    const nodeLayer = svgElement("g");
    nodeLayer.classList.add("pgm-nodes");
    for (const node of positioned) nodeLayer.append(this.renderNode(node));
    svg.append(nodeLayer);
    return svg;
  }

  private renderNode(node: PositionedNode): SVGGElement {
    const group = svgElement("g");
    group.classList.add("pgm-node");
    if (this.selection?.kind === "node" && this.selection.id === node.id) {
      group.classList.add("is-selected");
    }
    group.setAttribute("transform", `translate(${node.x - NODE_WIDTH / 2} ${node.y - NODE_HEIGHT / 2})`);
    group.setAttribute("role", "link");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${nodeLabel(node)}, ${node.type}`);

    const rect = svgElement("rect");
    rect.setAttribute("width", String(NODE_WIDTH));
    rect.setAttribute("height", String(NODE_HEIGHT));
    rect.setAttribute("rx", "12");
    const label = svgElement("text");
    label.classList.add("pgm-node-label");
    label.setAttribute("x", "14");
    label.setAttribute("y", "25");
    label.textContent = truncate(nodeLabel(node), 23);
    const type = svgElement("text");
    type.classList.add("pgm-node-type");
    type.setAttribute("x", "14");
    type.setAttribute("y", "44");
    type.textContent = truncate(node.type, 28);
    const tooltip = svgElement("title");
    tooltip.textContent = `${nodeLabel(node)} · ${node.type}\n${node.path}`;
    group.append(rect, label, type, tooltip);

    const open = () => {
      this.select({ kind: "node", id: node.id });
      void this.app.workspace.openLinkText(node.path, "", "tab");
    };
    group.addEventListener("click", open);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return group;
  }

  private renderEdge(
    edge: PgmEdge,
    source: PositionedNode,
    target: PositionedNode | undefined,
    edgeIndex: number,
    bend: number,
  ): SVGGElement {
    const group = svgElement("g");
    group.classList.add("pgm-edge");
    if (!target) group.classList.add("is-unresolved");
    if (this.selection?.kind === "edge" && this.selection.id === edge.id) {
      group.classList.add("is-selected");
    }
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${edge.type ?? "untyped relationship"}: ${edge.source} to ${edge.target}`);

    const targetPoint = target ?? unresolvedTarget(source, edge.target, edgeIndex);
    const geometry = edgeGeometry(
      source,
      targetPoint,
      source.id === targetPoint.id,
      target !== undefined,
      bend,
    );
    const visible = svgElement("path");
    visible.classList.add("pgm-edge-line");
    visible.setAttribute("d", geometry.path);
    visible.setAttribute("marker-end", `url(#${this.markerId})`);
    const hit = svgElement("path");
    hit.classList.add("pgm-edge-hit");
    hit.setAttribute("d", geometry.path);

    const label = svgElement("text");
    label.classList.add("pgm-edge-label");
    label.setAttribute("x", String(geometry.labelX));
    label.setAttribute("y", String(geometry.labelY));
    label.textContent = truncate(edge.type ?? "", 24);
    const tooltip = svgElement("title");
    tooltip.textContent = `${edge.type ?? "Untyped"}: ${edge.source} → ${edge.target}${target ? "" : " (unresolved)"}`;
    group.append(hit, visible, label, tooltip);

    if (!target) {
      const dot = svgElement("circle");
      dot.classList.add("pgm-unresolved-dot");
      dot.setAttribute("cx", String(targetPoint.x));
      dot.setAttribute("cy", String(targetPoint.y));
      dot.setAttribute("r", "5");
      group.append(dot);
    }

    const select = () => {
      this.select({ kind: "edge", id: edge.id });
    };
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    return group;
  }

  private select(selection: Exclude<Selection, null>): void {
    const canvas = this.contentEl.querySelector<HTMLElement>(".pgm-canvas");
    const scrollLeft = canvas?.scrollLeft ?? 0;
    const scrollTop = canvas?.scrollTop ?? 0;
    this.selection = selection;
    this.render();
    const replacement = this.contentEl.querySelector<HTMLElement>(".pgm-canvas");
    if (replacement) {
      replacement.scrollLeft = scrollLeft;
      replacement.scrollTop = scrollTop;
    }
  }

  private renderDetails(): HTMLElement {
    const aside = element("aside", "pgm-details");
    aside.setAttribute("aria-live", "polite");
    if (!this.graph || !this.selection) {
      aside.append(
        textElement("p", "Selection", "pgm-details-kicker"),
        textElement("p", "Select a concept or relationship to inspect its properties.", "pgm-details-hint"),
      );
      return aside;
    }

    const selected =
      this.selection.kind === "node"
        ? this.graph.nodes.find((node) => node.id === this.selection?.id)
        : this.graph.edges.find((edge) => edge.id === this.selection?.id);
    if (!selected) return aside;

    const isNode = this.selection.kind === "node";
    aside.append(
      textElement("p", isNode ? "Concept" : "Relationship", "pgm-details-kicker"),
      textElement("h3", isNode ? nodeLabel(selected as PgmNode) : (selected as PgmEdge).type ?? "Untyped"),
    );

    if (isNode) {
      const node = selected as PgmNode;
      aside.append(textElement("p", node.id, "pgm-details-path"));
    } else {
      const edge = selected as PgmEdge;
      aside.append(textElement("p", `${edge.source} → ${edge.target}`, "pgm-details-path"));
      if (!edge.resolved) {
        aside.append(textElement("p", "Target note is not present.", "pgm-unresolved-note"));
      }
    }

    aside.append(renderProperties(selected.properties));
    return aside;
  }
}

function filterGraph(graph: PgmGraph, rawQuery: string): { nodes: PgmNode[]; edges: PgmEdge[] } {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return { nodes: graph.nodes, edges: graph.edges };

  const matchedNodeIds = new Set(
    graph.nodes.filter((node) => searchableNode(node).includes(query)).map((node) => node.id),
  );
  const matchedEdges = graph.edges.filter((edge) => searchableEdge(edge).includes(query));
  for (const edge of matchedEdges) {
    matchedNodeIds.add(edge.source);
    if (edge.resolved) matchedNodeIds.add(edge.target);
  }

  const nodes = graph.nodes.filter((node) => matchedNodeIds.has(node.id));
  const edges = graph.edges.filter(
    (edge) =>
      matchedEdges.includes(edge) ||
      matchedNodeIds.has(edge.source) ||
      (edge.resolved && matchedNodeIds.has(edge.target)),
  );
  for (const edge of edges) {
    matchedNodeIds.add(edge.source);
    if (edge.resolved) matchedNodeIds.add(edge.target);
  }
  return {
    nodes: graph.nodes.filter((node) => matchedNodeIds.has(node.id)),
    edges,
  };
}

function searchableNode(node: PgmNode): string {
  return `${node.id}\n${node.path}\n${node.type}\n${nodeLabel(node)}\n${formatValue(node.properties)}`.toLowerCase();
}

function searchableEdge(edge: PgmEdge): string {
  return `${edge.source}\n${edge.target}\n${edge.type ?? ""}\n${edge.text}\n${formatValue(edge.properties)}`.toLowerCase();
}

function layoutNodes(nodes: PgmNode[]): PositionedNode[] {
  const sorted = nodes.slice().sort((a, b) => compareText(a.id, b.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.4)));
  return sorted.map((node, index) => ({
    ...node,
    x: 130 + (index % columns) * 220,
    y: 90 + Math.floor(index / columns) * 150,
  }));
}

function edgeBends(edges: PgmEdge[]): Map<string, number> {
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
  for (const group of groups.values()) {
    group.sort((left, right) =>
      compareText(left.source, right.source) || compareText(left.id, right.id),
    );
    const center = (group.length - 1) / 2;
    group.forEach((edge, index) => {
      if (edge.source === edge.target) {
        result.set(edge.id, index * 20);
        return;
      }
      const worldBend = (index - center) * 28;
      const direction = edge.source <= edge.target ? 1 : -1;
      result.set(edge.id, worldBend * direction);
    });
  }
  return result;
}

function unresolvedTarget(source: PositionedNode, targetId: string, index: number): PositionedNode {
  const seed = hashString(`${targetId}:${index}`);
  const angle = ((seed % 360) * Math.PI) / 180;
  return {
    id: `unresolved:${targetId}`,
    path: "",
    type: "",
    properties: {},
    x: source.x + Math.cos(angle) * 105,
    y: source.y + Math.sin(angle) * 84,
  };
}

function edgeGeometry(
  source: Pick<PositionedNode, "x" | "y">,
  target: Pick<PositionedNode, "x" | "y">,
  self: boolean,
  targetIsNode: boolean,
  bend: number,
): { path: string; labelX: number; labelY: number } {
  if (self) {
    const x = source.x + NODE_WIDTH / 2 + 2;
    const y = source.y - 12;
    const radius = 68 + Math.abs(bend);
    return {
      path: `M ${x} ${y} C ${x + radius} ${y - radius}, ${x + radius} ${y + radius}, ${x} ${y + 24}`,
      labelX: x + radius - 12,
      labelY: y - radius / 2,
    };
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const absX = Math.max(Math.abs(dx), 0.001);
  const absY = Math.max(Math.abs(dy), 0.001);
  const sourceScale = Math.min(NODE_WIDTH / 2 / absX, NODE_HEIGHT / 2 / absY);
  const targetScale = targetIsNode
    ? Math.min(NODE_WIDTH / 2 / absX, NODE_HEIGHT / 2 / absY)
    : 0;
  const x1 = source.x + dx * sourceScale;
  const y1 = source.y + dy * sourceScale;
  const x2 = target.x - dx * targetScale;
  const y2 = target.y - dy * targetScale;
  const length = Math.max(Math.hypot(x2 - x1, y2 - y1), 0.001);
  const normalX = -(y2 - y1) / length;
  const normalY = (x2 - x1) / length;
  const controlX = (x1 + x2) / 2 + normalX * bend;
  const controlY = (y1 + y2) / 2 + normalY * bend;
  return {
    path: bend === 0
      ? `M ${x1} ${y1} L ${x2} ${y2}`
      : `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`,
    labelX: (x1 + 2 * controlX + x2) / 4,
    labelY: (y1 + 2 * controlY + y2) / 4 - 8,
  };
}

function renderProperties(properties: Record<string, unknown>): HTMLElement {
  const section = element("div", "pgm-properties");
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    section.append(textElement("p", "No properties", "pgm-details-hint"));
    return section;
  }

  const list = document.createElement("dl");
  for (const [key, value] of entries) {
    list.append(textElement("dt", key), textElement("dd", formatValue(value)));
  }
  section.append(list);
  return section;
}

function nodeLabel(node: PgmNode): string {
  const name = node.properties.name;
  if (typeof name === "string" && name.length > 0) return name;
  const segments = node.id.split("/");
  return segments[segments.length - 1] ?? node.id;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (Object.is(value, -0)) return "-0";
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return `!!timestamp ${value.toISOString()}`;
  if (value instanceof Uint8Array) {
    return `!!binary 0x${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  if (Array.isArray(value)) return `[${value.map(formatNestedValue).join(", ")}]`;
  if (value instanceof Set) return `!!set {${[...value].map(formatNestedValue).join(", ")}}`;
  if (value instanceof Map) {
    return `{${[...value].map(([key, item]) => `${formatNestedValue(key)}: ${formatNestedValue(item)}`).join(", ")}}`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).map(([key, item]) => `${key}: ${formatNestedValue(item)}`).join(", ")}}`;
  }
  return String(value);
}

function formatNestedValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : formatValue(value);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
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

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  item.className = className;
  return item;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = text;
  return item;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}
