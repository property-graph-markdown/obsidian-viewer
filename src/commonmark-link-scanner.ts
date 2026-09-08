import MarkdownIt from "markdown-it";

export interface CommonMarkLinkSource {
  /** CommonMark-unescaped link label source. */
  label: string;
  /** Plain text emitted by CommonMark for the reader-facing link label. */
  renderedLabel: string;
  labelSource: string;
  destination: string;
  title: string;
  titleSource: string | null;
  titleStart: number | null;
  titleEnd: number | null;
  start: number;
  end: number;
  source: string;
}

const commonMark = new MarkdownIt("commonmark");

/** Apply the same URL normalization performed by markdown-it before parsing. */
export function normalizeCommonMarkLinkDestination(destination: string): string {
  return commonMark.normalizeLink(destination);
}

interface ScannedInlineLinkTail {
  destinationSource: string;
  destinationEnd: number;
  titleSource: string | null;
  titleStart: number | null;
  titleEnd: number | null;
  end: number;
}

function isCommonMarkWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function skipCommonMarkWhitespace(source: string, start: number): number {
  let cursor = start;
  while (isCommonMarkWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

function closingTitleDelimiter(opener: string): string | null {
  if (opener === "\"") return "\"";
  if (opener === "'") return "'";
  if (opener === "(") return ")";
  return null;
}

function findUnescapedDelimiter(
  source: string,
  start: number,
  delimiter: string,
): number {
  let slashCount = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "\\") {
      slashCount += 1;
      continue;
    }
    const escaped = slashCount % 2 === 1;
    slashCount = 0;
    if (character === delimiter && !escaped) return cursor;
  }
  return -1;
}

function scanBareLinkDestination(source: string, start: number): number {
  let depth = 0;
  let slashCount = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "\\") {
      slashCount += 1;
      continue;
    }
    const escaped = slashCount % 2 === 1;
    slashCount = 0;
    if (escaped) continue;
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      if (depth === 0) return cursor;
      depth -= 1;
      continue;
    }
    if (depth === 0 && isCommonMarkWhitespace(character)) return cursor;
  }
  return -1;
}

function scanInlineLinkTail(
  source: string,
  closingLabel: number,
): ScannedInlineLinkTail | null {
  if (source[closingLabel + 1] !== "(") return null;
  const contentStart = closingLabel + 2;
  let cursor = skipCommonMarkWhitespace(source, contentStart);
  let destinationSource = "";
  let destinationEnd = contentStart;

  if (source[cursor] === "<") {
    const destinationStart = cursor + 1;
    const closingDestination = findUnescapedDelimiter(source, destinationStart, ">");
    if (closingDestination < 0) return null;
    destinationSource = source.slice(destinationStart, closingDestination);
    destinationEnd = closingDestination;
    cursor = closingDestination + 1;
  } else {
    const hasLeadingWhitespace = cursor > contentStart;
    const emptyDestination =
      source[cursor] === ")" ||
      (hasLeadingWhitespace && closingTitleDelimiter(source[cursor] ?? "") !== null);
    if (emptyDestination) {
      cursor = contentStart;
    } else {
      const destinationStart = cursor;
      const scannedEnd = scanBareLinkDestination(source, destinationStart);
      if (scannedEnd < 0) return null;
      destinationSource = source.slice(destinationStart, scannedEnd);
      destinationEnd = scannedEnd;
      cursor = scannedEnd;
    }
  }

  if (source[cursor] === ")") {
    return {
      destinationSource,
      destinationEnd,
      titleSource: null,
      titleStart: null,
      titleEnd: null,
      end: cursor + 1,
    };
  }

  const titleSeparatorStart = cursor;
  cursor = skipCommonMarkWhitespace(source, cursor);
  if (cursor === titleSeparatorStart) return null;
  if (source[cursor] === ")") {
    return {
      destinationSource,
      destinationEnd,
      titleSource: null,
      titleStart: null,
      titleEnd: null,
      end: cursor + 1,
    };
  }

  const titleCloser = closingTitleDelimiter(source[cursor] ?? "");
  if (!titleCloser) return null;
  const titleStart = cursor + 1;
  const titleEnd = findUnescapedDelimiter(source, titleStart, titleCloser);
  if (titleEnd < 0) return null;
  cursor = skipCommonMarkWhitespace(source, titleEnd + 1);
  if (source[cursor] !== ")") return null;
  return {
    destinationSource,
    destinationEnd,
    titleSource: source.slice(titleStart, titleEnd),
    titleStart,
    titleEnd,
    end: cursor + 1,
  };
}

