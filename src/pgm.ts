import MarkdownIt from "markdown-it";
import { isMap, isScalar, parseDocument } from "yaml";

export type PgmProperties = Record<string, unknown>;

export interface PgmNode {
  /** Bundle-relative Concept ID (the exact lowercase `.md` suffix is removed). */
  id: string;
  /** Original bundle-relative Markdown path. */
  path: string;
  /** The required, non-empty `type` Node Property. */
  type: string;
  /** Complete YAML frontmatter, including `type` and unknown Properties. */
  properties: PgmProperties;
}

export interface PgmEdge {
  /** Stable within one source snapshot: source Concept ID plus Link occurrence. */
  id: string;
  source: string;
  target: string;
  /** Present only when the Relationship `type` Property is a non-empty string. */
  type?: string;
  /** Complete YAML Flow Mapping from the Markdown Link title. */
  properties: PgmProperties;
  /** Human-readable Markdown Link text. */
  text: string;
  /** Parsed Markdown Link title, when authored. */
  title?: string;
  /** Whether `target` identifies a valid Concept in this parse result. */
  resolved: boolean;
}

export type PgmDiagnosticSeverity = "error" | "warning";

export interface PgmDiagnostic {
  severity: PgmDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface PgmGraph {
  nodes: PgmNode[];
  edges: PgmEdge[];
  diagnostics: PgmDiagnostic[];
}

export interface PgmDocument {
  path: string;
  content: string;
}

interface ParsedConcept extends PgmNode {
  body: string;
}

interface MarkdownToken {
  type: string;
  content: string;
  children: MarkdownToken[] | null;
  attrGet(name: string): string | null;
}

interface ParsedLink {
  destination: string;
  text: string;
  title: string | null;
}

export interface ParsedPgmRelationshipProperties {
  properties: PgmProperties;
  type?: string;
  diagnostic?: Pick<PgmDiagnostic, "code" | "message">;
}

class PgmParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PgmParseError";
  }
}

class DestinationError extends Error {}

const markdown = new MarkdownIt("commonmark", {
  linkify: false,
  typographer: false,
});

const YAML_SEPARATION = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/**
 * Parse the Markdown files in an OKF-style vault into the graph data needed by
 * the viewer. This is a deliberately small PGM 0.4 reader, not a claim of full
 * PGM Core Processor conformance.
 */
export function parsePgmVault(documents: PgmDocument[]): PgmGraph {
  const nodes: PgmNode[] = [];
  const edges: PgmEdge[] = [];
  const diagnostics: PgmDiagnostic[] = [];
  const concepts: ParsedConcept[] = [];

  const documentGroups = groupDocuments(documents);

  for (const [path, group] of documentGroups) {
    if (group.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "PGM_DOCUMENT_DUPLICATE",
        message: `Duplicate vault path; all ${group.length} copies were ignored.`,
        path,
      });
      continue;
    }

    const document = group[0];
    if (document === undefined || !path.endsWith(".md")) {
      continue;
    }

    if (isReservedDocument(path)) {
      continue;
    }

    let id: string;
    try {
      id = conceptIdFromPath(path);
    } catch (error) {
      const parsed = asPgmParseError(error, "PGM_CONCEPT_PATH_INVALID");
      diagnostics.push({
        severity: "error",
        code: parsed.code,
        message: parsed.message,
        path,
      });
      continue;
    }

    try {
      const { source, body } = splitFrontmatter(document.content);
      const properties = parseYamlMapping(source);
      const type = properties.type;

      if (typeof type !== "string" || type.length === 0) {
        throw new PgmParseError(
          "PGM_CONCEPT_TYPE_INVALID",
          "Concept frontmatter requires a non-empty string `type` Property.",
        );
      }

      concepts.push({ id, path, type, properties, body });
      nodes.push({ id, path, type, properties });
    } catch (error) {
      const parsed = asPgmParseError(error, "PGM_FRONTMATTER_INVALID");
      diagnostics.push({
        severity: "error",
        code: parsed.code,
        message: parsed.message,
        path,
      });
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const concept of concepts) {
    let relationshipOccurrence = 0;

    for (const link of extractMarkdownLinks(concept.body)) {
      let target: string;
      try {
        target = resolveConceptDestination(link.destination, concept.id);
      } catch (error) {
        if (looksLikeLocalMarkdownDestination(link.destination)) {
          diagnostics.push({
            severity: "warning",
            code: "PGM_CONCEPT_DESTINATION_INVALID",
            message:
              error instanceof Error
                ? error.message
                : "Invalid local Markdown Concept destination.",
            path: concept.path,
          });
        }
        continue;
      }

      const relationship = parsePgmRelationshipProperties(link.title);
      const id = `pgm-edge:${encodeURIComponent(concept.id)}:${relationshipOccurrence}`;
      relationshipOccurrence += 1;

      if (relationship.diagnostic !== undefined) {
        diagnostics.push({
          severity: "warning",
          ...relationship.diagnostic,
          path: concept.path,
        });
      }

      const edge: PgmEdge = {
        id,
        source: concept.id,
        target,
        properties: relationship.properties,
        text: link.text,
        resolved: nodeIds.has(target),
      };
      if (relationship.type !== undefined) {
        edge.type = relationship.type;
      }
      if (link.title !== null) {
        edge.title = link.title;
      }
      edges.push(edge);
    }
  }

  return { nodes, edges, diagnostics };
}

