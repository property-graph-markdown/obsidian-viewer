import { describe, expect, it, vi } from "vitest";
import type { TFile, ViewState, Workspace, WorkspaceLeaf } from "obsidian";

import { openNodeBesideViewer } from "../src/open-node";

function fixture(viewerInMain = true) {
  const requestedFiles = new Map<string, TFile>();
  for (const path of ["first.md", "second.md", "old.md"]) {
    requestedFiles.set(path, { path } as TFile);
  }
  const getFileByPath = vi.fn((path: string) => requestedFiles.get(path) ?? null);
  const mainLeaves: WorkspaceLeaf[] = [];
  const rootSplit = {};
  function leaf(type: string, parent = {}, path?: string, visible = true, pinned = false) {
    let state: ViewState = { type, state: path ? { file: path } : {}, pinned };
    const item = {
      parent,
      view: {
        app: { vault: { getFileByPath } },
        containerEl: { getClientRects: () => visible ? [{}] : [] },
      },
      getViewState: vi.fn(() => state),
      openFile: vi.fn(async (file: TFile) => {
        state = { type: "markdown", state: { file: file.path } };
      }),
      detach: vi.fn(() => {
        const index = mainLeaves.indexOf(item as unknown as WorkspaceLeaf);
        if (index >= 0) mainLeaves.splice(index, 1);
      }),
    };
    return item as unknown as WorkspaceLeaf;
  }
  const viewer = leaf("pgm-viewer");
  if (viewerInMain) mainLeaves.push(viewer);
  let recent: WorkspaceLeaf | null = viewer;
  const workspace = {
    rootSplit,
    // Obsidian stops traversal when the callback returns a truthy value.
    iterateRootLeaves: vi.fn((visit: (item: WorkspaceLeaf) => unknown) => {
      for (const item of mainLeaves) {
        if (visit(item)) break;
      }
    }),
    getMostRecentLeaf: vi.fn(() => recent),
    getLeaf: vi.fn(() => {
      const item = leaf("empty");
      mainLeaves.push(item);
      return item;
    }),
    createLeafBySplit: vi.fn(() => {
      const item = leaf("empty");
      mainLeaves.push(item);
      return item;
    }),
    revealLeaf: vi.fn(async () => undefined),
  };
  return {
    workspace,
    api: workspace as unknown as Workspace,
    viewer,
    mainLeaves,
    leaf,
    requestedFiles,
    getFileByPath,
    setRecent: (item: WorkspaceLeaf) => { recent = item; },
  };
}