interface BacktickRun {
  start: number;
  end: number;
  length: number;
  escapedOpener: boolean;
  inlineBlock: number | null;
}

interface CommonMarkInlineBlockRange {
  readonly start: number;
  readonly end: number;
}

function matchedCodeSpanEnds(
  source: string,
  inlineBlocks: readonly CommonMarkInlineBlockRange[],
): ReadonlyMap<number, number> {
  const runs: BacktickRun[] = [];
  let inlineBlock = 0;
  for (let cursor = 0; cursor < source.length; ) {
    if (source[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (source[cursor] === "`") cursor += 1;
    let slashCount = 0;
    for (let slash = start - 1; slash >= 0 && source[slash] === "\\"; slash -= 1) {
      slashCount += 1;
    }
    while (
      inlineBlock < inlineBlocks.length &&
      (inlineBlocks[inlineBlock]?.end ?? 0) <= start
    ) {
      inlineBlock += 1;
    }
    const block = inlineBlocks[inlineBlock];
    runs.push({
      start,
      end: cursor,
      length: cursor - start,
      escapedOpener: slashCount % 2 === 1,
      inlineBlock:
        block && start >= block.start && start < block.end ? inlineBlock : null,
    });
  }

  const nextRunsByBlock = new Map<number, Map<number, BacktickRun>>();
  const matchedEnds = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run || run.inlineBlock === null) continue;
    const nextRunByLength = nextRunsByBlock.get(run.inlineBlock) ?? new Map();
    const closingRun = nextRunByLength.get(run.length);
    // Backslash escapes prevent a run from opening code at the inline-parser
    // cursor. Inside an open code span, the same run can close it.
    if (closingRun && !run.escapedOpener) matchedEnds.set(run.start, closingRun.end);
    nextRunByLength.set(run.length, run);
    nextRunsByBlock.set(run.inlineBlock, nextRunByLength);
  }
  return matchedEnds;
}

function escapedMarkdownCharacterEnd(source: string, start: number): number | null {
  if (source[start] !== "\\") return null;
  let cursor = start;
  while (source[cursor] === "\\") cursor += 1;
  const slashCount = cursor - start;
  if (
    slashCount % 2 === 1 &&
    /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[cursor] ?? "")
  ) {
    return cursor + 1;
  }
  return cursor;
}

function potentialInlineHtmlEnd(
  source: string,
  start: number,
  lastSpecialTerminatorStarts: ReadonlyMap<string, number>,
): number | null {
  const terminator = source.startsWith("<!--", start)
    ? "-->"
    : source.startsWith("<![CDATA[", start)
      ? "]]>"
      : source.startsWith("<?", start)
        ? "?>"
        : null;
  if (terminator) {
    if ((lastSpecialTerminatorStarts.get(terminator) ?? -1) < start + 2) return null;
    const end = source.indexOf(terminator, start + 2);
    return end < 0 ? null : end + terminator.length;
  }

  if (!/[A-Za-z!?/]/.test(source[start + 1] ?? "")) return null;

  let quote: "\"" | "'" | null = null;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "<") return null;
    if (character === ">") return cursor + 1;
    if (character === "\n" || character === "\r") return null;
  }
  return null;
}

