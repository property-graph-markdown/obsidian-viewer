import { describe, expect, it } from "vitest";

import { PgmRelationshipBadgeWidget } from "../src/relationship-badge-widget";

describe("Live Preview Relationship badge", () => {
  it("refreshes when a Relationship property changes while the label and type stay the same", () => {
    const previous = new PgmRelationshipBadgeWidget("Peer.md", "Peer", "knows", { type: "knows", since: 1833 });
    const same = new PgmRelationshipBadgeWidget("Peer.md", "Peer", "knows", { type: "knows", since: 1833 });
    const changed = new PgmRelationshipBadgeWidget("Peer.md", "Peer", "knows", { type: "knows", since: 1834 });
    const removed = new PgmRelationshipBadgeWidget("Peer.md", "Peer", "knows", { type: "knows" });
    expect(previous.eq(same)).toBe(true);
    expect(previous.eq(changed)).toBe(false);
    expect(previous.eq(removed)).toBe(false);
  });

  it("still refreshes for navigation or reader-label changes", () => {
    const previous = new PgmRelationshipBadgeWidget("Peer.md", "Peer", "knows");
    expect(previous.eq(new PgmRelationshipBadgeWidget("Other.md", "Peer", "knows"))).toBe(false);
    expect(previous.eq(new PgmRelationshipBadgeWidget("Peer.md", "Other", "knows"))).toBe(false);
    expect(previous.eq(new PgmRelationshipBadgeWidget("Peer.md", "Peer", "cites"))).toBe(false);
  });
});
