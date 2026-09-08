# PGM Viewer for Obsidian

A quiet, single-purpose graph view for
[Property Graph Markdown](https://github.com/property-graph-markdown/specification)
vaults. Open it from the ribbon or run **PGM Viewer: Open graph view**.

PGM Viewer is independent, non-commercial free software. It contains no
telemetry, analytics, advertising, remote assets, update mechanism, or network
requests. Your Markdown stays in your vault.

## What it shows

- Every non-reserved `.md` concept with a non-empty string `type` in YAML
  frontmatter becomes a node.
- Every Markdown Concept Link becomes a directed relationship occurrence.
- A PGM 0.4 YAML flow-map link title supplies complete relationship properties;
  a non-empty string `type` is also shown as its relationship type.
- Every relationship type is written directly along its arrow. Labels stay
  deliberately quiet in dense graphs, then become clear on hover, keyboard
  focus, selection, or when connected to the selected concept. The documented
  compatibility edge without a type is honestly labelled `untyped`.
- Unresolved concept targets remain relationships and are drawn with a dashed
  line and hollow endpoint; the viewer does not invent a node for them.
- Search filters names, IDs, types, link text, and property values.
- Select a relationship to inspect it. Selecting a node opens its source note in
  a new tab.

For example:

```markdown
---
type: Person
name: Ada Lovelace
born: 1815
---

Worked with [Charles Babbage](charles-babbage.md "{type: collaborated_with, from: 1833}").
```

This small viewer focuses on inspection. It is not a PGM conformance validator
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
