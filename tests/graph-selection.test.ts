import { describe, expect, it } from "vitest";
import {
  mergeSelection,
  nodeIdsInMarquee,
  selectionKey,
  toggleSelection,
  type GraphSelectionItem,
} from "../src/graph-selection";
import type { PositionedPgmNode } from "../src/local-graph-layout";
import { NODE_RADIUS } from "../src/node-presentation";

const ada: GraphSelectionItem = { kind: "node", id: "people/ada" };
const charles: GraphSelectionItem = { kind: "node", id: "people/charles" };
const relationship: GraphSelectionItem = { kind: "edge", id: "ada:charles" };

function node(id: string, circleX: number, circleY: number, height = 112): PositionedPgmNode {
  return {
    id,
    path: `${id}.md`,
    type: "Person",
    properties: {},
    x: circleX,
    y: circleY + height / 2 - NODE_RADIUS,
    width: 272,
    height,
  };
}

describe("graph selection", () => {
  it("distinguishes node and relationship IDs even when their text matches", () => {
    const edge: GraphSelectionItem = { kind: "edge", id: ada.id };
    expect(selectionKey(ada)).not.toBe(selectionKey(edge));
    expect(mergeSelection([ada], [edge])).toEqual([ada, edge]);
    expect(toggleSelection([ada, edge], edge)).toEqual([ada]);
  });

  it("toggles a single item while preserving the other selected items and source snapshot", () => {
    const original = Object.freeze([ada, relationship]);
    const added = toggleSelection(original, charles);
    expect(added).toEqual([ada, relationship, charles]);
    expect(toggleSelection(added, ada)).toEqual([relationship, charles]);
    expect(original).toEqual([ada, relationship]);
  });

  it("adds marquee results in stable order without accumulating duplicates on repeated drags", () => {
    const original = Object.freeze([relationship, ada]);
    const result = mergeSelection(original, [ada, charles, charles]);
    expect(result).toEqual([relationship, ada, charles]);
    expect(mergeSelection(result, [charles, ada])).toEqual(result);
    expect(original).toEqual([relationship, ada]);
    expect(mergeSelection(result, [])).not.toBe(result);
  });
});

describe("marquee hit testing", () => {
  it("supports every drag direction and includes centres on the selection boundary", () => {
    const nodes = [node("top-left", -20, -10), node("bottom-right", 40, 70), node("outside", 41, 20)];
    for (const rect of [
      { x1: -20, y1: -10, x2: 40, y2: 70 },
      { x1: 40, y1: 70, x2: -20, y2: -10 },
      { x1: 40, y1: -10, x2: -20, y2: 70 },
      { x1: -20, y1: 70, x2: 40, y2: -10 },
    ]) {
      expect(nodeIdsInMarquee(nodes.values(), rect)).toEqual(["top-left", "bottom-right"]);
    }
  });

  it("uses the rendered circle centre independently of node width and wrapped title height", () => {
    const short = node("short", 200, 100);
    const long = { ...node("long", 200, 100, 400), width: 500 };
    const rect = { x1: 190, y1: 90, x2: 210, y2: 110 };
    expect(nodeIdsInMarquee([short, long], rect)).toEqual(["short", "long"]);
  });

  it("does not select nodes when only their circle edge or title intersects the marquee", () => {
    const long = node("long", 200, 100, 400);
    expect(nodeIdsInMarquee([long], { x1: 180, y1: 150, x2: 220, y2: 300 })).toEqual([]);
    expect(nodeIdsInMarquee([long], { x1: 215, y1: 80, x2: 250, y2: 120 })).toEqual([]);
    expect(nodeIdsInMarquee([], { x1: 0, y1: 0, x2: 100, y2: 100 })).toEqual([]);
  });
});