function groupDocuments(documents: PgmDocument[]): Array<[string, PgmDocument[]]> {
  const groups = new Map<string, PgmDocument[]>();
  for (const document of documents) {
    const existing = groups.get(document.path);
    if (existing === undefined) {
      groups.set(document.path, [document]);
    } else {
      existing.push(document);
    }
  }

  return [...groups.entries()].sort(([left], [right]) => compareStrings(left, right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isReservedDocument(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "index.md" || name === "log.md";
}

function conceptIdFromPath(path: string): string {
  if (!path.endsWith(".md")) {
    throw new PgmParseError(
      "PGM_CONCEPT_PATH_INVALID",
      "Concept path must have the exact lowercase `.md` suffix.",
    );
  }
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    [...path].some(isC0OrDelete)
  ) {
    throw new PgmParseError(
      "PGM_CONCEPT_PATH_INVALID",
      "Concept path must be a portable bundle-relative POSIX path.",
    );
  }

  const id = path.slice(0, -3);
  const segments = id.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PgmParseError(
      "PGM_CONCEPT_PATH_INVALID",
      "Concept path contains an empty, `.` or `..` segment.",
    );
  }
  return id;
}

function splitFrontmatter(content: string): { source: string; body: string } {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const markdownSource = withoutBom.replace(/\r\n?/g, "\n");
  const opening = /^---[ \t]*(?:\r\n|\n)/.exec(markdownSource);
  if (opening === null) {
    throw new PgmParseError(
      "PGM_FRONTMATTER_MISSING",
      "Concept must begin with YAML frontmatter.",
    );
  }

  let lineStart = opening[0].length;
  while (lineStart <= markdownSource.length) {
    const newline = markdownSource.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdownSource.length : newline;
    const line = markdownSource.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      const bodyStart = newline === -1 ? lineEnd : newline + 1;
      return {
        source: markdownSource.slice(opening[0].length, lineStart),
        body: markdownSource.slice(bodyStart),
      };
    }

    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }

  throw new PgmParseError(
    "PGM_FRONTMATTER_UNTERMINATED",
    "Concept YAML frontmatter has no closing delimiter.",
  );
}

function parseYamlMapping(source: string): PgmProperties {
  let document;
  try {
    document = parseDocument(source, {
      intAsBigInt: true,
      schema: "core",
      uniqueKeys: true,
    });
  } catch (error) {
    throw new PgmParseError(
      "PGM_YAML_INVALID",
      yamlErrorMessage(error),
    );
  }

  if (document.errors.length > 0) {
    throw new PgmParseError(
      "PGM_YAML_INVALID",
      yamlErrorMessage(document.errors[0]),
    );
  }
  if (document.warnings.length > 0) {
    throw new PgmParseError(
      "PGM_YAML_TAG_UNSUPPORTED",
      yamlErrorMessage(document.warnings[0]),
    );
  }
  if (!isMap(document.contents)) {
    throw new PgmParseError(
      "PGM_YAML_NOT_MAPPING",
      "YAML Properties must be a Mapping.",
    );
  }

  for (const pair of document.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
      throw new PgmParseError(
        "PGM_YAML_KEY_INVALID",
        "Every outer YAML Property key must be a string.",
      );
    }
  }

  let value: unknown;
  try {
    value = document.toJS({ mapAsMap: true, maxAliasCount: 100 });
  } catch (error) {
    throw new PgmParseError(
      "PGM_YAML_INVALID",
      yamlErrorMessage(error),
    );
  }

  if (!(value instanceof Map)) {
    throw new PgmParseError(
      "PGM_YAML_NOT_MAPPING",
      "YAML Properties must be a Mapping.",
    );
  }
  return Object.fromEntries(
    [...value].map(([key, item]) => [key, normalizeYamlValue(item)]),
  );
}

