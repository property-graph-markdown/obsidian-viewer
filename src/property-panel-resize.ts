interface PropertyPanelResizeOptions {
  body: HTMLElement;
  handle: HTMLElement;
  panel: HTMLElement;
  height: number | null;
  onChange: (height: number) => void;
  onResizeStart: () => void;
}

const DEFAULT_HEIGHT = 240;
const PANEL_MIN = 80;
const GRAPH_MIN = 120;
const HANDLE_HEIGHT = 8;

/** Resize the lower panel without replacing the user's preferred height on pane resizes. */
export function attachPropertyPanelResize({
  body, handle, panel, height, onChange, onResizeStart,
}: PropertyPanelResizeOptions): () => void {
  let preferred = height !== null && Number.isFinite(height) && height >= 0 ? height : DEFAULT_HEIGHT;
  let actual = 0;
  let minimum = 0;
  let maximum = 0;
  let disposed = false;
  let drag: { pointerId: number; y: number; height: number; preferred: number } | null = null;

  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", "Resize property panel");
  handle.setAttribute("aria-controls", panel.id);
  handle.tabIndex = 0;

  const clamp = (value: number) => Math.min(maximum, Math.max(minimum, Math.round(value)));
  const update = () => {
    if (disposed) return;
    const gap = handle.getBoundingClientRect().height || HANDLE_HEIGHT;
    const available = Math.max(0, body.clientHeight - gap);
    // When the host becomes very short, share the shortage between both panes.
    maximum = Math.max(0, Math.floor(available - Math.min(GRAPH_MIN, available * GRAPH_MIN / (GRAPH_MIN + PANEL_MIN))));
    minimum = Math.min(PANEL_MIN, maximum);
    actual = clamp(preferred);
    body.style.setProperty("--pgm-property-panel-height", `${actual}px`);
    handle.setAttribute("aria-valuemin", String(minimum));
    handle.setAttribute("aria-valuemax", String(maximum));
    handle.setAttribute("aria-valuenow", String(actual));
    handle.setAttribute("aria-valuetext", `${actual} pixels`);
  };

  const releaseCapture = (pointerId: number) => {
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };
  const finish = (commit: boolean) => {
    const gesture = drag;
    if (!gesture) return;
    drag = null;
    body.classList.remove("pgm-property-panel-resizing");
    if (!commit || actual === gesture.height) preferred = gesture.preferred;
    update();
    releaseCapture(gesture.pointerId);
    if (commit && preferred !== gesture.preferred) onChange(preferred);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    preferred = clamp(drag.height + drag.y - event.clientY);
    update();
  };
  const down = (event: PointerEvent) => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    onResizeStart();
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, y: event.clientY, height: actual, preferred };
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      drag = null;
      return;
    }
    body.classList.add("pgm-property-panel-resizing");
  };
  const up = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    move(event);
    finish(true);
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === drag?.pointerId) finish(false);
  };
  const keydown = (event: KeyboardEvent) => {
    let next: number;
    switch (event.key) {
      case "ArrowUp": next = actual + (event.shiftKey ? 64 : 16); break;
      case "ArrowDown": next = actual - (event.shiftKey ? 64 : 16); break;
      case "Home": next = minimum; break;
      case "End": next = maximum; break;
      case "Escape":
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (drag) finish(false);
    onResizeStart();
    next = clamp(next);
    if (next === actual) return;
    preferred = next;
    update();
    onChange(preferred);
  };
  const stopClick = (event: MouseEvent) => event.stopPropagation();

  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  handle.addEventListener("keydown", keydown);
  handle.addEventListener("click", stopClick);
  handle.addEventListener("dblclick", stopClick);
  const ResizeObserverClass = (body.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver;
  const observer = ResizeObserverClass ? new ResizeObserverClass(update) : null;
  observer?.observe(body);
  update();

  return () => {
    if (disposed) return;
    finish(false);
    disposed = true;
    observer?.disconnect();
    handle.removeEventListener("pointerdown", down);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    handle.removeEventListener("lostpointercapture", cancel);
    handle.removeEventListener("keydown", keydown);
    handle.removeEventListener("click", stopClick);
    handle.removeEventListener("dblclick", stopClick);
  };
}
