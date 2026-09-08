import { describe, expect, it, vi } from "vitest";

import { attachPropertyPanelResize } from "../src/property-panel-resize";

function fixture(height: number | null = null) {
  let observed: (() => void) | null = null;
  const disconnect = vi.fn();
  class Observer {
    constructor(callback: () => void) { observed = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  }
  class Element extends EventTarget {
    id = "properties";
    tabIndex = -1;
    clientHeight = 608;
    attributes = new Map<string, string>();
    properties = new Map<string, string>();
    classes = new Set<string>();
    captured = new Set<number>();
    ownerDocument = { defaultView: { ResizeObserver: Observer } };
    style = { setProperty: (name: string, value: string) => this.properties.set(name, value) };
    classList = {
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name),
    };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getBoundingClientRect() { return { height: 8 }; }
    focus = vi.fn();
    setPointerCapture(id: number) { this.captured.add(id); }
    hasPointerCapture(id: number) { return this.captured.has(id); }
    releasePointerCapture(id: number) { this.captured.delete(id); }
  }
  const body = new Element();
  const handle = new Element();
  const panel = new Element();
  const onChange = vi.fn();
  const onResizeStart = vi.fn();
  const cleanup = attachPropertyPanelResize({
    body: body as unknown as HTMLElement,
    handle: handle as unknown as HTMLElement,
    panel: panel as unknown as HTMLElement,
    height, onChange, onResizeStart,
  });
  const dispatch = (type: string, fields: Record<string, unknown>) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    handle.dispatchEvent(event);
    return event;
  };
  return {
    body, handle, onChange, onResizeStart, cleanup, disconnect,
    actual: () => Number.parseInt(body.properties.get("--pgm-property-panel-height") ?? "", 10),
    resize: (value: number) => { body.clientHeight = value; observed?.(); },
    pointer: (type: string, clientY: number, pointerId = 1) => dispatch(type, { clientY, pointerId, button: 0, isPrimary: true }),
    key: (key: string, shiftKey = false) => dispatch("keydown", { key, shiftKey }),
  };
}

describe("property panel resizing", () => {
  it("exposes a keyboard-focusable horizontal separator with the actual pixel range", () => {
    const setup = fixture();
    expect(setup.actual()).toBe(240);
    expect(setup.handle.tabIndex).toBe(0);
    expect(Object.fromEntries(setup.handle.attributes)).toEqual({
      role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize property panel",
      "aria-controls": "properties", "aria-valuemin": "80", "aria-valuemax": "480",
      "aria-valuenow": "240", "aria-valuetext": "240 pixels",
    });
    expect(setup.onChange).not.toHaveBeenCalled();
  });

  it("clamps to the available space without replacing the preferred height", () => {
    const setup = fixture(340);
    setup.resize(308);
    expect(setup.actual()).toBe(180);
    setup.resize(108);
    expect(setup.actual()).toBe(40);
    setup.resize(0);
    expect(setup.actual()).toBe(0);
    setup.resize(608);
    expect(setup.actual()).toBe(340);
    expect(setup.onChange).not.toHaveBeenCalled();
  });

  it("makes an upward drag larger and persists only on release", () => {
    const setup = fixture();
    expect(setup.pointer("pointerdown", 300).defaultPrevented).toBe(true);
    expect(setup.handle.captured.has(1)).toBe(true);
    expect(setup.onResizeStart).toHaveBeenCalledOnce();
    setup.pointer("pointermove", 250);
    expect(setup.actual()).toBe(290);
    expect(setup.onChange).not.toHaveBeenCalled();
    setup.pointer("pointermove", 100, 2);
    expect(setup.actual()).toBe(290);
    setup.pointer("pointerup", 250);
    expect(setup.onChange).toHaveBeenCalledExactlyOnceWith(290);
    expect(setup.handle.captured.size).toBe(0);
    expect(setup.body.classes.size).toBe(0);
    setup.resize(308);
    setup.resize(608);
    expect(setup.actual()).toBe(290);
  });

  it("restores the preference when a gesture is cancelled or capture is lost", () => {
    for (const event of ["pointercancel", "lostpointercapture"]) {
      const setup = fixture(340);
      setup.resize(308);
      setup.pointer("pointerdown", 300);
      setup.pointer("pointermove", 400);
      expect(setup.actual()).toBe(80);
      setup.pointer(event, 400);
      expect(setup.actual()).toBe(180);
      setup.resize(608);
      expect(setup.actual()).toBe(340);
      expect(setup.onChange).not.toHaveBeenCalled();
      expect(setup.handle.captured.size).toBe(0);
    }
  });

  it("does not overwrite a clamped preference when the separator is only clicked", () => {
    const setup = fixture(340);
    setup.resize(308);
    setup.pointer("pointerdown", 300);
    setup.pointer("pointerup", 300);
    setup.resize(608);
    expect(setup.actual()).toBe(340);
    expect(setup.onChange).not.toHaveBeenCalled();
  });

  it("supports keyboard steps, large steps, limits and Escape cancellation", () => {
    const setup = fixture();
    expect(setup.key("ArrowUp").defaultPrevented).toBe(true);
    expect(setup.actual()).toBe(256);
    setup.key("ArrowDown", true);
    expect(setup.actual()).toBe(192);
    setup.key("Home");
    expect(setup.actual()).toBe(80);
    setup.key("End");
    expect(setup.actual()).toBe(480);
    expect(setup.onChange.mock.calls).toEqual([[256], [192], [80], [480]]);
    setup.pointer("pointerdown", 100);
    setup.pointer("pointermove", 200);
    setup.key("Escape");
    expect(setup.actual()).toBe(480);
    expect(setup.onChange).toHaveBeenCalledTimes(4);
    expect(setup.key("Tab").defaultPrevented).toBe(false);
  });

  it("disconnects observation and event handlers, cancelling an active drag on removal", () => {
    const setup = fixture();
    setup.pointer("pointerdown", 300);
    setup.pointer("pointermove", 250);
    setup.cleanup();
    setup.cleanup();
    expect(setup.disconnect).toHaveBeenCalledOnce();
    expect(setup.actual()).toBe(240);
    expect(setup.handle.captured.size).toBe(0);
    expect(setup.body.classes.size).toBe(0);
    setup.pointer("pointerup", 250);
    setup.key("ArrowUp");
    setup.resize(100);
    expect(setup.actual()).toBe(240);
    expect(setup.onChange).not.toHaveBeenCalled();
  });
});
