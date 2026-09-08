import type { Workspace, WorkspaceLeaf } from "obsidian";

const pendingOpens = new WeakMap<WorkspaceLeaf, Promise<void>>();

/**
 * Open the exact vault note in a separate tab group, keeping the graph visible.
 * Calls for the same viewer are serialized so rapid clicks reuse one note pane.
 * The caller can refocus its graph after this resolves; opening errors propagate.
 */
export async function openNodeBesideViewer(
  workspace: Workspace,
  viewerLeaf: WorkspaceLeaf,
  path: string,
): Promise<void> {
  const previous = pendingOpens.get(viewerLeaf) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => openBeside(workspace, viewerLeaf, path));
  pendingOpens.set(viewerLeaf, next);
  try {
    await next;
  } finally {
    if (pendingOpens.get(viewerLeaf) === next) pendingOpens.delete(viewerLeaf);
  }
}

async function openBeside(workspace: Workspace, viewerLeaf: WorkspaceLeaf, path: string): Promise<void> {
  const file = viewerLeaf.view.app.vault.getFileByPath(path);
  if (!file) throw new Error(`The note could not be found: ${path}`);

  const mainLeaves: WorkspaceLeaf[] = [];
  // A truthy callback result stops Obsidian's traversal. Do not return push's
  // array length: the viewer may follow several Markdown tabs in the root.
  workspace.iterateRootLeaves((leaf) => {
    mainLeaves.push(leaf);
  });
  const candidates = mainLeaves.filter((leaf) => {
    if (leaf === viewerLeaf || leaf.parent === viewerLeaf.parent) return false;
    const state = leaf.getViewState();
    return state.type === "markdown" && (!state.pinned || state.state?.file === path);
  });
  const recent = workspace.getMostRecentLeaf(workspace.rootSplit);
  const visible = candidates.filter((leaf) => leaf.view.containerEl.getClientRects().length > 0);
  const alreadyOpen = (leaf: WorkspaceLeaf) => leaf.getViewState().state?.file === path;
  let target = visible.find(alreadyOpen)
    ?? candidates.find(alreadyOpen)
    ?? visible.find((leaf) => leaf === recent)
    ?? visible[0]
    ?? candidates.find((leaf) => leaf === recent)
    ?? candidates[0];
  const created = !target;
  if (!target) {
    target = mainLeaves.includes(viewerLeaf)
      ? workspace.createLeafBySplit(viewerLeaf, "vertical", true)
      : workspace.getLeaf("tab");
  }

  try {
    // Revealing an already-open note preserves its scroll position and editor.
    if (!alreadyOpen(target)) await target.openFile(file, { active: false });
  } catch (error) {
    if (created) target.detach();
    throw error;
  }
  await workspace.revealLeaf(target);
  await workspace.revealLeaf(viewerLeaf);
}
