import { editorLivePreviewField, type MarkdownPostProcessorContext } from "obsidian";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import {
  classifyPgmRelationshipLink,
  extractCommonMarkLinkSources,
  extractPgmRelationshipLinkSources,
  type PgmRelationshipLinkSource,
} from "./relationship-markdown";
import { appendRelationshipBadge, PgmRelationshipBadgeWidget } from "./relationship-badge-widget";
import { formatRelationshipTooltip } from "./relationship-tooltip";

export { PgmRelationshipBadgeWidget } from "./relationship-badge-widget";

/**
 * Markdown postprocessor callback for Reading View.
 *
 * Register this function directly with `registerMarkdownPostProcessor`. It
 * fails closed when Obsidian cannot provide the physical section source, so an
 * arbitrary HTML anchor with a YAML-looking title is never treated as PGM.
 */
export function renderPgmRelationshipBadges(
  root: HTMLElement,
  context: MarkdownPostProcessorContext,
): void {
  const section = context.getSectionInfo(root);
  if (!section) return;
  renderPgmRelationshipBadgesFromMarkdown(root, section.text);
}

/** Render canonical Relationship surfaces in an already-rendered Markdown section. */
export function renderPgmRelationshipBadgesFromMarkdown(
  root: HTMLElement,
  markdown: string,
): number {
  const sourceLinks = extractCommonMarkLinkSources(markdown);
  const renderedLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"));
  let renderedCursor = 0;
  let renderedCount = 0;

  for (const sourceLink of sourceLinks) {
    const renderedIndex = findRenderedLink(renderedLinks, sourceLink, renderedCursor);
    if (renderedIndex === -1) continue;
    renderedCursor = renderedIndex + 1;

    const relationship = classifyPgmRelationshipLink(sourceLink);
    const renderedLink = renderedLinks[renderedIndex];
    if (!relationship || !renderedLink || renderedLink.querySelector("img, svg")) continue;
    if (renderedLink.dataset.pgmRelationshipBadge === "true") continue;

    wrapRelationshipLabel(renderedLink);
    appendRelationshipBadge(
      renderedLink,
      relationship.type,
      formatRelationshipTooltip(relationship.properties),
    );
    renderedLink.classList.add("pgm-relationship-link");
    renderedLink.dataset.pgmRelationshipBadge = "true";
    renderedCount += 1;
  }

  return renderedCount;
}

function findRenderedLink(
  renderedLinks: readonly HTMLAnchorElement[],
  sourceLink: ReturnType<typeof extractCommonMarkLinkSources>[number],
  start: number,
): number {
  for (let index = start; index < renderedLinks.length; index += 1) {
    const rendered = renderedLinks[index];
    if (!rendered) continue;
    if (rendered.querySelector("img, svg")) continue;
    const readerLabel = rendered.textContent?.trim() ?? "";
    if (readerLabel !== sourceLink.renderedLabel.trim()) continue;
    if (!sameRenderedDestination(readableDestination(rendered), sourceLink.destination)) {
      continue;
    }

    const renderedTitle = rendered.getAttribute("title")?.trim() ?? "";
    if (renderedTitle && renderedTitle !== sourceLink.title.trim()) continue;
    return index;
  }
  return -1;
}

function readableDestination(link: HTMLAnchorElement): string {
  return link.dataset.href ?? link.getAttribute("href") ?? "";
}

function sameRenderedDestination(left: string, right: string): boolean {
  return destinationKey(left) === destinationKey(right);
}

function destinationKey(destination: string): string {
  const trimmed = destination.trim();
  const appUrl = /^app:\/\/obsidian\.md\/(.*)$/i.exec(trimmed);
  const withoutAppScheme = appUrl?.[1] ?? trimmed;
  const withoutLeadingSlash = withoutAppScheme.replace(/^\/+/, "");
  try {
    return decodeURIComponent(withoutLeadingSlash);
  } catch {
    return withoutLeadingSlash;
  }
}

function wrapRelationshipLabel(container: HTMLElement): void {
  const label = container.ownerDocument.createElement("span");
  label.className = "pgm-relationship-label";
  while (container.firstChild) label.appendChild(container.firstChild);
  container.appendChild(label);
}

interface MarkdownDocumentSnapshot {
  toString(): string;
}

type RelationshipSourceExtractor = (
  markdown: string,
) => readonly PgmRelationshipLinkSource[];

export class PgmRelationshipSourceCache {
  private document: MarkdownDocumentSnapshot | null = null;
  private sources: readonly PgmRelationshipLinkSource[] = [];

  constructor(
    private readonly extract: RelationshipSourceExtractor =
      extractPgmRelationshipLinkSources,
  ) {}

  forDocument(
    document: MarkdownDocumentSnapshot,
  ): readonly PgmRelationshipLinkSource[] {
    if (document === this.document) return this.sources;
    this.document = document;
    this.sources = this.extract(document.toString());
    return this.sources;
  }
}

export class PgmRelationshipBadgeViewPlugin {
  decorations: DecorationSet;
  private readonly sourceCache = new PgmRelationshipSourceCache();

  constructor(view: EditorView) {
    this.decorations = this.createDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.startState.field(editorLivePreviewField) !==
        update.state.field(editorLivePreviewField)
    ) {
      this.decorations = this.createDecorations(update.view);
    }
  }

  private createDecorations(view: EditorView): DecorationSet {
    if (!view.state.field(editorLivePreviewField)) return Decoration.none;
    return createPgmRelationshipBadgeDecorations(
      view,
      this.sourceCache.forDocument(view.state.doc),
    );
  }
}

/** Register this extension with `registerEditorExtension`. */
export const pgmRelationshipBadgeExtension = ViewPlugin.fromClass(
  PgmRelationshipBadgeViewPlugin,
  { decorations: (plugin) => plugin.decorations },
);

export function createPgmRelationshipBadgeDecorations(
  view: EditorView,
  sources: readonly PgmRelationshipLinkSource[] =
    extractPgmRelationshipLinkSources(view.state.doc.toString()),
): DecorationSet {
  if (!view.state.field(editorLivePreviewField)) return Decoration.none;

  const ranges: Range<Decoration>[] = [];
  for (const relationship of sources) {
    const { link } = relationship;
    if (view.state.selection.ranges.some((selection) => {
      if (selection.empty) {
        return selection.from >= link.start && selection.from <= link.end;
      }
      return selection.from < link.end && selection.to > link.start;
    })) {
      // Keeping the source untouched while the caret is in the link makes the
      // canonical Markdown directly editable without a custom editor surface.
      continue;
    }

    ranges.push(
      Decoration.replace({
        widget: new PgmRelationshipBadgeWidget(
          relationship.destination,
          relationship.link.renderedLabel,
          relationship.type,
          relationship.properties,
        ),
      }).range(link.start, link.end),
    );
  }
  return Decoration.set(ranges, true);
}
