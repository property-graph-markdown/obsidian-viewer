import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parsePgmVault, type PgmDocument } from "../src/pgm";

const vaultRoot = path.resolve(process.cwd(), "example-vault");

function readMarkdown(directory: string): PgmDocument[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return readMarkdown(absolute);
      if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
      return [{
        path: path.relative(vaultRoot, absolute).split(path.sep).join("/"),
        content: readFileSync(absolute, "utf8"),
      }];
    });
}

describe("the bundled Ada Lovelace example vault", () => {
  it("is the approved 46-Node, 124-Relationship, warning-free release copy", () => {
    const graph = parsePgmVault(readMarkdown(vaultRoot));

    expect(graph.nodes).toHaveLength(46);
    expect(graph.edges).toHaveLength(124);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.edges.filter((edge) => edge.type === undefined)).toHaveLength(1);
    expect(existsSync(path.join(vaultRoot, "ATTRIBUTION.txt"))).toBe(true);
    expect(existsSync(path.join(vaultRoot, ".obsidian"))).toBe(false);
  });
});
