import { ItemView, Notice, Plugin, setIcon, TFile, type WorkspaceLeaf } from "obsidian";

import { parsePgmVault } from "./pgm";
import { PgmGraphViewer } from "./graph-viewer";
import { openNodeBesideViewer } from "./open-node";
import { disposeRelationshipPropertyHovers } from "./relationship-hover";
import {
  pgmRelationshipBadgeExtension,
  renderPgmRelationshipBadges,
} from "./relationship-badge";

const VIEW_TYPE_PGM = "pgm-viewer";

export default class PgmViewerPlugin extends Plugin {
  private preferences: Record<string, unknown> = {};
  private pendingPreferenceSave: Promise<void> = Promise.resolve();

  override async onload(): Promise<void> {
    const saved: unknown = await this.loadData().catch(() => null);
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      this.preferences = saved as Record<string, unknown>;
    }
    this.registerView(VIEW_TYPE_PGM, (leaf) => new PgmView(leaf, this));
    this.registerMarkdownPostProcessor(renderPgmRelationshipBadges);
    this.register(disposeRelationshipPropertyHovers);
    this.registerEditorExtension(pgmRelationshipBadgeExtension);

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

  loadPropertyPanelHeight(): number | null {
    const height = this.preferences.propertyPanelHeight;
    return typeof height === "number" && Number.isFinite(height) && height >= 0 ? height : null;
  }

  savePropertyPanelHeight(height: number): Promise<void> {
    this.preferences.propertyPanelHeight = height;
    const snapshot = { ...this.preferences };
    // Serialize rapid keyboard adjustments so the newest height wins on disk.
    this.pendingPreferenceSave = this.pendingPreferenceSave.catch(() => undefined)
      .then(() => this.saveData(snapshot));
    return this.pendingPreferenceSave;
  }

  private async openViewer(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PGM)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);

    if (!leaf) return;

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

/** Obsidian owns vault access and pane navigation; rendering stays host-independent. */
class PgmView extends ItemView {
  private viewer: PgmGraphViewer | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PgmViewerPlugin) {
    super(leaf);
  }

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
    this.viewer = new PgmGraphViewer(this.contentEl, {
      name: () => this.app.vault.getName(),
      loadGraph: async () => {
        const files = this.app.vault.getMarkdownFiles().slice().sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );
        const documents = await Promise.all(files.map(async (file) => ({
          path: file.path,
          content: await this.app.vault.cachedRead(file),
        })));
        return parsePgmVault(documents);
      },
      activePath: () => this.app.workspace.getActiveFile()?.path,
      openNode: (node) => openNodeBesideViewer(this.app.workspace, this.leaf, node.path),
      setIcon: (element, name) => setIcon(element, name),
      reportError: (error) => {
        new Notice(error instanceof Error ? error.message : "The note could not be opened.");
      },
      loadPropertyPanelHeight: () => this.plugin.loadPropertyPanelHeight(),
      savePropertyPanelHeight: (height) => this.plugin.savePropertyPanelHeight(height),
    });
    await this.viewer.start();
  }

  override async onClose(): Promise<void> {
    this.viewer?.destroy();
    this.viewer = null;
  }

  scheduleRefresh(): void {
    this.viewer?.scheduleRefresh();
  }
}
