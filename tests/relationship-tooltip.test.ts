import { describe, expect, it } from "vitest";

import { extractPgmRelationshipLinkSources } from "../src/relationship-markdown";
import { formatRelationshipTooltip, relationshipPropertyRows } from "../src/relationship-tooltip";

describe("Relationship badge tooltip", () => {
  it("places type first and keeps every authored property without losing YAML value distinctions", () => {
    expect(relationshipPropertyRows({
      numeric: "42", type: "cites", missing: null, enabled: false, empty: "", count: 0,
    })).toEqual([
      { key: "type", value: "cites" },
      { key: "numeric", value: '\"42\"' },
      { key: "missing", value: "null" },
      { key: "enabled", value: "false" },
      { key: "empty", value: '\"\"' },
      { key: "count", value: "0" },
    ]);
  });

  it("keeps nested maps, arrays, multiline text and long values complete in popover rows", () => {
    const rows = relationshipPropertyRows({
      type: "cites", evidence: [{ page: 42, quote: "First line\nSecond line" }],
      note: "<script>" + "Long content ".repeat(200),
    });
    expect(rows[1]?.value).toContain("- page: 42");
    expect(rows[1]?.value).toContain("First line\n    Second line");
    expect(rows[2]?.value).toContain("<script>" + "Long content ".repeat(200).trimEnd());
  });

  it("shows every authored property, including the type, as readable key/value text", () => {
    const [relationship] = extractPgmRelationshipLinkSources(
      `[Peer](Peer.md "{type: collaborated_with, since: 1833, confidence: 0.75, confirmed: false, missing: null}")`,
    );
    expect(relationship).toBeDefined();
    expect(formatRelationshipTooltip(relationship!.properties)).toBe([
      "Relationship properties",
      "",
      "type: collaborated_with",
      "since: 1833",
      "confidence: 0.75",
      "confirmed: false",
      "missing: null",
    ].join("\n"));
  });

  it("uses indented lists and mappings without truncating nested or multiline values", () => {
    const tooltip = formatRelationshipTooltip({
      type: "cites",
      evidence: ["letter", "archive"],
      metadata: new Map<string, unknown>([["page", 42], ["section", "Appendix"]]),
      note: "First line\nSecond line",
      full: "long-property-value".repeat(60),
    });
    expect(tooltip).toContain("evidence:\n  - letter\n  - archive");
    expect(tooltip).toContain("metadata:\n  page: 42\n  section: Appendix");
    expect(tooltip).toContain("note: |-\n  First line\n  Second line");
    expect(tooltip).toContain(`full: ${"long-property-value".repeat(60)}`);
  });

  it("represents YAML sets, binary, timestamps, non-string keys, and numeric special values", () => {
    const tooltip = formatRelationshipTooltip({
      type: "records",
      participants: new Set(["Ada", "Charles"]),
      data: new Uint8Array([72, 101, 108, 108, 111]),
      observed: new Date("2026-09-08T08:00:00Z"),
      lookup: new Map<unknown, unknown>([[1, "one"], [true, "enabled"]]),
      large: 12345678901234567890n,
      signedZero: -0,
      unbounded: Infinity,
    });
    expect(tooltip).toContain("participants: !!set\n  ? Ada\n  ? Charles");
    expect(tooltip).toContain("data: !!binary |-\n  SGVsbG8=");
    expect(tooltip).toContain("observed: 2026-09-08T08:00:00");
    expect(tooltip).toContain("lookup:\n  1: one\n  true: enabled");
    expect(tooltip).toContain("large: 12345678901234567890");
    expect(tooltip).toContain("signedZero: -0");
    expect(tooltip).toContain("unbounded: .inf");
  });

  it("keeps markup-like values as plain text and distinguishes strings from other scalar types", () => {
    const tooltip = formatRelationshipTooltip({
      type: "cites",
      note: "<img src=x onerror=alert(1)>",
      number: "42",
      missing: "null",
      empty: "",
    });
    expect(tooltip).toContain("note: <img src=x onerror=alert(1)>");
    expect(tooltip).toContain('number: "42"');
    expect(tooltip).toContain('missing: "null"');
    expect(tooltip).toContain('empty: ""');
  });
});
