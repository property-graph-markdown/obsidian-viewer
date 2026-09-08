import type { PgmEdge, PgmGraph, PgmNode } from "./pgm";
import {
  createLocalGraphState,
  projectLocalGraph,
  refocusLocalGraph,
  toggleLocalNodeExpansion,
  type LocalGraphProjection,
  type LocalGraphState,
} from "./local-graph";
import {
  layoutLocalGraph,
  resolveNodeOverlaps,
  type PositionedPgmNode,
} from "./local-graph-layout";
import { nodeLabel, nodeTitle, nodePresentation, graphemes, NODE_LABEL_LINE_HEIGHT, NODE_RADIUS, NODE_LABEL_TOP } from "./node-presentation";
import { edgeGeometry, unresolvedTarget } from "./edge-geometry";
import { groupEdges, type PgmEdgeGroup } from "./edge-groups";
import { NavigationHistory } from "./navigation-history";
import { renderNodeRelationships } from "./node-relationships";

const SVG_NS = "http://www.w3.org/2000/svg";
let markerCounter = 0;

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

interface GraphViewSnapshot {
  localState: LocalGraphState;
  selection: Selection;
  highlightedNodeId: string | null;
  query: string;
  positions: Map<string, PositionedPgmNode>;
  camera: { x: number; y: number; scale: number };
  fitScale: number;
}

interface GraphSurface {
  svg: SVGSVGElement;
  viewport: SVGGElement;
  edgeLayer: SVGGElement;
  nodeLayer: SVGGElement;
  nodes: Map<string, PositionedPgmNode>;
  edges: PgmEdgeGroup[];
  captions: Map<string, EdgeCaption>;
}

interface EdgeCaption {
  group: SVGGElement;
  text: SVGTextElement;
  hit: SVGRectElement;
  path: SVGPathElement;
  mask: SVGMaskElement;
  maskBounds: SVGRectElement;
  gap: SVGRectElement;
  anchor: { x: number; y: number; angle: number };
  title: string;
  width: number;
  height: number;
  measuredWidth: number;
}

/** Services supplied by a browser page or an Obsidian pane. */
export interface GraphViewerHost {
  name(): string;
  loadGraph(): Promise<PgmGraph>;
  activePath(): string | null | undefined;
  openNode(node: PgmNode): Promise<void>;
  setIcon(element: HTMLElement, name: string): void;
  reportError(error: unknown): void;
}

export class PgmGraphViewer {
  private readonly markerId = `pgm-arrow-${markerCounter++}`;
  private graph: PgmGraph | null = null;
  private query = "";
  private selection: Selection = null;
  private highlightedNodeId: string | null = null;
  private localState: LocalGraphState = createLocalGraphState(null);
  private refreshTimer: number | undefined;
  private refreshGeneration = 0;
  private nodeClickTimer: number | undefined;
  private isMaximized = false;
  private maximizePlaceholder: Comment | null = null;
  private fitGraphToPane = true;
  private positions = new Map<string, PositionedPgmNode>();
  private surface: GraphSurface | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private camera = { x: 0, y: 0, scale: 1 };
  private viewportSize = { width: 0, height: 0 };
  private fitScale = 1;
  private openNodeGeneration = 0;
  private readonly history = new NavigationHistory<GraphViewSnapshot>();