function standaloneCommonMarkInlineHtmlEnd(
  source: string,
  start: number,
  lastSpecialTerminatorStarts: ReadonlyMap<string, number>,
): number | null {
  const end = potentialInlineHtmlEnd(source, start, lastSpecialTerminatorStarts);
  if (end === null) return null;
  const inline = commonMark.parseInline(source.slice(start, end), {})[0];
  const children = inline?.children ?? [];
  return children.length === 1 && children[0]?.type === "html_inline" ? end : null;
}

interface CommonMarkInlineToken {
  readonly type: string;
  readonly content: string;
  readonly children: CommonMarkInlineToken[] | null;
  attrGet(name: string): string | null;
}

interface ParsedCommonMarkLink {
  readonly href: string;
  readonly title: string;
  readonly renderedLabel: string;
}

interface ParsedCommonMarkDocument {
  readonly links: ParsedCommonMarkLink[];
  readonly inlineBlocks: CommonMarkInlineBlockRange[];
}

function renderedCommonMarkInlineText(tokens: readonly CommonMarkInlineToken[]): string {
  let result = "";
  for (const token of tokens) {
    if (token.type === "text" || token.type === "code_inline") {
      result += token.content;
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      result += "\n";
    } else if (token.type === "image" && token.children) {
      result += renderedCommonMarkInlineText(token.children);
    }
  }
  return result;
}

function markdownLineStarts(markdown: string): number[] {
  const starts = [0];
  for (let cursor = 0; cursor < markdown.length; cursor += 1) {
    if (markdown[cursor] === "\n") starts.push(cursor + 1);
  }
  return starts;
}

function parsedCommonMarkDocument(markdown: string): ParsedCommonMarkDocument {
  const links: ParsedCommonMarkLink[] = [];
  const inlineBlocks: CommonMarkInlineBlockRange[] = [];
  const lineStarts = markdownLineStarts(markdown);
  for (const block of commonMark.parse(markdown, {})) {
    if (block.type === "inline" && block.map) {
      const start = lineStarts[block.map[0]];
      const end = lineStarts[block.map[1]] ?? markdown.length;
      if (start !== undefined && end >= start) inlineBlocks.push({ start, end });
    }
    const children = block.children as CommonMarkInlineToken[] | null;
    if (!children) continue;
    for (let index = 0; index < children.length; index += 1) {
      const opener = children[index];
      if (!opener || opener.type !== "link_open") continue;
      let depth = 1;
      let closingIndex = index + 1;
      for (; closingIndex < children.length; closingIndex += 1) {
        const token = children[closingIndex];
        if (token?.type === "link_open") depth += 1;
        else if (token?.type === "link_close") depth -= 1;
        if (depth === 0) break;
      }
      if (depth !== 0) continue;
      links.push({
        href: opener.attrGet("href") ?? "",
        title: opener.attrGet("title") ?? "",
        renderedLabel: renderedCommonMarkInlineText(
          children.slice(index + 1, closingIndex),
        ),
      });
      index = closingIndex;
    }
  }
  inlineBlocks.sort((left, right) => left.start - right.start || left.end - right.end);
  return { links, inlineBlocks };
}

/**
 * Return physical source ranges for CommonMark inline links.
 *
 * markdown-it deliberately does not expose inline character offsets. The
 * scanner first finds possible `](` tails, then validates all candidates with
 * one marker-probe parse. This keeps code, HTML, images and malformed syntax
 * from being decorated as Relationships.
 */
