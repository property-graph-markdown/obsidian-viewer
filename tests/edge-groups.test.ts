import { describe, expect, it } from "vitest";

import { groupEdges } from "../src/edge-groups";
import type { PgmEdge } from "../src/pgm";

function edge(id: string, source: string, target: string, type?: string): PgmEdge {
  const result: PgmEdge = { id, source, target, text: id, properties: {}, resolved: true };
  if (type !== undefined) result.type = type;
  return result;
}

describe("groupEdges", () => {
  it("bundles reciprocal and repeated typed occurrences into one visual pair", () => {
    const edges = [
      edge("third", "z", "a", "knows"),
      edge("first", "a", "z", "knows"),
      edge("second", "a", "z", "works_with"),
    ];
    const groups = groupEdges(edges);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: '["a","z"]', source: "a", target: "z", forward: true, reverse: true,
      types: ["knows", "works_with"],
    });
    expect(groups[0]!.relationships.map(({ id }) => id)).toEqual(["first", "second", "third"]);
  });

  it("preserves every ID, separate property map, authored value and exact duplicate", () => {
    const first = edge("one", "a", "b", " related_to ");
    first.title = "{type: related_to, weight: 3}";
    first.properties = {
      type: "related_to", weight: 3, since: new Date("2020-01-01T00:00:00Z"),
      entries: new Map<string, unknown>([["count", 9007199254740993n]]),
    };
    const second = edge("two", "a", "b", "related_to");
    second.properties = { type: "related_to", weight: 9, tags: new Set(["separate"]) };
    const input = [second, first, first];
    const original = structuredClone(input);
    const group = groupEdges(input)[0]!;

    expect(group.types).toEqual(["related_to"]);
    expect(group.relationships).toHaveLength(3);
    expect(group.relationships[0]).toBe(first);
    expect(group.relationships[1]).toBe(first);
    expect(group.relationships[2]).toBe(second);
    expect(group.relationships[0]!.properties).toBe(first.properties);
    expect(group.relationships[2]!.properties).toBe(second.properties);
    expect(input).toEqual(original);
  });

  it("reports reverse-only orientation relative to the lexicographic group endpoints", () => {
    const group = groupEdges([edge("back", "z", "a", "references")])[0]!;

    expect(group.source).toBe("a");
    expect(group.target).toBe("z");
    expect(group.forward).toBe(false);
    expect(group.reverse).toBe(true);
  });

  it("keeps self loops in one group with forward direction only", () => {
    const groups = groupEdges([edge("loop-two", "self", "self", "checks"), edge("loop-one", "self", "self", "checks")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: '["self","self"]', source: "self", target: "self",
      types: ["checks"], forward: true, reverse: false,
    });
    expect(groups[0]!.relationships).toHaveLength(2);
  });

  it("deduplicates missing and blank display types as untyped without changing authored types", () => {
    const input = [edge("absent", "a", "b"), edge("empty", "a", "b", ""), edge("space", "a", "b", " \t\n"), edge("typed", "a", "b", " knows ")];
    const group = groupEdges(input)[0]!;

    expect(group.types).toEqual(["knows", "untyped"]);
    expect(group.relationships).toHaveLength(4);
    expect(input.map(({ type }) => type)).toEqual([undefined, "", " \t\n", " knows "]);
  });

  it("keeps the existing source ahead of an unresolved target even when it sorts later", () => {
    const first = { ...edge("missing-one", "z-existing", "a-missing", "references"), resolved: false };
    const second = { ...edge("missing-two", "z-existing", "a-missing"), resolved: false };
    const group = groupEdges([second, first])[0]!;

    expect(group).toMatchObject({
      id: '["a-missing","z-existing"]', source: "z-existing", target: "a-missing",
      forward: true, reverse: false, types: ["references", "untyped"],
    });
    expect(group.relationships.every(({ resolved }) => !resolved)).toBe(true);
  });

  it("uses collision-free tuple IDs for concept names containing delimiters and punctuation", () => {
    const groups = groupEdges([
      edge("one", "a|b", "c"), edge("two", "a", "b|c"),
      edge("three", 'a","b', "c"), edge("four", "a", 'b","c'),
    ]);

    expect(groups).toHaveLength(4);
    expect(new Set(groups.map(({ id }) => id)).size).toBe(4);
    for (const group of groups) expect(JSON.parse(group.id)).toEqual([group.source, group.target]);
  });

  it("returns stable groups, occurrences, display types and flags independent of input order", () => {
    const input = [
      edge("b", "z", "a", "mentions"), edge("a", "a", "z", "knows"),
      edge("c", "other", "other"),
      { ...edge("d", "present", "absent", "links_to"), resolved: false },
    ];
    const snapshot = structuredClone(input);

    expect(groupEdges(input.slice().reverse())).toEqual(groupEdges(input));
    expect(input).toEqual(snapshot);
    expect(groupEdges([])).toEqual([]);
  });
});
