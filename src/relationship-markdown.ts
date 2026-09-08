import {
  extractCommonMarkLinkSources,
  normalizeCommonMarkLinkDestination,
  type CommonMarkLinkSource,
} from "./commonmark-link-scanner";
import {
  isPgmConceptDestinationSyntax,
  parsePgmRelationshipProperties,
  type PgmProperties,
} from "./pgm";

export interface PgmRelationshipLinkSource {
  readonly link: CommonMarkLinkSource;
  readonly destination: string;
  readonly type: string;
  readonly properties: PgmProperties;
}

/**
 * Recognize the local `.md` destination shape accepted by the PGM reader.
 * Resolution against a concrete source note remains the vault parser's job.
 */
export function isPgmMarkdownDestination(destination: string): boolean {
  return isPgmConceptDestinationSyntax(
    normalizeCommonMarkLinkDestination(destination),
  );
}

/** Classify one physical CommonMark link as a typed canonical PGM Relationship. */
export function classifyPgmRelationshipLink(
  link: CommonMarkLinkSource,
): PgmRelationshipLinkSource | null {
  if (!isPgmMarkdownDestination(link.destination) || link.titleSource === null) {
    return null;
  }
  const relationship = parsePgmRelationshipProperties(link.title);
  if (relationship.type === undefined || relationship.diagnostic !== undefined) {
    return null;
  }
  return {
    link,
    destination: link.destination,
    type: relationship.type,
    properties: relationship.properties,
  };
}

/** Scan Markdown and return only typed canonical PGM Relationship links. */
export function extractPgmRelationshipLinkSources(
  markdown: string,
): PgmRelationshipLinkSource[] {
  const relationships: PgmRelationshipLinkSource[] = [];
  for (const link of extractCommonMarkLinkSources(markdown)) {
    const relationship = classifyPgmRelationshipLink(link);
    if (relationship) relationships.push(relationship);
  }
  return relationships;
}

export { extractCommonMarkLinkSources } from "./commonmark-link-scanner";
export type { CommonMarkLinkSource } from "./commonmark-link-scanner";