  private started = false;
  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.isMaximized) return;
    event.preventDefault();
    this.restoreMaximized();
    this.render();
  };

  constructor(
    private readonly contentEl: HTMLElement,
    private readonly host: GraphViewerHost,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.contentEl.classList.add("pgm-viewer");
    this.contentEl.ownerDocument.addEventListener("keydown", this.onDocumentKeyDown);
    await this.refresh();
  }

  destroy(): void {
    this.started = false;
    this.contentEl.ownerDocument.removeEventListener("keydown", this.onDocumentKeyDown);
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.nodeClickTimer);
    this.refreshGeneration += 1;
    this.openNodeGeneration += 1;
    this.clearSurface();
    this.restoreMaximized();
    this.contentEl.replaceChildren();
    this.contentEl.classList.remove("pgm-viewer");
  }

  /** Move the read-only graph to a concept already loaded by this host. */
  focus(nodeId: string): void {
    if (this.started) this.refocus(nodeId);
  }

  scheduleRefresh(): void {
    if (!this.started) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      void this.refresh();
    }, 250);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.renderLoading();

    try {
      const graph = await this.host.loadGraph();
      if (generation !== this.refreshGeneration) return;
      this.graph = graph;
      this.reconcileLocalState();
      this.render();
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      this.renderFatalError(error);
    }
  }

  private reconcileLocalState(): void {
    if (!this.graph) return;
    const nodeIds = new Set(this.graph.nodes.map((node) => node.id));
    this.history.retain((entry) => entry.localState.focusNodeId !== null
      && nodeIds.has(entry.localState.focusNodeId));
    if (this.localState.focusNodeId !== null && !nodeIds.has(this.localState.focusNodeId)) {
      const previous = this.history.current;
      if (previous) this.restoreView(previous);
    }
    for (const id of this.positions.keys()) {
      if (!nodeIds.has(id)) this.positions.delete(id);
    }
    let focusNodeId = this.localState.focusNodeId;
    if (focusNodeId === null || !nodeIds.has(focusNodeId)) {
      this.positions.clear();
      this.fitGraphToPane = true;
      const activePath = this.host.activePath();
      focusNodeId =
        this.graph.nodes.find((node) => node.path === activePath)?.id ??
        this.graph.nodes.slice().sort((left, right) => compareText(left.id, right.id))[0]?.id ??
        null;
      this.localState = createLocalGraphState(focusNodeId);
      this.selection = focusNodeId ? { kind: "node", id: focusNodeId } : null;
      this.highlightedNodeId = null;
      this.history.reset(this.captureView());
    } else {
      this.localState = {
        focusNodeId,
        expandedNodeIds: new Set(
          [...this.localState.expandedNodeIds].filter((nodeId) => nodeIds.has(nodeId)),
        ),
      };
    }

    if (this.selection && !this.selectionExists(this.selection)) {
      this.selection = focusNodeId ? { kind: "node", id: focusNodeId } : null;
    }
    this.reconcileVisibleSelection();
  }

  private selectionExists(selection: Exclude<Selection, null>): boolean {
    if (!this.graph) return false;
    const items = selection.kind === "node" ? this.graph.nodes : groupEdges(this.graph.edges);
    return items.some((item) => item.id === selection.id);
  }

  private reconcileVisibleSelection(): void {
    if (!this.graph || !this.selection) return;
    const projection = projectLocalGraph(this.graph, this.localState);
    const items = this.selection.kind === "node" ? projection.nodes : groupEdges(projection.edges);
    if (items.some((item) => item.id === this.selection?.id)) return;
    const focusNodeId = this.localState.focusNodeId;
    this.selection = focusNodeId ? { kind: "node", id: focusNodeId } : null;
  }

  private renderLoading(): void {
    this.clearSurface();
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

    const projection = projectLocalGraph(this.graph, this.localState);
    const shell = element("div", "pgm-shell");
    const header = element("header", "pgm-header");
    const title = element("div", "pgm-heading");
    const titleLine = element("div", "pgm-title-line");
    titleLine.append(
      element("span", "pgm-live-dot"),
      textElement("h2", `${this.host.name()}/`),
    );
    title.append(titleLine, this.renderSummary(projection));

    const actions = element("div", "pgm-actions");
    const navigation = actionGroup(actions, "Graph navigation");
    const back = this.iconButton(navigation, "arrow-left", "Back", () => this.navigateHistory("back"));
    back.disabled = !this.history.canGoBack;
    const forward = this.iconButton(navigation, "arrow-right", "Forward", () => this.navigateHistory("forward"));
    forward.disabled = !this.history.canGoForward;
    const selectionActions = actionGroup(actions, "Selection actions");
    const openSelected = this.iconButton(
      selectionActions,
      "file-input",
      "Open selected",
      () => this.openSelected(),
    );
    const selectedNodeId = this.selection?.kind === "node" ? this.selection.id : null;
    openSelected.disabled = selectedNodeId === null;
    const selectedExpanded = selectedNodeId !== null &&
      this.localState.expandedNodeIds.has(selectedNodeId);
    const expansionToggle = this.iconButton(
      selectionActions,
      selectedExpanded ? "fold-vertical" : "unfold-vertical",
      selectedExpanded ? "Contract selected" : "Expand selected",
      () => this.toggleSelectedExpansion(),
    );
    expansionToggle.disabled = selectedNodeId === null;

    const viewActions = actionGroup(actions, "Graph view");
    this.iconButton(viewActions, "scan", "Fit graph", () => this.fitGraph());
    this.iconButton(viewActions, "refresh-cw", "Reload", () => void this.refresh());
    const maximize = this.iconButton(
      viewActions,
      this.isMaximized ? "minimize-2" : "maximize-2",
      this.isMaximized ? "Restore view" : "Maximize view",
      () => this.toggleMaximized(),
    );
    maximize.setAttribute("aria-pressed", String(this.isMaximized));
    header.append(title, actions);

    const tabs = element("div", "pgm-view-tabs");
    tabs.setAttribute("role", "tablist");
    const graphTab = textElement("button", "", "pgm-view-tab is-active");
    graphTab.type = "button";
    graphTab.setAttribute("role", "tab");
    graphTab.setAttribute("aria-selected", "true");
    graphTab.setAttribute("aria-label", "Graph view");
    const graphTabIcon = element("span", "pgm-view-tab-icon");
    this.host.setIcon(graphTabIcon, "git-fork");
    graphTab.append(graphTabIcon, document.createTextNode("Graph"));
    tabs.append(graphTab);

    const controls = element("div", "pgm-controls");
    const searchWrap = element("div", "pgm-search-wrap");
    const searchIcon = element("span", "pgm-search-icon");
    this.host.setIcon(searchIcon, "search");
    const search = document.createElement("input");
    search.className = "pgm-search";
    search.type = "search";
    search.placeholder = "Find in local graph";
    search.ariaLabel = "Find in local graph";
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderGraphArea(graphArea);
      search.focus();
      search.setSelectionRange(this.query.length, this.query.length);
    });
    searchWrap.append(searchIcon, search);
    controls.append(
      searchWrap,
      textElement(
        "span",
        "Drag: move · Scroll: zoom · Double-click: expand · Ctrl/Cmd-click: focus",
        "pgm-interaction-help",
      ),
    );

    const graphArea = element("div", "pgm-graph-area");
    shell.append(header, tabs, controls, graphArea);
    this.contentEl.append(shell);
    this.renderGraphArea(graphArea);
  }

  private renderSummary(projection: LocalGraphProjection): HTMLElement {
    if (!this.graph) return textElement("p", "", "pgm-summary");
    const visibleNodes = projection.nodes.length;
    const visibleEdges = projection.edges.length;
    const nodes = this.graph.nodes.length;
    const edges = this.graph.edges.length;
    const skipped = this.graph.diagnostics.length;
    const suffix = skipped > 0 ? ` · ${skipped} diagnostic${skipped === 1 ? "" : "s"}` : "";
    return textElement(
      "p",
      `${visibleNodes}/${nodes} concepts · ${visibleEdges}/${edges} relationships${suffix}`,
      "pgm-summary",
    );
  }

  private renderGraphArea(graphArea: HTMLElement): void {
    this.clearSurface();
    graphArea.replaceChildren();
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
      graphArea.append(state);
      return;
    }

    const { nodes, edges } = projectLocalGraph(this.graph, this.localState);

    const body = element("div", "pgm-body");
    const canvas = element("div", "pgm-canvas");
    canvas.append(this.renderSvg(nodes, edges));
    const zoomControls = element("div", "pgm-zoom-controls");
    zoomControls.setAttribute("role", "group");
    zoomControls.setAttribute("aria-label", "Graph zoom");
    this.iconButton(zoomControls, "zoom-out", "Zoom out", () => this.zoomGraph(1 / 1.25));
    const zoomLevel = textElement("span", "100%", "pgm-zoom-level");
    zoomLevel.setAttribute("aria-label", "Zoom level");
    zoomControls.append(zoomLevel);
    this.iconButton(zoomControls, "zoom-in", "Zoom in", () => this.zoomGraph(1.25));
    this.iconButton(zoomControls, "scan", "Fit graph", () => this.fitGraph());
    canvas.append(zoomControls);
    body.append(canvas, this.renderDetails());
    graphArea.append(body);
    this.resizeViewport(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resizeViewport(canvas));
    this.resizeObserver.observe(canvas);
  }

  private renderSvg(nodes: PgmNode[], edges: PgmEdge[]): SVGSVGElement {
    const positioned = this.positionNodes(nodes, edges);
    const byId = new Map(positioned.map((node) => [node.id, node]));
    const connections = groupEdges(edges);
    const selectedConnection = this.selection?.kind === "edge"
      ? connections.find((connection) => connection.id === this.selection?.id)
      : undefined;

    const svg = svgElement("svg");
    svg.classList.add("pgm-graph");
    if (this.selection?.kind === "edge") svg.classList.add("has-selected-edge");
    if (this.selection?.kind === "node" && this.highlightedNodeId === this.selection.id) {
      svg.classList.add("has-selected-node");
    }
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("role", "group");
    svg.setAttribute(
      "aria-label",
      `Local property graph with ${nodes.length} concepts and ${connections.length} connections representing ${edges.length} relationships`,
    );

    const defs = svgElement("defs");
    const titleGradient = svgElement("radialGradient");
    titleGradient.id = `${this.markerId}-node-title`;
    titleGradient.classList.add("pgm-node-title-gradient");
    titleGradient.setAttribute("cx", "50%");
    titleGradient.setAttribute("cy", "50%");
    titleGradient.setAttribute("r", "50%");
    // Object-bounding-box coordinates create an ellipse for any title height.
    // Its transparent perimeter leaves no visible rectangular field boundary.
    for (const [offset, opacity] of [["0%", "0.85"], ["55%", "0.85"], ["100%", "0"]] as const) {
      const stop = svgElement("stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-opacity", opacity);
      titleGradient.append(stop);
    }
    defs.append(titleGradient);
    for (const state of ["neutral", "active"] as const) {
      const marker = svgElement("marker");
      marker.id = `${this.markerId}-${state}`;
      marker.classList.add("pgm-arrow", `pgm-arrow-${state}`);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "10");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "9");
      marker.setAttribute("markerHeight", "9");
      marker.setAttribute("markerUnits", "userSpaceOnUse");
      marker.setAttribute("orient", "auto-start-reverse");
      const arrow = svgElement("path");
      arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      marker.append(arrow);
      defs.append(marker);
    }
    svg.append(defs);

    const matches = graphMatches(nodes, edges, this.query);
    const edgeLayer = svgElement("g");
    edgeLayer.classList.add("pgm-edges");
    const captions = new Map<string, EdgeCaption>();
    connections.forEach((edge, index) => {
      const source = byId.get(edge.source);
      if (!source) return;
      const target = byId.get(edge.target);
      edgeLayer.append(
        this.renderEdge(
          edge,
          source,
          target,
          index,
          edge.relationships.some((relationship) => matches.edgeIds.has(relationship.id)),
          defs,
          captions,
        ),
      );
    });
    const viewport = svgElement("g");
    viewport.classList.add("pgm-viewport");
    viewport.append(edgeLayer);

    const nodeLayer = svgElement("g");
    nodeLayer.classList.add("pgm-nodes");
    for (const node of positioned) {
      nodeLayer.append(this.renderNode(node, matches.nodeIds.has(node.id), selectedConnection));
    }
    viewport.append(nodeLayer);
    svg.append(viewport);
    this.surface = { svg, viewport, edgeLayer, nodeLayer, nodes: byId, edges: connections, captions };
    this.bindGraphGestures(this.surface);
    return svg;
  }

  private renderNode(node: PositionedPgmNode, queryMatch: boolean, selectedConnection?: PgmEdgeGroup): SVGGElement {
    const group = svgElement("g");
    group.classList.add("pgm-node");
    group.dataset.nodeId = node.id;
    const presentation = nodePresentation(node);
    group.style.setProperty("--pgm-node-color", presentation.color);
    const isFocus = this.localState.focusNodeId === node.id;
    const isExpanded = this.localState.expandedNodeIds.has(node.id);
    group.classList.add(isExpanded ? "is-expanded" : "is-collapsed");
    if (isFocus) group.classList.add("is-focus");
    if (!queryMatch) group.classList.add("is-dimmed");
    if (this.selection?.kind === "node" && this.selection.id === node.id) {
      group.classList.add("is-selected");
    }
    if (selectedConnection?.source === node.id || selectedConnection?.target === node.id) {
      group.classList.add("is-edge-endpoint");
    }
    group.setAttribute("transform", `translate(${node.x - node.width / 2} ${node.y - node.height / 2})`);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-expanded", String(isExpanded));
    if (isFocus) group.setAttribute("aria-current", "true");
    group.setAttribute(
      "aria-label",
      `${nodeTitle(node)}${isFocus ? ", focus" : ""}. Drag to move; double-click to ${isExpanded ? "contract" : "expand"}; Ctrl or Command click to focus.`,
    );

    if (isFocus) {
      const focusRing = svgElement("circle");
      focusRing.classList.add("pgm-focus-ring");
      focusRing.setAttribute("cx", String(node.width / 2));
      focusRing.setAttribute("cy", String(NODE_RADIUS));
      focusRing.setAttribute("r", String(NODE_RADIUS + 7));
      group.append(focusRing);
    }
    const body = svgElement("circle");
    body.classList.add("pgm-node-body");
    body.setAttribute("cx", String(node.width / 2));
    body.setAttribute("cy", String(NODE_RADIUS));
    body.setAttribute("r", String(NODE_RADIUS));
    const titleBackground = svgElement("rect");
    titleBackground.classList.add("pgm-node-title-background");
    titleBackground.setAttribute("fill", `url(#${this.markerId}-node-title)`);
    titleBackground.setAttribute("y", String(NODE_LABEL_TOP));
    titleBackground.setAttribute("width", String(node.width));
    titleBackground.setAttribute("height", String(node.height - NODE_LABEL_TOP));
    const label = svgElement("text");
    label.classList.add("pgm-node-label");
    label.setAttribute("x", String(node.width / 2));
    label.setAttribute("text-anchor", "middle");
    const firstBaseline = NODE_LABEL_TOP + 26;
    presentation.lines.forEach((line, index) => {
      const span = svgElement("tspan");
      span.setAttribute("x", String(node.width / 2));
      span.setAttribute("y", String(firstBaseline + index * NODE_LABEL_LINE_HEIGHT));
      span.textContent = line;
      label.append(span);
    });
    const tooltip = svgElement("title");
    tooltip.textContent = `${nodeTitle(node)}\n${node.path}\nDrag: move · Double-click: ${isExpanded ? "contract" : "expand"} · Ctrl/Cmd-click: focus`;
    group.append(body, titleBackground, label, tooltip);

    group.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        window.clearTimeout(this.nodeClickTimer);
        this.refocus(node.id);
        return;
      }
      if (event.detail > 1) return;
      window.clearTimeout(this.nodeClickTimer);
      this.nodeClickTimer = window.setTimeout(() => {
        this.select({ kind: "node", id: node.id });
      }, 220);
    });
    group.addEventListener("dblclick", (event) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      window.clearTimeout(this.nodeClickTimer);
      this.toggleNodeExpansion(node.id);
    });
    group.addEventListener("contextmenu", (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      window.clearTimeout(this.nodeClickTimer);
      this.refocus(node.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.refocus(node.id);
      } else if (event.key === " ") {
        event.preventDefault();
        this.toggleNodeExpansion(node.id);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.select({ kind: "node", id: node.id });
      }
    });
    return group;
  }

  private renderEdge(
    edge: PgmEdgeGroup,
    source: PositionedPgmNode,
    target: PositionedPgmNode | undefined,
    edgeIndex: number,
    queryMatch: boolean,
    defs: SVGDefsElement,
    captions: Map<string, EdgeCaption>,
  ): SVGGElement {
    const group = svgElement("g");
    group.classList.add("pgm-edge");
    group.dataset.edgeId = edge.id;
    group.dataset.relationshipCount = String(edge.relationships.length);
    group.classList.add(edge.source === this.localState.focusNodeId
      ? "is-outgoing" : edge.target === this.localState.focusNodeId ? "is-incoming" : "is-expanded");
    if (!queryMatch) group.classList.add("is-dimmed");
    if (!target) group.classList.add("is-unresolved");
    const selected = this.selection?.kind === "edge" && this.selection.id === edge.id;
    if (selected) group.classList.add("is-selected");
    const related = this.selection?.kind === "node"
      && this.highlightedNodeId === this.selection.id
      && (edge.source === this.selection.id || edge.target === this.selection.id);
    if (related) group.classList.add("is-related");
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    const title = edge.types.join(" · ");
    const direction = edge.forward && edge.reverse ? "↔" : edge.forward ? "→" : "←";
    group.setAttribute("aria-label", `${title}: ${edge.source} ${direction} ${edge.target}; ${edge.relationships.length} relationship${edge.relationships.length === 1 ? "" : "s"}`);

    const targetPoint = target ?? unresolvedTarget(source, edge.target, edgeIndex);
    const geometry = edgeGeometry(source, targetPoint, source.id === targetPoint.id, target !== undefined, 0);
    const visible = svgElement("path");
    visible.classList.add("pgm-edge-line");
    visible.setAttribute("d", geometry.path);
    const setArrow = (active: boolean): void => {
      const marker = `url(#${this.markerId}-${active ? "active" : "neutral"})`;
      if (edge.forward) visible.setAttribute("marker-end", marker);
      if (edge.reverse) visible.setAttribute("marker-start", marker);
    };
    setArrow(selected || related);
    const hit = svgElement("path");
    hit.classList.add("pgm-edge-hit");
    hit.setAttribute("d", geometry.path);

    // Cut a caption gap only in this connection. The continuous hit path
    // keeps it clickable, including the space under the combined types.
    const mask = svgElement("mask");
    mask.id = `${this.markerId}-caption-${edgeIndex}`;
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    const maskBounds = svgElement("rect");
    maskBounds.setAttribute("fill", "white");
    const gap = svgElement("rect");
    gap.setAttribute("fill", "black");
    mask.append(maskBounds, gap);
    defs.append(mask);
    visible.setAttribute("mask", `url(#${mask.id})`);

    const caption = svgElement("g");
    caption.classList.add("pgm-edge-caption");
    const labelHit = svgElement("rect");
    labelHit.classList.add("pgm-edge-label-hit");
    const label = svgElement("text");
    label.classList.add("pgm-edge-label");
    label.setAttribute("text-anchor", "middle");
    label.textContent = title;
    caption.append(labelHit, label);
    captions.set(edge.id, {
      group: caption, text: label, hit: labelHit, path: visible,
      mask, maskBounds, gap, anchor: geometry.label,
      title, width: 0, height: 0, measuredWidth: -1,
    });
    const tooltip = svgElement("title");
    tooltip.textContent = edge.relationships.map((relationship) => {
      const propertyText = Object.entries(relationship.properties)
        .map(([key, value]) => `${key}: ${formatValue(value)}`).join(" · ");
      return `${relationship.type?.trim() || "untyped"}: ${relationship.source} → ${relationship.target}${relationship.resolved ? "" : " (unresolved)"}${propertyText ? `\n${propertyText}` : ""}`;
    }).join("\n\n");
    group.append(hit, visible, caption, tooltip);

    if (!target) {
      const dot = svgElement("circle");
      dot.classList.add("pgm-unresolved-dot");
      dot.setAttribute("cx", String(targetPoint.x));
      dot.setAttribute("cy", String(targetPoint.y));
      dot.setAttribute("r", "5");
      group.append(dot);
    }
    group.addEventListener("pointerenter", () => setArrow(true));
    group.addEventListener("pointerleave", () => setArrow(selected || related || group.matches(":focus-visible")));
    group.addEventListener("focus", () => setArrow(true));
    group.addEventListener("blur", () => setArrow(selected || related || group.matches(":hover")));
    const select = () => this.select({ kind: "edge", id: edge.id });
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    return group;
  }

  private select(selection: Selection): void {
    window.clearTimeout(this.nodeClickTimer);
    const highlightedNodeId = selection?.kind === "node" ? selection.id : null;
    if (this.selection?.kind === selection?.kind && this.selection?.id === selection?.id
      && this.highlightedNodeId === highlightedNodeId) return;
    this.openNodeGeneration += 1;
    this.history.replaceCurrent(this.captureView());
    this.selection = selection;
    this.highlightedNodeId = highlightedNodeId;
    this.history.push(this.captureView());
    this.renderPreservingCamera();
  }

  private renderPreservingCamera(): void {
    // Selection and disclosure keep the user's view, even if the
    // resized property panel changes the canvas height during rendering.
    const camera = { ...this.camera };
    this.fitGraphToPane = false;
    this.render();
    this.camera = camera;
    this.applyCamera();
  }

  private refocus(nodeId: string): void {
    if (!this.graph?.nodes.some((node) => node.id === nodeId)) return;
    window.clearTimeout(this.nodeClickTimer);
    this.openNodeGeneration += 1;
    if (nodeId === this.localState.focusNodeId) {
      this.select({ kind: "node", id: nodeId });
      return;
    }
    this.history.replaceCurrent(this.captureView());
    this.highlightedNodeId = null;
    this.localState = refocusLocalGraph(this.localState, nodeId);
    this.positions.clear();
    this.selection = { kind: "node", id: nodeId };
    this.fitGraphToPane = true;
    this.history.push(this.captureView());
    this.render();
  }

  private captureView(): GraphViewSnapshot {
    return {
      localState: {
        focusNodeId: this.localState.focusNodeId,
        expandedNodeIds: new Set(this.localState.expandedNodeIds),
      },
      selection: this.selection ? { ...this.selection } : null,
      highlightedNodeId: this.highlightedNodeId,
      query: this.query,
      positions: new Map([...this.positions].map(([id, node]) => [id, { ...node }])),
      camera: { ...this.camera },
      fitScale: this.fitScale,
    };
  }

  private navigateHistory(direction: "back" | "forward"): void {
    if (direction === "back" ? !this.history.canGoBack : !this.history.canGoForward) return;
    window.clearTimeout(this.nodeClickTimer);
    this.openNodeGeneration += 1;
    this.history.replaceCurrent(this.captureView());
    const entry = this.history[direction]();
    if (!entry) return;
    this.restoreView(entry);
    this.reconcileLocalState();
    this.renderPreservingCamera();
  }

  private restoreView(entry: GraphViewSnapshot): void {
    this.localState = {
      focusNodeId: entry.localState.focusNodeId,
      expandedNodeIds: new Set(entry.localState.expandedNodeIds),
    };
    this.selection = entry.selection ? { ...entry.selection } : null;
    this.highlightedNodeId = entry.highlightedNodeId;
    this.query = entry.query;
    this.positions = new Map([...entry.positions].map(([id, node]) => [id, { ...node }]));
    this.camera = { ...entry.camera };
    this.fitScale = entry.fitScale;
    this.fitGraphToPane = false;
  }

  private toggleNodeExpansion(nodeId: string): void {
    if (!this.graph?.nodes.some((node) => node.id === nodeId)) return;
    window.clearTimeout(this.nodeClickTimer);
    this.openNodeGeneration += 1;
    this.history.replaceCurrent(this.captureView());
    this.selection = { kind: "node", id: nodeId };
    this.localState = toggleLocalNodeExpansion(this.localState, nodeId);
    this.reconcileVisibleSelection();
    this.history.push(this.captureView());
    this.renderPreservingCamera();
  }

  private toggleSelectedExpansion(): void {
    if (this.selection?.kind !== "node") return;
    this.toggleNodeExpansion(this.selection.id);
  }

  private inspectNodeRelationship(nodeId: string, edge: PgmEdge): void {
    if (!this.graph) return;
    window.clearTimeout(this.nodeClickTimer);
    const connection = groupEdges([edge])[0];
    if (!connection) return;
    const projection = projectLocalGraph(this.graph, this.localState);
    const revealsRelationships = !projection.edges.some((visible) => visible.id === edge.id);
    if (!revealsRelationships) {
      this.select({ kind: "edge", id: connection.id });
      return;
    }
    this.openNodeGeneration += 1;
    this.history.replaceCurrent(this.captureView());
    this.localState = toggleLocalNodeExpansion(this.localState, nodeId);
    this.selection = { kind: "edge", id: connection.id };
    this.highlightedNodeId = null;
    this.history.push(this.captureView());
    this.renderPreservingCamera();
  }

  private async openSelected(): Promise<void> {
    if (!this.graph || this.selection?.kind !== "node") return;
    const node = this.graph.nodes.find((candidate) => candidate.id === this.selection?.id);
    if (!node) return;
    const generation = ++this.openNodeGeneration;
    this.restoreMaximized();
    try {
      await this.host.openNode(node);
      if (generation === this.openNodeGeneration && this.contentEl.isConnected) this.refocus(node.id);
    } catch (error) {
      this.host.reportError(error);
    }
  }

  private fitGraph(): void {
    this.fitGraphToPane = true;
    this.fitViewport();
  }

  private clearSurface(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.surface = null;
  }

  private positionNodes(nodes: PgmNode[], edges: PgmEdge[]): PositionedPgmNode[] {
    const needsLayout = nodes.some((node) => !this.positions.has(node.id));
    const layout = needsLayout ? layoutLocalGraph(nodes, edges, this.localState.focusNodeId) : null;
    const focusId = this.localState.focusNodeId ?? "";
    const oldFocus = this.positions.get(focusId);
    const newFocus = layout?.nodes.find((node) => node.id === focusId);
    const dx = oldFocus && newFocus ? oldFocus.x - newFocus.x : 0;
    const dy = oldFocus && newFocus ? oldFocus.y - newFocus.y : 0;
    const initial = new Map(layout?.nodes.map((node) => [node.id, node]));
    const positioned = nodes.map((node) => {
      const previous = this.positions.get(node.id);
      const seed = initial.get(node.id);
      const { width, height } = nodePresentation(node);
      return {
        ...node, width, height,
        x: previous?.x ?? (seed?.x ?? 0) + dx,
        y: previous?.y ?? (seed?.y ?? 0) + dy,
      };
    });
    // Resolve automatic placement only. A redraw must preserve the user's
    // exact positions, including any overlaps created by manual dragging.
    const separated = needsLayout ? resolveNodeOverlaps(positioned, focusId) : positioned;
    for (const node of separated) this.positions.set(node.id, node);
    return separated;
  }

  private resizeViewport(canvas: HTMLElement): void {
    if (!this.surface || !canvas.isConnected) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const previous = this.viewportSize;
    this.viewportSize = { width, height };
    this.surface.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    if (this.fitGraphToPane) {
      this.fitViewport();
    } else {
      // Resizing a pane keeps the same graph point at its centre.
      this.camera.x += (width - previous.width) / 2;
      this.camera.y += (height - previous.height) / 2;
      this.applyCamera();
    }
  }

  private fitViewport(): void {
    if (!this.surface || this.viewportSize.width <= 0) return;
    const bounds = this.surface.viewport.getBBox();
    const { width, height } = this.viewportSize;
    const padding = 36;
    const focus = this.surface.nodes.get(this.localState.focusNodeId ?? "");
    const centerX = focus?.x ?? bounds.x + bounds.width / 2;
    const centerY = focus?.y ?? bounds.y + bounds.height / 2;
    const graphWidth = 2 * Math.max(centerX - bounds.x, bounds.x + bounds.width - centerX);
    const graphHeight = 2 * Math.max(centerY - bounds.y, bounds.y + bounds.height - centerY);
    const scale = Math.min(
      width / Math.max(graphWidth + padding * 2, 1),
      height / Math.max(graphHeight + padding * 2, 1),
      1.5,
    );
    this.fitScale = scale;
    this.camera = {
      x: width / 2 - centerX * scale,
      y: height / 2 - centerY * scale,
      scale,
    };
    this.applyCamera();
  }

  private applyCamera(): void {
    const { x, y, scale } = this.camera;
    this.surface?.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
    const level = this.contentEl.querySelector(".pgm-zoom-level");
    if (level) level.textContent = `${Math.round(scale * 100)}%`;
    this.positionEdgeCaptions();
  }

  private positionEdgeCaptions(): void {
    const surface = this.surface;
    if (!surface || !surface.svg.isConnected) return;
    for (const caption of surface.captions.values()) {
      const length = caption.path.getTotalLength();
      const maxWidth = Math.max(0, Math.min(320, length - 40));
      if (caption.measuredWidth !== maxWidth) measureEdgeCaption(caption, maxWidth);
      const { x, y, angle } = caption.anchor;
      const transform = `translate(${x} ${y}) rotate(${angle})`;
      caption.group.setAttribute("transform", transform);
      caption.gap.setAttribute("transform", transform);
      const bounds = caption.path.getBBox();
      // Include arrowheads and hover strokes, also for perfectly vertical lines.
      for (const element of [caption.mask, caption.maskBounds]) {
        element.setAttribute("x", String(bounds.x - 16));
        element.setAttribute("y", String(bounds.y - 16));
        element.setAttribute("width", String(bounds.width + 32));
        element.setAttribute("height", String(bounds.height + 32));
      }
    }
  }

  private zoomGraph(factor: number, anchor = {
    x: this.viewportSize.width / 2, y: this.viewportSize.height / 2,
  }): void {
    if (!this.surface) return;
    const old = this.camera;
    const scale = Math.max(Math.min(0.1, this.fitScale), Math.min(4, old.scale * factor));
    const ratio = scale / old.scale;
    this.camera = {
      x: anchor.x - (anchor.x - old.x) * ratio,
      y: anchor.y - (anchor.y - old.y) * ratio,
      scale,
    };
    this.fitGraphToPane = false;
    this.applyCamera();
  }

  private redrawPositions(surface: GraphSurface): void {
    for (const group of Array.from(surface.nodeLayer.querySelectorAll<SVGGElement>(".pgm-node"))) {
      const node = surface.nodes.get(group.dataset.nodeId ?? "");
      if (!node) continue;
      group.setAttribute("transform", `translate(${node.x - node.width / 2} ${node.y - node.height / 2})`);
      this.positions.set(node.id, node);
    }
    let groupIndex = 0;
    surface.edges.forEach((edge, index) => {
      const source = surface.nodes.get(edge.source);
      if (!source) return;
      const group = surface.edgeLayer.children[groupIndex++];
      if (!group) return;
      const target = surface.nodes.get(edge.target);
      const targetPoint = target ?? unresolvedTarget(source, edge.target, index);
      const geometry = edgeGeometry(source, targetPoint, source.id === targetPoint.id,
        target !== undefined, 0);
      group.querySelector(".pgm-edge-line")?.setAttribute("d", geometry.path);
      group.querySelector(".pgm-edge-hit")?.setAttribute("d", geometry.path);
      const caption = surface.captions.get(edge.id);
      if (caption) caption.anchor = geometry.label;
      const dot = group.querySelector(".pgm-unresolved-dot");
      dot?.setAttribute("cx", String(targetPoint.x));
      dot?.setAttribute("cy", String(targetPoint.y));
    });
    this.positionEdgeCaptions();
  }

  private bindGraphGestures(surface: GraphSurface): void {
    const { svg } = surface;
    let suppressClick = false;
    let gesture: {
      pointerId: number;
      start: { x: number; y: number };
      camera: { x: number; y: number; scale: number };
      wasFit: boolean;
      node: PositionedPgmNode | undefined;
      capture: SVGElement;
      moved: boolean;
    } | null = null;
    const localPoint = (event: { clientX: number; clientY: number }) => {
      const bounds = svg.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) * this.viewportSize.width / bounds.width,
        y: (event.clientY - bounds.top) * this.viewportSize.height / bounds.height,
      };
    };
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (gesture) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewportSize.height : 1;
      const delta = Math.max(-180, Math.min(180, event.deltaY * unit));
      this.zoomGraph(Math.exp(-delta * 0.0025), localPoint(event));
    }, { passive: false });
    svg.addEventListener("keydown", (event) => {
      if (gesture) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.zoomGraph(1.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        this.zoomGraph(1 / 1.25);
      } else if (event.key === "0") {
        event.preventDefault();
        this.fitGraph();
      }
    });
    for (const type of ["click", "dblclick", "contextmenu"] as const) {
      svg.addEventListener(type, (event) => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    svg.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest(".pgm-node, .pgm-edge")) return;
      // The capture guard above suppresses clicks generated by a pan or drag.
      this.select(null);
    });
    svg.addEventListener("pointerdown", (event) => {
      const startsPrimaryPointerSequence =
        !gesture && event.button === 0 && event.isPrimary;
      // A completed drag suppresses the synthetic click generated for that
      // pointer sequence. Clear the guard at the start of the next sequence,
      // including Ctrl/Cmd-clicks, so refocusing cannot inherit stale state.
      if (startsPrimaryPointerSequence) suppressClick = false;
      if (!startsPrimaryPointerSequence || event.ctrlKey || event.metaKey) return;
      const target = event.target as Element;
      const group = target.closest<SVGGElement>(".pgm-node");
      if (!group && target.closest(".pgm-edge")) return;
      const node = group ? surface.nodes.get(group.dataset.nodeId ?? "") : undefined;
      const capture = group ?? svg;
      gesture = {
        pointerId: event.pointerId, start: localPoint(event), camera: { ...this.camera },
        wasFit: this.fitGraphToPane, node, capture, moved: false,
      };
      window.clearTimeout(this.nodeClickTimer);
      capture.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const point = localPoint(event);
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      event.preventDefault();
      gesture.moved = true;
      suppressClick = true;
      this.fitGraphToPane = false;
      if (gesture.node) {
        gesture.capture.classList.add("is-dragging");
        const node = {
          ...gesture.node,
          x: gesture.node.x + dx / gesture.camera.scale,
          y: gesture.node.y + dy / gesture.camera.scale,
        };
        surface.nodes.set(node.id, node);
        this.redrawPositions(surface);
      } else {
        svg.classList.add("is-panning");
        this.camera = { ...gesture.camera, x: gesture.camera.x + dx, y: gesture.camera.y + dy };
        this.applyCamera();
      }
    });
    const finish = (event: PointerEvent, cancel: boolean) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const current = gesture;
      gesture = null;
      current.capture.classList.remove("is-dragging");
      svg.classList.remove("is-panning");
      if (current.moved) {
        if (cancel) {
          this.camera = current.camera;
          this.fitGraphToPane = current.wasFit;
          if (current.node) surface.nodes.set(current.node.id, current.node);
        }
        this.redrawPositions(surface);
        this.applyCamera();
      }
      if (current.capture.hasPointerCapture(event.pointerId)) current.capture.releasePointerCapture(event.pointerId);
    };
    svg.addEventListener("pointerup", (event) => finish(event, false));
    svg.addEventListener("pointercancel", (event) => finish(event, true));
    svg.addEventListener("lostpointercapture", (event) => finish(event, true));
  }

  private toggleMaximized(): void {
    if (this.isMaximized) {
      this.restoreMaximized();
      this.render();
      return;
    }

    const parent = this.contentEl.parentNode;
    if (!parent) return;
    const ownerDocument = this.contentEl.ownerDocument;
    this.maximizePlaceholder = ownerDocument.createComment("pgm-viewer-placeholder");
    parent.insertBefore(this.maximizePlaceholder, this.contentEl);
    ownerDocument.body.classList.add("pgm-has-maximized-viewer");
    this.contentEl.classList.add("pgm-is-maximized");
    ownerDocument.body.append(this.contentEl);
    this.isMaximized = true;
    this.fitGraphToPane = true;
    this.render();
  }

  private restoreMaximized(): void {
    if (!this.isMaximized && !this.maximizePlaceholder) return;
    const placeholder = this.maximizePlaceholder;
    if (placeholder?.isConnected && placeholder.parentNode) {
      placeholder.parentNode.insertBefore(this.contentEl, placeholder);
    } else if (this.contentEl.parentNode === this.contentEl.ownerDocument.body) {
      this.contentEl.remove();
    }
    this.contentEl.classList.remove("pgm-is-maximized");
    this.contentEl.ownerDocument.body.classList.remove("pgm-has-maximized-viewer");
    placeholder?.remove();
    this.maximizePlaceholder = null;
    this.isMaximized = false;
  }

  private renderDetails(): HTMLElement {
    const details = element("section", "pgm-selection-details");
    details.setAttribute("aria-live", "polite");
    details.setAttribute("aria-label", "Selected graph element details");
    if (!this.graph || !this.selection) {
      details.append(
        textElement("p", "Selection", "pgm-details-kicker"),
        textElement("p", "Select a concept or relationship to inspect its properties.", "pgm-details-hint"),
      );
      return details;
    }

    if (this.selection.kind === "node") {
      const node = this.graph.nodes.find((node) => node.id === this.selection?.id);
      if (!node) return details;
      details.classList.add("has-node-relationships");
      const heading = element("div", "pgm-details-heading");
      heading.append(
        textElement("p", "Concept", "pgm-details-kicker"),
        textElement("h3", nodeLabel(node)),
        textElement("p", node.id, "pgm-details-path"),
      );
      const relationships = renderNodeRelationships(this.graph, node.id,
        (edge) => this.inspectNodeRelationship(node.id, edge), details.ownerDocument);
      const count = this.graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
      const jump = textElement("button", `${count} relationship${count === 1 ? "" : "s"}`, "pgm-node-relationships-jump");
      jump.type = "button";
      jump.addEventListener("click", () => {
        details.scrollTop += relationships.getBoundingClientRect().top - details.getBoundingClientRect().top - 10;
      });
      heading.append(jump);
      details.append(heading, renderProperties(node.properties), relationships);
      return details;
    }

    const connection = groupEdges(projectLocalGraph(this.graph, this.localState).edges)
      .find((connection) => connection.id === this.selection?.id);
    if (!connection) return details;
    details.classList.add("is-relationship-group");
    const nodeById = new Map(this.graph.nodes.map((node) => [node.id, node]));
    const endpointLabel = (id: string): string => {
      const node = nodeById.get(id);
      return node ? nodeLabel(node) : id;
    };
    const heading = element("div", "pgm-details-heading");
    const count = connection.relationships.length;
    const direction = connection.forward && connection.reverse ? "↔" : connection.forward ? "→" : "←";
    heading.append(
      textElement("p", `${count} relationship${count === 1 ? "" : "s"}`, "pgm-details-kicker"),
      textElement("h3", `${endpointLabel(connection.source)} ${direction} ${endpointLabel(connection.target)}`),
    );
    const list = element("div", "pgm-relationship-list");
    for (const relationship of connection.relationships) {
      const item = element("article", "pgm-relationship");
      item.dataset.relationshipId = relationship.id;
      const description = element("div", "pgm-relationship-heading");
      const type = relationship.type?.trim() || "untyped";
      const path = textElement("p", `${endpointLabel(relationship.source)} → ${endpointLabel(relationship.target)}`, "pgm-details-path");
      path.title = `${relationship.source} → ${relationship.target}`;
      description.append(textElement("h4", type), path);
      if (!relationship.resolved) {
        description.append(textElement("p", "Target note is not present.", "pgm-unresolved-note"));
      }
      item.append(description, renderProperties(relationship.properties));
      list.append(item);
    }
    details.append(heading, list);
    return details;
  }

  private iconButton(
    container: HTMLElement,
    icon: string,
    label: string,
    callback: () => void,
  ): HTMLButtonElement {
    const button = container.ownerDocument.createElement("button");
    button.className = "clickable-icon pgm-icon-button";
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    this.host.setIcon(button, icon);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", callback);
    container.append(button);
    return button;
  }
}

