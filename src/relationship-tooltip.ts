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

/** Preserve exact YAML scalar distinctions while displaying nested values in full. */
export function relationshipPropertyRows(properties: PgmProperties): Array<{ key: string; value: string }> {
  const keys = Object.keys(properties);
  if (keys.includes("type")) {
    keys.splice(keys.indexOf("type"), 1);
    keys.unshift("type");
  }
  return keys.map((key) => ({
    key,
    value: stringify(properties[key], {
      customTags: ["timestamp", "binary", "set"],
      aliasDuplicateObjects: false,
      lineWidth: 0,
    }).trimEnd(),
  }));
}
