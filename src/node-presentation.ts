import type { PgmNode } from "./pgm";

/** Shared geometry keeps the renderer and collision detection in agreement. */
export const NODE_WIDTH = 272;
export const NODE_RADIUS = 36;
export const NODE_LABEL_TOP = 60;
export const NODE_MIN_HEIGHT = 112;
export const NODE_LABEL_LINE_HEIGHT = 32;
const LABEL_FONT_SCALE = 23 / 13;
const LABEL_WIDTH = NODE_WIDTH - 36;
const LABEL_VERTICAL_PADDING = 20;
// A bounded palette avoids almost-identical adjacent hues. Types remain
// visible in the label as well, including when two types share a colour.
const TYPE_COLORS = [
  "#3f81cc", "#bc861f", "#c35980", "#8b5fc7", "#29958b", "#c46c3a",
  "#5c944b", "#5970b5", "#bb5670", "#8d7a48", "#527f94", "#aa643e",
];

export interface NodePresentation {
  readonly width: number;
  readonly height: number;
  readonly lines: string[];
  readonly color: string;
}

/** Prefer the readable title, then a name, before falling back to the ID. */
export function nodeLabel(node: PgmNode): string {
  for (const key of ["title", "name"]) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  const segments = node.id.split("/");
  return segments[segments.length - 1] ?? node.id;
}

export function nodeTitle(node: PgmNode): string {
  return `${node.type}: ${nodeLabel(node)}`;
}

/** No DOM measurement is needed, so layout also works before the pane opens. */
export function nodePresentation(node: PgmNode): NodePresentation {
  const lines = wrapLabel(nodeTitle(node));
  return {
    width: NODE_WIDTH,
    height: Math.max(NODE_MIN_HEIGHT, NODE_LABEL_TOP + lines.length * NODE_LABEL_LINE_HEIGHT + LABEL_VERTICAL_PADDING),
    lines,
    color: typeColor(node.type),
  };
}

function typeColor(type: string): string {
  // Type spelling is significant in PGM. Hash only the type, never its order
  // in a particular projection, so its colour survives search and refocusing.
  const normalized = type.normalize("NFC");
  let hash = 2_166_136_261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  // Mix high and low bits before reducing the hash to a small palette.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return TYPE_COLORS[(hash >>> 0) % TYPE_COLORS.length] ?? "#3f81cc";
}

function wrapLabel(value: string): string[] {
  const words = value.trim().split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;

  for (const word of words) {
    const glyphs = graphemes(word);
    const wordWidth = glyphs.reduce((width, glyph) => width + glyphWidth(glyph), 0);
    if (line && lineWidth + glyphWidth(" ") + wordWidth <= LABEL_WIDTH) {
      line += ` ${word}`;
      lineWidth += glyphWidth(" ") + wordWidth;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    lineWidth = 0;

    // Long filenames, URLs, CJK text, and other unspaced titles must wrap too.
    // Split only between graphemes so accents and emoji sequences stay intact.
    for (const glyph of glyphs) {
      const width = glyphWidth(glyph);
      if (line && lineWidth + width > LABEL_WIDTH) {
        lines.push(line);
        line = "";
        lineWidth = 0;
      }
      line += glyph;
      lineWidth += width;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};
const Segmenter = (Intl as typeof Intl & {
  Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;
}).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

export function graphemes(value: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(value), ({ segment }) => segment);
  // Fallback for older hosts: preserve surrogate pairs, combining marks, and
  // joiner sequences even without Intl.Segmenter.
  const result: string[] = [];
  for (const character of value) {
    const previous = result[result.length - 1];
    if (previous && (/^[\p{Mark}\u200d\ufe0e\ufe0f\u{1f3fb}-\u{1f3ff}]$/u.test(character) || previous.endsWith("\u200d"))) {
      result[result.length - 1] = previous + character;
    } else {
      result.push(character);
    }
  }
  return result;
}

/** Scale the conservative 13px glyph estimates to the 23px UI font. */
function glyphWidth(glyph: string): number {
  if (/^\s$/u.test(glyph)) return 4 * LABEL_FONT_SCALE;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff01-\uff60]/u.test(glyph)) return 15 * LABEL_FONT_SCALE;
  const letter = glyph.normalize("NFD").replace(/\p{Mark}/gu, "");
  if (/^[ilIjt.,:;'!|`\[\]()]$/u.test(letter)) return 4.5 * LABEL_FONT_SCALE;
  if (/^[MW@%&#]$/u.test(letter)) return 12 * LABEL_FONT_SCALE;
  if (/^[A-Z]$/u.test(letter)) return 9.5 * LABEL_FONT_SCALE;
  // Unknown scripts receive a full em rather than an optimistic Latin width.
  return (/^[a-z0-9_\-/\\?+=<>]$/u.test(letter) ? 8 : 13) * LABEL_FONT_SCALE;
}