function isPlainRecord(value: unknown): value is PgmProperties {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeYamlValue(value: unknown, active = new Set<object>()): unknown {
  if (typeof value === "bigint") {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") {
    throw new PgmParseError("PGM_YAML_VALUE_UNSUPPORTED", "Unsupported YAML Property value.");
  }
  if (active.has(value)) {
    throw new PgmParseError(
      "PGM_YAML_VALUE_CYCLIC",
      "Cyclic YAML aliases are not PGM Property values.",
    );
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new PgmParseError("PGM_YAML_VALUE_UNSUPPORTED", "Invalid YAML timestamp.");
    }
    return value;
  }
  if (value instanceof Uint8Array) return value;

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeYamlValue(item, active));
    }
    if (value instanceof Map) {
      const result = new Map<unknown, unknown>();
      for (const [key, item] of value) {
        const normalizedKey = normalizeYamlValue(key, active);
        if (result.has(normalizedKey)) {
          throw new PgmParseError(
            "PGM_YAML_KEY_DUPLICATE",
            "Nested YAML Mapping keys collide under Property value identity.",
          );
        }
        result.set(normalizedKey, normalizeYamlValue(item, active));
      }
      return result;
    }
    if (value instanceof Set) {
      const result = new Set<unknown>();
      for (const item of value) {
        const normalized = normalizeYamlValue(item, active);
        if (result.has(normalized)) {
          throw new PgmParseError(
            "PGM_YAML_SET_DUPLICATE",
            "YAML Set items collide under Property value identity.",
          );
        }
        result.add(normalized);
      }
      return result;
    }
    if (isPlainRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeYamlValue(item, active)]),
      );
    }
  } finally {
    active.delete(value);
  }

  throw new PgmParseError("PGM_YAML_VALUE_UNSUPPORTED", "Unsupported YAML Property value.");
}

function yamlErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const firstLine = error.message.split(/\r?\n/, 1)[0];
    return `Invalid YAML${firstLine === undefined || firstLine === "" ? "." : `: ${firstLine}`}`;
  }
  return "Invalid YAML.";
}

function extractMarkdownLinks(source: string): ParsedLink[] {
  const tokens = markdown.parse(source, {}) as MarkdownToken[];
  const links: ParsedLink[] = [];

  for (const token of tokens) {
    if (token.type !== "inline" || token.children === null) {
      continue;
    }

    const children = token.children;
    for (let index = 0; index < children.length; index += 1) {
      const open = children[index];
      if (open === undefined || open.type !== "link_open") {
        continue;
      }

      const destination = open.attrGet("href");
      if (destination === null) {
        continue;
      }

      const text: string[] = [];
      let depth = 1;
      let closeIndex = index + 1;
      for (; closeIndex < children.length; closeIndex += 1) {
        const child = children[closeIndex];
        if (child === undefined) {
          continue;
        }
        if (child.type === "link_open") {
          depth += 1;
        } else if (child.type === "link_close") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        } else if (depth === 1) {
          text.push(markdownTokenText(child));
        }
      }

      links.push({
        destination,
        text: text.join(""),
        title: open.attrGet("title"),
      });
      index = closeIndex;
    }
  }

  return links;
}

function markdownTokenText(token: MarkdownToken): string {
  if (token.type === "softbreak" || token.type === "hardbreak") {
    return " ";
  }
  if (token.type === "text" || token.type === "code_inline" || token.type === "image") {
    return token.content;
  }
  if (token.children !== null) {
    return token.children.map(markdownTokenText).join("");
  }
  return "";
}

/**
 * Parse the optional YAML Flow Mapping carried by a Markdown Link title.
 *
 * This is exported so Markdown renderers can classify Relationship links with
 * exactly the same YAML rules as the graph parser. A title is renderable as a
 * typed PGM Relationship only when the returned `type` is present and no
 * diagnostic is returned.
 */
