import { describe, expect, it } from "vitest";

import {
  NODE_LABEL_LINE_HEIGHT,
  NODE_MIN_HEIGHT,
  NODE_WIDTH,
  nodeLabel,
  nodePresentation,
  nodeTitle,
} from "../src/node-presentation";
import type { PgmNode } from "../src/pgm";

function node(name: unknown, type = "Person"): PgmNode {
  return { id: "people/ada", path: "people/ada.md", type, properties: { name, type } };
}

describe("node presentation", () => {
  it("uses the note title before its name or filename", () => {
    const titled = { ...node("Ada"), properties: { title: "Ada Lovelace", name: "Ada" } };
    expect(nodeTitle(titled)).toBe("Person: Ada Lovelace");
    for (const title of [undefined, null, "", "  ", 1815]) {
      expect(nodeLabel({ ...titled, properties: { title, name: "Ada" } })).toBe("Ada");
    }
  });

  it("keeps the name fallback and prefixes the type inline", () => {
    expect(nodeLabel(node("Ada Lovelace"))).toBe("Ada Lovelace");
    expect(nodeTitle(node("Ada Lovelace"))).toBe("Person: Ada Lovelace");
    expect(nodePresentation(node("Ada")).lines).toEqual(["Person: Ada"]);
    for (const name of [undefined, null, "", 1815]) {
      expect(nodeLabel(node(name))).toBe("ada");
      expect(nodeTitle(node(name))).toBe("Person: ada");
    }
  });

  it("wraps long titles completely and reserves enough vertical space", () => {
    const title = "A very long concept title that needs several lines without hiding any words";
    const presentation = nodePresentation(node(title));
    expect(presentation.lines.length).toBeGreaterThan(2);
    expect(presentation.lines.join(" ")).toBe(`Person: ${title}`);
    expect(presentation.width).toBe(NODE_WIDTH);
    expect(presentation.height).toBeGreaterThan(NODE_MIN_HEIGHT);
    expect(presentation.height).toBeGreaterThan(presentation.lines.length * NODE_LABEL_LINE_HEIGHT);
    expect(nodePresentation(node("Ada")).height).toBe(NODE_MIN_HEIGHT);
  });

  it("wraps unbroken text, CJK, and emoji without losing or breaking characters", () => {
    const cluster = "👩🏽‍💻";
    for (const title of ["W".repeat(150), "漢字仮名交じり文".repeat(12), cluster.repeat(40), "e\u0301".repeat(150)]) {
      const presentation = nodePresentation(node(title, "Concept"));
      expect(presentation.lines.length).toBeGreaterThan(2);
      expect(presentation.lines.join("").replace(/ /gu, "")).toBe(`Concept:${title}`);
      expect(presentation.lines.every((line) => !/^[\p{Mark}\u200d\u{1f3fb}-\u{1f3ff}]/u.test(line))).toBe(true);
      expect(presentation.lines.every((line) => !line.endsWith("\u200d"))).toBe(true);
    }
    const emojiLines = nodePresentation(node(cluster.repeat(40), "Concept")).lines.slice(1);
    expect(emojiLines.every((line) => line.replaceAll(cluster, "") === "")).toBe(true);
  });

  it("estimates wide glyphs separately from narrow text", () => {
    const wide = nodePresentation(node("W".repeat(100)));
    const narrow = nodePresentation(node("i".repeat(100)));
    expect(wide.lines.length).toBeGreaterThan(narrow.lines.length);
    expect(wide.height).toBeGreaterThan(narrow.height);
  });

  it("keeps each type's colour stable across nodes and repeated renders", () => {
    const first = nodePresentation(node("Ada Lovelace"));
    expect(nodePresentation(node("Charles Babbage")).color).toBe(first.color);
    expect(nodePresentation(node("Ada Lovelace")).color).toBe(first.color);
    expect(nodePresentation(node("Royal Society", "Organization")).color).not.toBe(first.color);
    expect(nodePresentation(node("Conference", "Event")).color).not.toBe(first.color);
    expect(nodePresentation(node("Example", "Cafe\u0301")).color).toBe(nodePresentation(node("Example", "Café")).color);
  });
});
