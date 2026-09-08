import { describe, expect, it } from "vitest";

import { parsePgmVault } from "../src/pgm";
import {
  classifyPgmRelationshipLink,
  extractCommonMarkLinkSources,
  extractPgmRelationshipLinkSources,
  isPgmMarkdownDestination,
} from "../src/relationship-markdown";

describe("PGM Relationship Markdown", () => {
  it("reports exact CommonMark source ranges and rendered labels", () => {
    const relationship =
      `[Ada *Lovelace*](../people/Ada%20Lovelace.md#work "{type: inspired_by, since: 1843}")`;
    const markdown = `Before ${relationship} after.`;

    const links = extractCommonMarkLinkSources(markdown);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      renderedLabel: "Ada Lovelace",
      destination: "../people/Ada%20Lovelace.md#work",
      title: "{type: inspired_by, since: 1843}",
      start: "Before ".length,
      end: "Before ".length + relationship.length,
      source: relationship,
    });
    expect(markdown.slice(links[0]?.start, links[0]?.end)).toBe(relationship);
  });

  it("does not scan link-shaped text that CommonMark keeps opaque", () => {
    const canonical = `[Visible](Visible.md "{type: sees}")`;
    const markdown = [
      `\`[inline](Inline.md "{type: hidden}")\``,
      "```md",
      `[fenced](Fenced.md "{type: hidden}")`,
      "```",
      `![image](Image.md "{type: hidden}")`,
      `<span data-copy='[html](Html.md "{type: hidden}")'>raw</span>`,
      canonical,
    ].join("\n\n");

    expect(extractCommonMarkLinkSources(markdown).map((link) => link.source)).toEqual([
      canonical,
    ]);
  });

  it("classifies only typed local lowercase-.md links", () => {
    const markdown = [
      `[typed](Target.md "{type: collaborated_with, since: 1833}")`,
      `[ordinary](Target.md "Charles Babbage")`,
      `[untyped](Target.md "{since: 1833}")`,
      `[bad type](Target.md "{type: 7}")`,
      `[external](https://example.test/Target.md "{type: cites}")`,
      `[uppercase](Target.MD "{type: cites}")`,
      `[reserved](index.md "{type: cites}")`,
    ].join("\n");

    const relationships = extractPgmRelationshipLinkSources(markdown);

    expect(relationships).toHaveLength(1);
    expect(relationships[0]).toMatchObject({
      destination: "Target.md",
      type: "collaborated_with",
      properties: { type: "collaborated_with", since: 1833 },
    });
  });

  it("uses the graph parser's Relationship-title semantics", () => {
    const source = `[Peer](Peer.md "{type: knows, confidence: 0.75, evidence: [a, b]}")`;
    const scanned = extractCommonMarkLinkSources(source)[0];
    expect(scanned).toBeDefined();
    const classified = scanned ? classifyPgmRelationshipLink(scanned) : null;
    const graph = parsePgmVault([
      { path: "Source.md", content: `---\ntype: Person\n---\n${source}` },
      { path: "Peer.md", content: "---\ntype: Person\n---\n" },
    ]);

    expect(classified?.type).toBe(graph.edges[0]?.type);
    expect(classified?.properties).toEqual(graph.edges[0]?.properties);
  });

  it("recognizes fragments and encoded filenames without widening PGM links", () => {
    expect(isPgmMarkdownDestination("../people/Ada%20Lovelace.md#work")).toBe(true);
    expect(isPgmMarkdownDestination("/people/Ada.md")).toBe(true);
    expect(isPgmMarkdownDestination("people/literal%.md")).toBe(true);
    expect(isPgmMarkdownDestination("#work")).toBe(false);
    expect(isPgmMarkdownDestination("Ada.md?revision=1")).toBe(false);
    expect(isPgmMarkdownDestination("mailto:Ada.md")).toBe(false);
    expect(isPgmMarkdownDestination("log.md")).toBe(false);
  });

  it.each([
    "folder%2Fnested/Target.md",
    "folder/%5CTarget.md",
    "folder/%00Target.md",
    "folder/%7FTarget.md",
    "folder/%FFTarget.md",
  ])("rejects a parser-invalid encoded path segment: %s", (destination) => {
    const relationship = `[Target](${destination} "{type: cites}")`;
    const graph = parsePgmVault([
      {
        path: "Source.md",
        content: `---\ntype: Person\n---\n${relationship}`,
      },
    ]);

    expect(isPgmMarkdownDestination(destination)).toBe(false);
    expect(extractPgmRelationshipLinkSources(relationship)).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PGM_CONCEPT_DESTINATION_INVALID" }),
    );
  });
});