export function extractCommonMarkLinkSources(text: string): CommonMarkLinkSource[] {
  const candidates: Array<{
    readonly start: number;
    readonly closingLabel: number;
    readonly tail: ScannedInlineLinkTail;
    readonly marker: string;
  }> = [];
  const openLabels: number[] = [];
  const originalDocument = parsedCommonMarkDocument(text);
  const codeSpanEnds = matchedCodeSpanEnds(text, originalDocument.inlineBlocks);
  const lastSpecialTerminatorStarts = new Map([
    ["-->", text.lastIndexOf("-->")],
    ["]]>", text.lastIndexOf("]]>")],
    ["?>", text.lastIndexOf("?>")],
  ]);

  for (let cursor = 0; cursor < text.length; ) {
    const escapedEnd = escapedMarkdownCharacterEnd(text, cursor);
    if (escapedEnd !== null) {
      cursor = escapedEnd;
      continue;
    }
    if (text[cursor] === "`") {
      const codeSpanEnd = codeSpanEnds.get(cursor);
      if (codeSpanEnd !== undefined) {
        cursor = codeSpanEnd;
        continue;
      }
      while (text[cursor] === "`") cursor += 1;
      continue;
    }
    if (text[cursor] === "<") {
      const htmlEnd = standaloneCommonMarkInlineHtmlEnd(
        text,
        cursor,
        lastSpecialTerminatorStarts,
      );
      if (htmlEnd !== null) {
        cursor = htmlEnd;
        continue;
      }
    }
    if (text[cursor] === "[") {
      openLabels.push(cursor);
      cursor += 1;
      continue;
    }
    if (text[cursor] !== "]") {
      cursor += 1;
      continue;
    }

    const closingLabel = cursor;
    const start = openLabels.pop();
    if (start === undefined || text[closingLabel + 1] !== "(") {
      cursor += 1;
      continue;
    }
    const tail = scanInlineLinkTail(text, closingLabel);
    if (!tail) {
      cursor += 1;
      continue;
    }
    candidates.push({
      start,
      closingLabel,
      tail,
      marker: `#pgm-owner-${candidates.length}`,
    });
    cursor = tail.end;
  }
  if (candidates.length === 0) return [];

  let cursor = 0;
  const probeParts: string[] = [];
  for (const candidate of candidates) {
    probeParts.push(text.slice(cursor, candidate.tail.destinationEnd), candidate.marker);
    cursor = candidate.tail.destinationEnd;
  }
  probeParts.push(text.slice(cursor));
  const originalLinks = originalDocument.links;
  const probeLinks = parsedCommonMarkDocument(probeParts.join("")).links;
  if (probeLinks.length !== originalLinks.length) return [];

  const renderedLabels = new Map<number, string>();
  for (let linkIndex = 0; linkIndex < probeLinks.length; linkIndex += 1) {
    const original = originalLinks[linkIndex];
    const probe = probeLinks[linkIndex];
    if (!original || !probe) return [];
    const markerMatch = /#pgm-owner-(\d+)$/.exec(probe.href);
    if (!markerMatch) continue;
    const candidateIndexSource = markerMatch[1];
    if (candidateIndexSource === undefined) continue;
    const candidateIndex = Number(candidateIndexSource);
    const candidate = candidates[candidateIndex];
    if (
      !candidate ||
      probe.href !== original.href + candidate.marker ||
      probe.title !== original.title ||
      probe.renderedLabel !== original.renderedLabel
    ) {
      continue;
    }
    renderedLabels.set(candidateIndex, original.renderedLabel);
  }

  const links: CommonMarkLinkSource[] = [];
  candidates.forEach((candidate, index) => {
    if (!renderedLabels.has(index)) return;
    const { start, closingLabel, tail } = candidate;
    const labelSource = text.slice(start + 1, closingLabel);
    links.push({
      label: commonMark.utils.unescapeAll(labelSource),
      renderedLabel: renderedLabels.get(index) ?? "",
      labelSource,
      destination: commonMark.utils.unescapeAll(tail.destinationSource),
      title: commonMark.utils.unescapeAll(tail.titleSource ?? ""),
      titleSource: tail.titleSource,
      titleStart: tail.titleStart,
      titleEnd: tail.titleEnd,
      start,
      end: tail.end,
      source: text.slice(start, tail.end),
    });
  });
  return links;
}
