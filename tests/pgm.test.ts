import { describe, expect, it } from "vitest";

import { parsePgmVault } from "../src/pgm";

function concept(type: string, body = "", extra = ""): string {
  return `---\ntype: ${type}\n${extra}---\n${body}`;
}

describe("parsePgmVault", () => {
  it("creates deterministic Nodes and retains complete frontmatter Properties", () => {
    const graph = parsePgmVault([
      {
        path: "people/Ada.md",
        content: concept(
          "Person",
          "# Ada Lovelace\n",
          "name: Ada Lovelace\nborn: 1815\ninterests: [mathematics, poetry]\n",
        ),
      },
      { path: "index.md", content: concept("Bundle") },
      { path: "nested/log.md", content: "log entry" },
      { path: "people/Upper.MD", content: concept("Person") },
      { path: "people/Charles.md", content: concept("Person", "", "name: Charles Babbage\n") },
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "people/Ada",
      "people/Charles",
    ]);
    expect(graph.nodes[0]).toEqual({
      id: "people/Ada",
      path: "people/Ada.md",
      type: "Person",
      properties: {
        type: "Person",
        name: "Ada Lovelace",
        born: 1815,
        interests: ["mathematics", "poetry"],
      },
    });
    expect(graph.diagnostics).toEqual([]);
  });

  it("requires non-reserved Concepts to have valid frontmatter and a non-empty string type", () => {
    const graph = parsePgmVault([
      { path: "empty.md", content: "---\ntype: \"\"\n---\n" },
      { path: "missing.md", content: "# No frontmatter" },
      { path: "number.md", content: "---\ntype: 7\n---\n" },
      { path: "bad//path.md", content: concept("Thing") },
      { path: "valid.md", content: concept("Thing") },
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual(["valid"]);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PGM_CONCEPT_PATH_INVALID",
      "PGM_CONCEPT_TYPE_INVALID",
      "PGM_FRONTMATTER_MISSING",
      "PGM_CONCEPT_TYPE_INVALID",
    ]);
  });

  it("turns each Concept Link occurrence into one directed edge and keeps unresolved targets", () => {
    const ada = [
      "[Babbage](Charles.md)",
      "[Babbage again](Charles.md#notes)",
      "[Engine](../machines/Engine.md)",
      "[London](/places/London.md)",
      "[Missing](Missing.md)",
      "![not a relationship](Diagram.md)",
      "[section](#notes)",
      "[web](https://example.org/Thing.md)",
      "[reserved](index.md)",
      "[wrong extension](Other.MD)",
    ].join("\n\n");

    const graph = parsePgmVault([
      { path: "people/Ada.md", content: concept("Person", ada) },
      { path: "people/Charles.md", content: concept("Person") },
      { path: "machines/Engine.md", content: concept("Design") },
      { path: "places/London.md", content: concept("Place") },
    ]);

    expect(graph.edges.map(({ id, source, target, resolved }) => ({ id, source, target, resolved }))).toEqual([
      {
        id: "pgm-edge:people%2FAda:0",
        source: "people/Ada",
        target: "people/Charles",
        resolved: true,
      },
      {
        id: "pgm-edge:people%2FAda:1",
        source: "people/Ada",
        target: "people/Charles",
        resolved: true,
      },
      {
        id: "pgm-edge:people%2FAda:2",
        source: "people/Ada",
        target: "machines/Engine",
        resolved: true,
      },
      {
        id: "pgm-edge:people%2FAda:3",
        source: "people/Ada",
        target: "places/London",
        resolved: true,
      },
      {
        id: "pgm-edge:people%2FAda:4",
        source: "people/Ada",
        target: "people/Missing",
        resolved: false,
      },
    ]);
    expect(graph.nodes.some((node) => node.id === "people/Missing")).toBe(false);
    expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
  });

  it("does not reinterpret Markdown-looking text inside CommonMark HTML blocks", () => {
    const graph = parsePgmVault([
      {
        path: "Source.md",
        content: concept(
          "Thing",
          "<div>\n[hidden](Hidden.md)\n</div>\n\n<span>[shown](Shown.md)</span>",
        ),
      },
      { path: "Hidden.md", content: concept("Thing") },
      { path: "Shown.md", content: concept("Thing") },
    ]);

    expect(graph.edges.map(({ source, target }) => ({ source, target }))).toEqual([
      { source: "Source", target: "Shown" },
    ]);
  });

  it("derives Relationship types from YAML Flow Mapping titles and retains all Properties", () => {
    const graph = parsePgmVault([
      {
        path: "Ada.md",
        content: concept(
          "Person",
          [
            `[Babbage](Babbage.md "{type: collaborated_with, since: 1833, active: true, evidence: [letters, notes]}")`,
            `[ordinary](Babbage.md "Charles Babbage")`,
            `[untyped](Babbage.md "{since: 1843}")`,
          ].join("\n"),
        ),
      },
      { path: "Babbage.md", content: concept("Person") },
    ]);

    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]).toMatchObject({
      source: "Ada",
      target: "Babbage",
      type: "collaborated_with",
      properties: {
        type: "collaborated_with",
        since: 1833,
        active: true,
        evidence: ["letters", "notes"],
      },
      text: "Babbage",
      resolved: true,
    });
    expect(graph.edges[1]?.properties).toEqual({});
    expect(graph.edges[1]?.type).toBeUndefined();
    expect(graph.edges[2]?.properties).toEqual({ since: 1843 });
    expect(graph.edges[2]?.type).toBeUndefined();
  });

  it("preserves edges when a PGM-looking title is invalid and retains an invalid type Property", () => {
    const graph = parsePgmVault([
      {
        path: "A.md",
        content: concept(
          "Thing",
          [
            `[broken](B.md "{type:")`,
            `[number type](B.md "{type: 7, weight: 0.5}")`,
            `[non-string key](B.md "{1: value}")`,
          ].join("\n"),
        ),
      },
      { path: "B.md", content: concept("Thing") },
    ]);

    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]?.properties).toEqual({});
    expect(graph.edges[1]?.properties).toEqual({ type: 7, weight: 0.5 });
    expect(graph.edges[1]?.type).toBeUndefined();
    expect(graph.edges[2]?.properties).toEqual({});
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PGM_RELATIONSHIP_TITLE_INVALID",
      "PGM_RELATIONSHIP_TYPE_INVALID",
      "PGM_RELATIONSHIP_TITLE_INVALID",
    ]);
  });

  it("applies CommonMark URI normalization before PGM destination resolution", () => {
    const body = [
      `[space](Ada%20Lovelace.md)`,
      `[malformed](Bad%ZZ.md)`,
      `[query](Other.md?revision=1)`,
      `[traversal](../../Outside.md)`,
      `[encoded slash](Bad%2FName.md)`,
    ].join("\n");
    const graph = parsePgmVault([
      { path: "people/Source.md", content: concept("Person", body) },
      { path: "people/Ada Lovelace.md", content: concept("Person") },
    ]);

    expect(graph.edges.map((edge) => edge.target)).toEqual([
      "people/Ada Lovelace",
      "people/Bad%ZZ",
    ]);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PGM_CONCEPT_DESTINATION_INVALID",
      "PGM_CONCEPT_DESTINATION_INVALID",
      "PGM_CONCEPT_DESTINATION_INVALID",
    ]);
  });

  it("returns the same ordered result regardless of input order", () => {
    const documents = [
      { path: "Z.md", content: concept("Thing", "[A](A.md)") },
      { path: "A.md", content: concept("Thing", "[Z](Z.md)") },
    ];

    expect(parsePgmVault(documents)).toEqual(parsePgmVault([...documents].reverse()));
  });

  it("accepts an initial UTF-8 BOM and CR-only line endings", () => {
    const graph = parsePgmVault([
      {
        path: "Legacy.md",
        content: "\uFEFF---\rtype: Person\rname: Ada\r---\r[Peer](Peer.md)",
      },
      { path: "Peer.md", content: concept("Person") },
    ]);

    expect(graph.nodes.find((node) => node.id === "Legacy")?.properties.name).toBe("Ada");
    expect(graph.edges).toMatchObject([{ source: "Legacy", target: "Peer", resolved: true }]);
  });

  it("keeps untagged dates as strings and supports explicitly tagged portable values", () => {
    const graph = parsePgmVault([{
      path: "Values.md",
      content: [
        "---",
        "type: Thing",
        "plainDate: 2026-08-23",
        "observed: !!timestamp 2026-08-23T10:30:00Z",
        "payload: !!binary SGVsbG8=",
        "exact: 9007199254740993",
        "members: !!set {Ada: null, Charles: null}",
        "lookup: {1: one, true: enabled}",
        "---",
      ].join("\n"),
    }]);
    const properties = graph.nodes[0]?.properties;

    expect(properties?.plainDate).toBe("2026-08-23");
    expect(properties?.observed).toBeInstanceOf(Date);
    expect((properties?.observed as Date).toISOString()).toBe("2026-08-23T10:30:00.000Z");
    expect(properties?.payload).toBeInstanceOf(Uint8Array);
    expect(Array.from(properties?.payload as Uint8Array)).toEqual([72, 101, 108, 108, 111]);
    expect(properties?.exact).toBe(9007199254740993n);
    expect(properties?.members).toEqual(new Set(["Ada", "Charles"]));
    expect(properties?.lookup).toEqual(new Map<unknown, unknown>([[1, "one"], [true, "enabled"]]));
  });

  it("diagnoses cyclic aliases and unsupported explicit tags", () => {
    const graph = parsePgmVault([
      {
        path: "Cycle.md",
        content: "---\ntype: Thing\ncycle: &cycle [*cycle]\n---\n",
      },
      {
        path: "Tag.md",
        content: "---\ntype: Thing\nvalue: !application/object no\n---\n",
      },
    ]);

    expect(graph.nodes).toEqual([]);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "PGM_YAML_VALUE_CYCLIC",
      "PGM_YAML_TAG_UNSUPPORTED",
    ]);
  });
});