describe("openNodeBesideViewer", () => {
  it("reuses a visible main Markdown pane and reveals both note and sidebar viewer", async () => {
    const setup = fixture(false);
    const note = setup.leaf("markdown", {}, "old.md");
    setup.mainLeaves.push(note);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(note.openFile).toHaveBeenCalledWith(setup.requestedFiles.get("first.md"), { active: false });
    expect(setup.workspace.getLeaf).not.toHaveBeenCalled();
    expect(setup.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(setup.workspace.revealLeaf.mock.calls).toEqual([[note], [setup.viewer]]);
    expect(setup.viewer.openFile).not.toHaveBeenCalled();
  });

  it("splits the viewer explicitly instead of activating another tab in its tab group", async () => {
    const setup = fixture();
    const hiddenTab = setup.leaf("markdown", setup.viewer.parent, "first.md", false);
    setup.mainLeaves.push(hiddenTab);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(setup.workspace.createLeafBySplit).toHaveBeenCalledWith(setup.viewer, "vertical", true);
    expect(setup.workspace.getLeaf).not.toHaveBeenCalled();
    expect(hiddenTab.openFile).not.toHaveBeenCalled();
    expect(setup.workspace.revealLeaf).not.toHaveBeenCalledWith(hiddenTab);
  });

  it("finds a central viewer after earlier tabs without stopping workspace traversal", async () => {
    const setup = fixture();
    const firstTab = setup.leaf("markdown", setup.viewer.parent, "first.md", false);
    const secondTab = setup.leaf("markdown", setup.viewer.parent, "old.md", false);
    setup.mainLeaves.unshift(firstTab, secondTab);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(setup.workspace.createLeafBySplit).toHaveBeenCalledWith(setup.viewer, "vertical", true);
    expect(setup.workspace.getLeaf).not.toHaveBeenCalled();
    expect(firstTab.openFile).not.toHaveBeenCalled();
    expect(secondTab.openFile).not.toHaveBeenCalled();
    const target = setup.mainLeaves[3]!;
    expect(target.parent).not.toBe(setup.viewer.parent);
    expect(target.getViewState().state?.file).toBe("first.md");
  });

  it("creates a root tab when a sidebar viewer has no reusable main note pane", async () => {
    const setup = fixture(false);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(setup.workspace.getLeaf).toHaveBeenCalledWith("tab");
    expect(setup.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });

  it("reuses an already-open note in a different group without reloading its editor", async () => {
    const setup = fixture();
    const note = setup.leaf("markdown", {}, "first.md", false);
    setup.mainLeaves.push(note);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(note.openFile).not.toHaveBeenCalled();
    expect(setup.workspace.revealLeaf.mock.calls).toEqual([[note], [setup.viewer]]);
    expect(setup.workspace.createLeafBySplit).not.toHaveBeenCalled();
  });

  it("prefers the most recent visible note pane and preserves unrelated pinned tabs", async () => {
    const setup = fixture();
    const pinned = setup.leaf("markdown", {}, "old.md", true, true);
    const older = setup.leaf("markdown", {}, "old.md");
    const recent = setup.leaf("markdown", {}, "old.md");
    setup.mainLeaves.push(pinned, older, recent);
    setup.setRecent(recent);

    await openNodeBesideViewer(setup.api, setup.viewer, "first.md");

    expect(recent.openFile).toHaveBeenCalledOnce();
    expect(older.openFile).not.toHaveBeenCalled();
    expect(pinned.openFile).not.toHaveBeenCalled();
  });

  it("serializes rapid opening requests so the new split is reused", async () => {
    const setup = fixture();

    await Promise.all([
      openNodeBesideViewer(setup.api, setup.viewer, "first.md"),
      openNodeBesideViewer(setup.api, setup.viewer, "second.md"),
      openNodeBesideViewer(setup.api, setup.viewer, "second.md"),
    ]);

    expect(setup.workspace.createLeafBySplit).toHaveBeenCalledOnce();
    const note = setup.mainLeaves[1]!;
    expect(note.openFile).toHaveBeenCalledTimes(2);
    expect(note.getViewState().state?.file).toBe("second.md");
    expect(setup.viewer.getViewState().type).toBe("pgm-viewer");
  });

  it("reports a missing note before creating or navigating any pane", async () => {
    const setup = fixture();

    await expect(openNodeBesideViewer(setup.api, setup.viewer, "missing.md"))
      .rejects.toThrow("The note could not be found: missing.md");

    expect(setup.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(setup.workspace.revealLeaf).not.toHaveBeenCalled();
  });

  it("removes a newly created split when opening fails and allows the next request", async () => {
    const setup = fixture();
    const failed = setup.leaf("empty");
    vi.mocked(failed.openFile).mockRejectedValueOnce(new Error("Cannot read note"));
    setup.workspace.createLeafBySplit.mockReturnValueOnce(failed);

    await expect(openNodeBesideViewer(setup.api, setup.viewer, "first.md"))
      .rejects.toThrow("Cannot read note");
    expect(failed.detach).toHaveBeenCalledOnce();
    await openNodeBesideViewer(setup.api, setup.viewer, "second.md");
    expect(setup.workspace.createLeafBySplit).toHaveBeenCalledTimes(2);
  });
});
