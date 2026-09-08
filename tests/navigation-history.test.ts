import { describe, expect, it } from "vitest";

import { NavigationHistory } from "../src/navigation-history";

describe("NavigationHistory", () => {
  it("navigates A → B → C backward and forward", () => {
    const history = new NavigationHistory<string>();
    history.reset("A");
    history.push("B");
    history.push("C");

    expect(history.current).toBe("C");
    expect(history.canGoBack).toBe(true);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toBe("B");
    expect(history.current).toBe("B");
    expect(history.canGoBack).toBe(true);
    expect(history.canGoForward).toBe(true);
    expect(history.back()).toBe("A");
    expect(history.canGoBack).toBe(false);
    expect(history.forward()).toBe("B");
    expect(history.forward()).toBe("C");
    expect(history.canGoForward).toBe(false);
  });

  it("replaces the forward branch when a new entry is pushed after going back", () => {
    const history = new NavigationHistory<string>();
    history.reset("A");
    history.push("B");
    history.push("C");
    expect(history.back()).toBe("B");
    history.push("D");

    expect(history.canGoForward).toBe(false);
    expect(history.forward()).toBeUndefined();
    expect(history.back()).toBe("B");
    expect(history.back()).toBe("A");
    expect(history.forward()).toBe("B");
    expect(history.forward()).toBe("D");
  });

  it("updates the current view snapshot by reference while preserving forward entries", () => {
    const first = { focus: "A", positions: new Map([["A", { x: 20, y: 30 }]]) };
    const second = { focus: "B", positions: new Map([["B", { x: 40, y: 50 }]]) };
    const updated = { focus: "A", positions: new Map([["A", { x: 200, y: 300 }]]) };
    const history = new NavigationHistory<typeof first>();
    history.reset(first);
    history.push(second);
    expect(history.back()).toBe(first);
    history.replaceCurrent(updated);

    expect(history.canGoForward).toBe(true);
    expect(history.forward()).toBe(second);
    expect(history.back()).toBe(updated);
    expect(first.positions.get("A")).toEqual({ x: 20, y: 30 });
    expect(second.positions.get("B")).toEqual({ x: 40, y: 50 });
  });

  it("handles an empty history and leaves the current position intact at either bound", () => {
    const history = new NavigationHistory<string>();
    expect(history.current).toBeUndefined();
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toBeUndefined();
    history.push("A");
    history.push("B");

    expect(history.forward()).toBeUndefined();
    expect(history.forward()).toBeUndefined();
    expect(history.back()).toBe("A");
    expect(history.back()).toBeUndefined();
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toBe("B");
  });

  it("allows replaceCurrent to initialize an empty history", () => {
    const history = new NavigationHistory<string>();
    history.replaceCurrent("initial");

    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    history.push("next");
    expect(history.back()).toBe("initial");
  });

  it("resets both navigation branches to one fresh entry", () => {
    const history = new NavigationHistory<string>();
    history.reset("A");
    history.push("B");
    history.push("C");
    history.back();
    history.reset("fresh");

    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toBeUndefined();
    history.push("later");
    expect(history.back()).toBe("fresh");
  });

  it("retains the current snapshot identity while removing invalid predecessors", () => {
    const a = { focus: "A" };
    const b = { focus: "B" };
    const c = { focus: "C" };
    const history = new NavigationHistory<typeof a>();
    history.reset(a);
    history.push(b);
    history.push(c);
    expect(history.back()).toBe(b);

    history.retain((entry) => entry.focus !== "A");

    expect(history.current).toBe(b);
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(true);
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toBe(c);
    expect(history.back()).toBe(b);
  });

  it("chooses a retained predecessor or successor when the current entry is removed", () => {
    const history = new NavigationHistory<string>();
    history.reset("A");
    history.push("B");
    history.push("C");
    history.back();
    history.retain((entry) => entry !== "B");

    expect(history.current).toBe("A");
    expect(history.canGoBack).toBe(false);
    expect(history.forward()).toBe("C");
    expect(history.back()).toBe("A");
    history.retain((entry) => entry !== "A");
    expect(history.current).toBe("C");
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    history.push("D");
    expect(history.back()).toBe("C");
  });

  it("can remove all entries and continue with a fresh history", () => {
    const history = new NavigationHistory<string>();
    history.reset("A");
    history.push("B");
    history.retain(() => false);

    expect(history.current).toBeUndefined();
    expect(history.canGoBack).toBe(false);
    expect(history.canGoForward).toBe(false);
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toBeUndefined();
    history.retain(() => { throw new Error("An empty history has no entries to inspect"); });
    history.push("fresh");
    history.push("later");
    expect(history.back()).toBe("fresh");
  });
});
