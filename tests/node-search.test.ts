import { describe, expect, it } from "vitest";
import { graphMatches } from "../src/node-search";
import type { PgmEdge, PgmNode } from "../src/pgm";

function node(id: string, type: string, title: string): PgmNode {
  return { id, path: `${id}.md`, type, properties: { title } };
}

function edge(id: string, source: string, target: string, resolved = true): PgmEdge {
  return { id, source, target, resolved, text: "Ada", type: "Event", properties: {} };
}

const nodes = [
  node("person", "Person", "Ada Lovelace"),
  node("meeting", "Event", "1833 — Ada Meets Charles Babbage"),
  node("paper", "Event", "1842 — Menabrea's Paper Is Published"),
  node("translation", "Event", "1842–1843 — Ada Translates Menabrea's Paper"),
];

describe("graphMatches", () => {
  it("requires every keyword anywhere in the displayed title, independent of case and order", () => {
    expect([...graphMatches(nodes, [], "  BABBAGE\tEvent\nada ").nodeIds]).toEqual(["meeting"]);
    expect([...graphMatches(nodes, [], "Event Ada").nodeIds]).toEqual(["meeting", "translation"]);
    expect([...graphMatches(nodes, [], "ada event").nodeIds]).toEqual(["meeting", "translation"]);
    expect([...graphMatches(nodes, [], "lovel").nodeIds]).toEqual(["person"]);
  });

  it("includes the type prefix and its colon in the searchable title", () => {
    expect([...graphMatches(nodes, [], "EVENT:").nodeIds]).toEqual(["meeting", "paper", "translation"]);
    expect([...graphMatches(nodes, [], "event: ada").nodeIds]).toEqual(["meeting", "translation"]);
  });

  it("searches only the displayed title, using the same title, name, and basename fallback", () => {
    const titled = {
      ...node("hidden-id/Zephyr", "Thing", "Visible title"),
      properties: { title: "Visible title", name: "Hidden name", description: "secret property" },
    };
    const named = { ...node("hidden-path/named", "Thing", ""), properties: { name: "Readable name" } };
    const fallback = { ...node("hidden-path/visible-filename", "Thing", ""), properties: {} };
    const graph = [titled, named, fallback];

    for (const query of ["Zephyr", "hidden", "secret", "property"]) {
      expect([...graphMatches(graph, [], query).nodeIds]).toEqual([]);
    }
    expect([...graphMatches(graph, [], "visible title").nodeIds]).toEqual([titled.id]);
    expect([...graphMatches(graph, [], "readable name").nodeIds]).toEqual([named.id]);
    expect([...graphMatches(graph, [], "filename").nodeIds]).toEqual([fallback.id]);
  });

  it("normalizes equivalent Unicode spellings without treating keywords as regular expressions", () => {
    const accented = node("accented", "Place", "École (Paris)");
    expect([...graphMatches([accented], [], "e\u0301COLE (par").nodeIds]).toEqual(["accented"]);
    expect([...graphMatches([accented], [], ".*").nodeIds]).toEqual([]);
  });

  it("keeps all relationship occurrences only when both endpoint titles match", () => {
    const edges = [
      edge("both", "meeting", "translation"),
      edge("duplicate", "meeting", "translation"),
      edge("reverse", "translation", "meeting"),
      edge("self", "meeting", "meeting"),
      edge("source-only", "meeting", "paper"),
      edge("target-only", "paper", "meeting"),
      edge("other-type", "person", "meeting"),
      edge("unresolved", "meeting", "missing", false),
    ];
    const result = graphMatches(nodes, edges, "Event Ada");

    expect([...result.nodeIds]).toEqual(["meeting", "translation"]);
    expect([...result.edgeIds]).toEqual(["both", "duplicate", "reverse", "self"]);
  });

  it("returns the entire supplied projection for an empty query, including unresolved relationships", () => {
    const edges = [edge("resolved", "person", "meeting"), edge("unresolved", "person", "missing", false)];
    const snapshot = structuredClone({ nodes, edges });

    for (const query of ["", " \n\t "]) {
      const result = graphMatches(nodes, edges, query);
      expect([...result.nodeIds]).toEqual(nodes.map((current) => current.id));
      expect([...result.edgeIds]).toEqual(edges.map((current) => current.id));
    }
    graphMatches(nodes, edges, "Ada");
    expect({ nodes, edges }).toEqual(snapshot);
  });

  it("returns no nodes or relationships when titles do not match, without exposing neighbours", () => {
    const edges = [edge("hidden", "person", "meeting")];
    const result = graphMatches(nodes, edges, "unmatched");
    expect([...result.nodeIds]).toEqual([]);
    expect([...result.edgeIds]).toEqual([]);
  });
});