function graphMatches(
  nodes: readonly PgmNode[],
  edges: readonly PgmEdge[],
  rawQuery: string,
): { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return {
      nodeIds: new Set(nodes.map((node) => node.id)),
      edgeIds: new Set(edges.map((edge) => edge.id)),
    };
  }

  const nodeIds = new Set(
    nodes.filter((node) => searchableNode(node).includes(query)).map((node) => node.id),
  );
  const directlyMatchedNodeIds = new Set(nodeIds);
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (
      searchableEdge(edge).includes(query) ||
      directlyMatchedNodeIds.has(edge.source) ||
      directlyMatchedNodeIds.has(edge.target)
    ) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      if (edge.resolved) nodeIds.add(edge.target);
    }
  }
  return { nodeIds, edgeIds };
}

function searchableNode(node: PgmNode): string {
  return `${node.id}\n${node.path}\n${node.type}\n${nodeLabel(node)}\n${formatValue(node.properties)}`.toLowerCase();
}

function searchableEdge(edge: PgmEdge): string {
  return `${edge.source}\n${edge.target}\n${edge.type ?? ""}\n${edge.text}\n${formatValue(edge.properties)}`.toLowerCase();
}

function measureEdgeCaption(caption: EdgeCaption, maxWidth: number): void {
  const { text, title, hit, gap } = caption;
  text.textContent = title;
  if (text.getComputedTextLength() > maxWidth) {
    // Keep the type on one straight baseline. The complete value is retained
    // in the relationship tooltip and property strip when space is limited.
    const characters = graphemes(title);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      text.textContent = characters.slice(0, mid).join("") + "…";
      if (text.getComputedTextLength() <= maxWidth) low = mid;
      else high = mid - 1;
    }
    text.textContent = low > 0 ? characters.slice(0, low).join("") + "…" : "";
  }
  caption.width = text.textContent ? text.getComputedTextLength() + 12 : 0;
  caption.height = text.textContent ? 22 : 0;
  caption.measuredWidth = maxWidth;
  for (const rectangle of [hit, gap]) {
    rectangle.setAttribute("x", String(-caption.width / 2));
    rectangle.setAttribute("y", String(-caption.height / 2));
    rectangle.setAttribute("width", String(caption.width));
    rectangle.setAttribute("height", String(caption.height));
  }
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


function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function actionGroup(container: HTMLElement, label: string): HTMLDivElement {
  const group = container.ownerDocument.createElement("div");
  group.className = "pgm-action-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  container.append(group);
  return group;
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
