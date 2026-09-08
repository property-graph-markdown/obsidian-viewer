# PGM Viewer for Obsidian

A focused graph view for
[Property Graph Markdown](https://github.com/property-graph-markdown/specification)
vaults. It opens in Obsidian's right sidebar from the ribbon or with **PGM
Viewer: Open graph view**.

PGM Viewer is independent open-source software under the MIT License. The
Obsidian plugin contains no
telemetry, analytics, advertising, remote assets, update mechanism, or network
requests. Your Markdown stays in your vault.

## What it shows

- Every non-reserved `.md` concept with a non-empty string `type` in YAML
  frontmatter becomes a node.
- Concepts appear as circles with stable colours based on their type, in both
  light and dark themes. A borderless background that fades outward below
  each circle shows Type: Title in a regular 23px font and wraps long titles onto as many lines
  as needed. Node height and overlap protection account for the circle and
  its full title.
- Every Markdown Concept Link becomes a directed relationship occurrence.
- The graph starts at one focus concept and initially shows only its direct
  neighbours. Refocusing starts a fresh local view instead of drawing the
  entire vault as a global hairball.
  The initial zoom is 57%, centred on the focus. Refocusing keeps the current
  zoom; **Fit graph** shows the overview.
- A PGM 0.4 YAML flow-map link title supplies complete relationship properties;
  a non-empty string `type` is also shown as its relationship type.
- All relationships between a pair of concepts share one visual connection.
  Its caption combines their distinct types; arrowheads at either end indicate
  the directions actually present. The original relationship occurrences and
  their properties remain separate, including repeated types.
- Relationship types use a 21px font directly in a gap at the middle of their arrow,
  with a straight baseline aligned to its tangent and a readable orientation.
  Self relationships share a single loop. Text, arrows, and nodes zoom
  together; captions never detach from their relationships. A type that is too
  long for its arrow is shortened with an ellipsis; its complete value remains
  available in the tooltip and property strip. The documented compatibility
  edge without a type is honestly labelled `untyped`.
- Neutral arrows and a plain background keep the overview quiet. Hovering or
  selecting a relationship accents that arrow; selecting it also fades other
  relationships and concepts outside its two endpoints.
- Unresolved concept targets remain relationships and are drawn with a dashed
  line and hollow endpoint; the viewer does not invent a node for them.
- Selecting a concept shows its properties below the graph. Selecting a
  connection lists every relationship it represents, each with its own type,
  source-to-target direction, and complete properties. The read-only panel
  scrolls when needed; property names and values wrap and can be copied.
- Drag the divider above the property panel to set its height, or focus it and
  use the Up/Down arrow keys. The height stays fixed across selections and
  navigation and is saved locally for future sessions. Smaller windows may
  temporarily limit it to keep the graph usable; more space restores the setting.
- A selected concept also lists all its incoming and outgoing relationships,
  including occurrences beyond the current projection. Its relationship count
  jumps to that list. Selecting an entry shows the connection's full properties
  and reveals its neighbours if needed, preserving the current zoom and pan.
- Search keeps nodes whose displayed `Type: Title` contains every entered
  keyword, ignoring case. The central focus node always stays visible, along
  with relationships connecting it to matching nodes and those between matches.
  It filters the current local projection while preserving node positions,
  zoom, and pan; clearing the search restores the full projection.
- Canonical PGM relationship links gain a small direction badge and their
  relationship type in Reading View and Live Preview. Hovering over the badge or type
  opens a dedicated, selectable property popover with all relationship properties,
  including nested values. Keyboard focus or activation opens the same popover.
  These surfaces do not trigger Obsidian's target-note preview; the target title
  remains a normal navigable Markdown link. Escape or an outside click closes it.
  Moving the editor caret into the link exposes its original Markdown for
  direct editing.

## Explore the local graph

- **Automatic layout** groups neighbouring concepts by their exact type.
  The largest groups sit on opposite sides of the focus; smaller groups occupy
  the space between them. Large groups use staggered arcs with room for full
  titles. Valid `date`, `year`, or `from` properties order each group's concepts
  chronologically, with title/ID as a fallback; spacing does not represent time.
  These are individual movable nodes, with no group boxes or collapsed data.
  Relationships at the focus receive angular clearance across all arcs.
  Captions can slide along their straight baseline to reduce collisions with
  other text, nodes, and lines; manual node positions remain under your control.
- **Back / Forward** revisit concept and relationship selections, graph focus
  changes, and expanded or contracted branches. Each step restores its
  expanded branches, manual node positions, selection, search, zoom, and pan.
  Navigation from the property panel and clearing the selection are included.
  Selecting the same element again or adjusting the camera does not add a step.
  A new selection, focus, expansion, or contraction after going back replaces
  the forward branch.
- **Drag a concept** to move only that concept; its relationships follow and
  every other concept stays in place. Manual positions are retained even when
  titles overlap. Selecting a concept or relationship preserves the current
  node positions and viewport.
- **Click a concept** to highlight its incoming and outgoing relationships,
  including their types and arrowheads. Other relationships fade. The initial
  overview stays neutral until you select a concept.
- **Click the empty background** to clear the selection, its highlights, and
  the property panel. Panning or dragging keeps the current selection.
- **Scroll or pinch on a trackpad** over the graph to zoom around the pointer.
  Drag the empty background to pan. The corner controls also zoom in and out,
  show the current zoom level, and fit the graph to the pane.
- **Double-click** a concept to expand or contract its relationships. Expansion
  can be repeated from already visible concepts; contraction hides the branch
  again. Both keep the current zoom and pan position; use **Fit graph** when
  you want to see the entire projection.
- **Ctrl-click** on Windows/Linux or **Command-click** on macOS makes a concept
  the new focus. Keyboard users can use Ctrl/Command+Enter; Space toggles
  expansion.
- **Open selected** opens the selected concept note beside the graph and makes
  it the new graph focus. The viewer stays visible and an existing note pane is
  reused where possible. **Expand/Contract** performs the same disclosure action
  from the toolbar.
- **Fit graph** fits the current projection into the available pane. **Reload**
  reparses the vault. **Maximize/Restore view** toggles the graph between the
  right sidebar and a workspace-filling overlay.
- The active **Graph** tab identifies this as the graph view; no additional
  proprietary view is implied.

The viewer stays minimal and read-only: explore relationships, inspect their
properties, and navigate to concepts. Editing happens in the Markdown editor.
Its generic graph layout provides size-aware collision avoidance.

The OSS viewer for Obsidian and the web demo on **pgm.md** can share a rendering
core in [`src/graph-viewer.ts`](src/graph-viewer.ts). `PgmGraphViewer` receives
graph data and navigation through `GraphViewerHost`; it has no Obsidian runtime
dependency. [`src/main.ts`](src/main.ts) supplies the Obsidian adapter. A browser
host can use the same controller and [`styles.css`](styles.css).

Web hosts can mount [`renderMarkdownViewer`](src/markdown-viewer.ts) beside the
graph to show a note's original Markdown. Its close button or Escape calls the
host's `onClose` callback, which removes the pane and returns focus to the graph.

**Pegana on pegana.net is a separate, independent codebase.** Its proprietary
Graph-to-Mindmap editor, editing tools, and Inspector are outside this OSS
viewer. Code is shared within the OSS viewer, with no imports from Pegana.

For example:

```markdown
---
type: Person
name: Ada Lovelace
born: 1815
---

Worked with [Charles Babbage](charles-babbage.md "{type: collaborated_with, from: 1833}").
```

This small viewer focuses on local exploration. It is not a PGM conformance validator
and does not claim to implement every portable YAML value or diagnostic required
by the PGM 0.4 public draft. Use the reference parser from the
[PGM specification repository](https://github.com/property-graph-markdown/specification)
for validation and interchange. In particular, explicitly tagged YAML
timestamps are displayed through the host JavaScript `Date` representation and
therefore at millisecond precision.

## Install manually

1. Download `pgm-viewer-0.1.0.zip` from the GitHub release and extract it.
2. Copy the extracted `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/pgm-viewer/`.
3. In Obsidian, open **Settings → Community plugins**, reload installed plugins,
   and enable **PGM Viewer**.

The folder must directly contain `main.js`, `manifest.json`, and `styles.css`.
The same three files are also attached individually to every release.
Project and bundled-library terms are included in [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Explore Ada's graph

The repository and release ZIP include a complete, directly openable
[`example-vault`](example-vault/index.md). It is an exact release copy of the
canonical [PGM 0.4.0 Ada Demo Vault](https://github.com/property-graph-markdown/specification/tree/main/demo-vault):
46 Concept Nodes, 124 Relationship occurrences, and zero parser warnings. All
but one documented OKF compatibility relationship are typed, and useful link
properties are retained.

Use this canonical vault for the demo. Ada's initial local view contains Ada
and 41 directly connected concepts (42 nodes), with 57 incoming and outgoing
relationship occurrences. The vault contains 46 concepts overall; further
concepts can be reached by expanding or refocusing neighbouring nodes.

Obsidian plugins are installed per vault. Copy the three plugin files from the
release ZIP into `example-vault/.obsidian/plugins/pgm-viewer/`, then choose
**Open folder as vault**, select `example-vault`, explicitly enable **PGM
Viewer**, and open the graph view.

No `.obsidian` settings are committed, so opening the example does not replace
your preferences or silently enable community plugins. Historical-source and
content-license details travel with the vault in
[`ATTRIBUTION.txt`](example-vault/ATTRIBUTION.txt).

## Build and test

Node.js 20.19 or newer in the 20.x line, or Node.js 22.12 or newer, is required.

```sh
npm ci
npm test
npm run build
npm run package
```

`npm run package` creates `release/pgm-viewer-0.1.0.zip`. Development mode uses
`npm run dev`; stop the watcher with Ctrl-C.

## Release

Set the same version in `manifest.json`, `package.json`, and `versions.json`,
commit the generated lockfile, then push a numeric tag matching the version
exactly (for example `0.1.0`). GitHub Actions verifies, builds, attests, and
publishes the release assets.

## Scope and license

This repository is intended for `property-graph-markdown/obsidian-viewer` and
exists solely to make PGM easier to explore and review. The plugin source and
project files are available under the [MIT License](LICENSE). The copied Ada
Demo Vault has separate content attribution and licensing documented in
[`example-vault/ATTRIBUTION.txt`](example-vault/ATTRIBUTION.txt), including
CC BY-SA 4.0 terms for wording adapted from Wikipedia.