export function parsePgmRelationshipProperties(
  title: string | null,
): ParsedPgmRelationshipProperties {
  if (title === null) {
    return { properties: {} };
  }

  const source = title.replace(YAML_SEPARATION, "");
  if (!source.startsWith("{")) {
    return { properties: {} };
  }
  if (!source.endsWith("}")) {
    return invalidRelationshipProperties("Title is not a complete YAML Flow Mapping.");
  }

  let properties: PgmProperties;
  try {
    properties = parseYamlMapping(source);
  } catch (error) {
    const parsed = asPgmParseError(error, "PGM_RELATIONSHIP_TITLE_INVALID");
    return invalidRelationshipProperties(parsed.message);
  }

  if (!Object.prototype.hasOwnProperty.call(properties, "type")) {
    return { properties };
  }
  const type = properties.type;
  if (typeof type === "string" && type.length > 0) {
    return { properties, type };
  }

  return {
    properties,
    diagnostic: {
      code: "PGM_RELATIONSHIP_TYPE_INVALID",
      message:
        "Relationship `type` is retained but is not a non-empty string; the Relationship is untyped.",
    },
  };
}

function invalidRelationshipProperties(message: string): ParsedPgmRelationshipProperties {
  return {
    properties: {},
    diagnostic: {
      code: "PGM_RELATIONSHIP_TITLE_INVALID",
      message: `Invalid PGM YAML Flow Mapping title: ${message}`,
    },
  };
}

interface ParsedConceptDestination {
  readonly absolute: boolean;
  readonly decodedSegments: string[];
}

/**
 * Whether a normalized CommonMark Link destination has the path shape accepted
 * by the PGM reader. Source-relative `..` resolution is intentionally left to
 * `resolveConceptDestination`, where the source Concept ID is available.
 */
export function isPgmConceptDestinationSyntax(destination: string): boolean {
  try {
    parseConceptDestinationSyntax(destination);
    return true;
  } catch {
    return false;
  }
}

function parseConceptDestinationSyntax(destination: string): ParsedConceptDestination {
  if (destination.length === 0) {
    throw new DestinationError("Empty Link destination is not a Concept destination.");
  }
  if ([...destination].some((character) => isC0OrDelete(character) || character === " ")) {
    throw new DestinationError(
      "Concept destination contains an unescaped space or control character.",
    );
  }

  const fragmentAt = destination.indexOf("#");
  const withoutFragment = fragmentAt === -1 ? destination : destination.slice(0, fragmentAt);
  if (withoutFragment.includes("?")) {
    throw new DestinationError("Query-bearing Link is not a Concept destination.");
  }
  if (withoutFragment.length === 0) {
    throw new DestinationError("Fragment-only Link is not a Concept destination.");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(withoutFragment) || withoutFragment.startsWith("//")) {
    throw new DestinationError("External Link is not a Concept destination.");
  }

  const absolute = withoutFragment.startsWith("/");
  const decodedSegments = withoutFragment.split("/").map(decodePathSegment);
  const finalSegment = decodedSegments[decodedSegments.length - 1];
  if (finalSegment === undefined || !finalSegment.endsWith(".md")) {
    throw new DestinationError("Concept destination must end with exact lowercase `.md`.");
  }
  if (finalSegment === "index.md" || finalSegment === "log.md") {
    throw new DestinationError("Reserved document is not a Concept destination.");
  }

  return { absolute, decodedSegments };
}

function resolveConceptDestination(destination: string, sourceId: string): string {
  const { absolute, decodedSegments } = parseConceptDestinationSyntax(destination);

  const result = absolute ? [] : sourceId.split("/").slice(0, -1);
  for (const segment of decodedSegments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (result.length === 0) {
        throw new DestinationError("Concept destination traverses above the vault root.");
      }
      result.pop();
      continue;
    }
    result.push(segment);
  }

  const targetPath = result.join("/");
  if (!targetPath.endsWith(".md")) {
    throw new DestinationError("Concept destination must identify a Markdown document.");
  }
  return targetPath.slice(0, -3);
}

function decodePathSegment(segment: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(segment)) {
    throw new DestinationError("Concept destination contains a malformed percent escape.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new DestinationError("Concept destination contains invalid percent-encoded UTF-8.");
  }

  if (
    decoded.includes("/") ||
    decoded.includes("\\") ||
    [...decoded].some(isC0OrDelete)
  ) {
    throw new DestinationError(
      "Decoded Concept path segment contains a slash, backslash or control character.",
    );
  }
  return decoded;
}

function isC0OrDelete(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}

function looksLikeLocalMarkdownDestination(destination: string): boolean {
  const beforeFragment = destination.split("#", 1)[0] ?? "";
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(beforeFragment) && /\.md(?:\?|$)/.test(beforeFragment);
}

function asPgmParseError(error: unknown, fallbackCode: string): PgmParseError {
  if (error instanceof PgmParseError) {
    return error;
  }
  if (error instanceof Error) {
    return new PgmParseError(fallbackCode, error.message);
  }
  return new PgmParseError(fallbackCode, "Unknown parse error.");
}
