import { stringify } from "yaml";

import type { PgmProperties } from "./pgm";

/** Plain text for badge titles and accessible labels; never interpreted as HTML. */
export function formatRelationshipTooltip(properties: PgmProperties): string {
  const values = stringify(properties, {
    customTags: ["timestamp", "binary", "set"],
    aliasDuplicateObjects: false,
    lineWidth: 0,
  }).trimEnd();
  return `Relationship properties\n\n${values}`;
}
