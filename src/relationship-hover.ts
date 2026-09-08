import type { PgmProperties } from "./pgm";
import { relationshipPropertyRows } from "./relationship-tooltip";

export interface RelationshipHoverDetails {
  readonly properties: PgmProperties;
  readonly source?: string;
  readonly target?: string;
}

const controllers = new Map<Document, RelationshipPropertyHover>();
let nextTooltipId = 0;

/** Register only the badge/type, never the target's ordinary Markdown link. */
export function bindRelationshipPropertyHover(
  target: HTMLElement,
  details: RelationshipHoverDetails,
): void {
  let controller = controllers.get(target.ownerDocument);
  if (!controller) {
    controller = new RelationshipPropertyHover(target.ownerDocument);
    controllers.set(target.ownerDocument, controller);
  }
  controller.bind(target, details);
}

/** The host calls this when unloading its Markdown extension. */
export function disposeRelationshipPropertyHovers(): void {
  for (const controller of controllers.values()) controller.destroy();
  controllers.clear();
}

class RelationshipPropertyHover {
  private readonly targets = new WeakMap<HTMLElement, RelationshipHoverDetails>();
  private readonly removeListeners: Array<() => void> = [];
  private anchor: HTMLElement | null = null;
  private popup: HTMLElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private selecting = false;
  private selectionClick = false;

  constructor(private readonly doc: Document) {
    // Detached badges have no internal-link ancestor. Capture also keeps
    // delegated editor hover handlers from inferring a target from source text.
    for (const eventName of ["pointerover", "mouseover", "mouseenter"] as const) {
      this.listen(eventName, (event) => {
        const target = this.targetFor(event.target);
        if (!target) return;
        event.stopImmediatePropagation();
        this.show(target);
      });
    }
    for (const eventName of ["pointerout", "mouseout"] as const) {
      this.listen(eventName, (event) => {
        if (this.inside(event.relatedTarget)) return;
        if (this.inside(event.target)) this.scheduleHide();
      });
    }
    this.listen("focusin", (event) => {
      const target = this.targetFor(event.target);
      if (target) this.show(target);
    });
    this.listen("focusout", (event) => {
      if (!this.inside(event.relatedTarget)) this.scheduleHide();
    });
    this.listen("pointerdown", (event) => {
      this.selectionClick = false;
      if (this.contains(this.popup, event.target)) {
        this.selecting = true;
        this.cancelHide();
      } else if (this.targetFor(event.target)) {
        this.show(this.targetFor(event.target)!);
      } else {
        this.close();
      }
    });
    this.listen("pointerup", (event) => {
      if (!this.selecting) return;
      this.selecting = false;
      this.selectionClick = !this.contains(this.popup, event.target) && this.hasSelection();
      this.scheduleHide();
    });
    this.listen("pointercancel", () => { this.selecting = false; this.scheduleHide(); });
    this.listen("click", (event) => {
      if (event.detail > 0 && this.selectionClick) {
        this.selectionClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const target = this.targetFor(event.target);
      if (target || this.contains(this.popup, event.target)) {
        event.stopImmediatePropagation();
        if (target) { event.preventDefault(); this.show(target); }
      } else this.close();
    });
    this.listen("keydown", (event) => {
      if (event.key === "Escape" && this.popup) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      } else if ((event.key === "Enter" || event.key === " ") && this.targetFor(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.show(this.targetFor(event.target)!);
      }
    });
    this.listen("selectionchange", () => this.scheduleHide());
    this.listen("scroll", (event) => {
      if (!this.contains(this.popup, event.target)) this.close();
    });
    const win = doc.defaultView;
    if (win) {
      const close = () => this.close();
      win.addEventListener("resize", close);
      win.addEventListener("blur", close);
      this.removeListeners.push(() => {
        win.removeEventListener("resize", close);
        win.removeEventListener("blur", close);
      });
    }
  }

  bind(target: HTMLElement, details: RelationshipHoverDetails): void {
    this.targets.set(target, details);
    target.removeAttribute("title");
    target.removeAttribute("aria-label");
    target.setAttribute("role", "button");
    target.tabIndex = 0;
    // Obsidian uses aria-label for its generic tooltip. labelledby keeps the
    // accessible name without introducing a second hover surface.
    const label = this.doc.createElement("span");
    label.id = `pgm-relationship-hover-label-${++nextTooltipId}`;
    label.className = "pgm-relationship-hover-label";
    label.textContent = `Relationship properties: ${String(details.properties.type ?? "")}`;
    target.appendChild(label);
    target.setAttribute("aria-labelledby", label.id);
  }

  destroy(): void {
    this.close();
    for (const remove of this.removeListeners) remove();
  }

  private listen<K extends keyof DocumentEventMap>(
    name: K,
    listener: (event: DocumentEventMap[K]) => void,
  ): void {
    this.doc.addEventListener(name, listener, true);
    this.removeListeners.push(() => this.doc.removeEventListener(name, listener, true));
  }

  private targetFor(target: EventTarget | null): HTMLElement | null {
    let element = target && (target as Node).nodeType === 1 ? target as HTMLElement : null;
    while (element) {
      if (this.targets.has(element)) return element;
      element = element.parentElement;
    }
    return null;
  }

  private contains(element: HTMLElement | null, target: EventTarget | null): boolean {
    return Boolean(element && target && typeof (target as Node).nodeType === "number" && element.contains(target as Node));
  }

  private inside(target: EventTarget | null): boolean {
    return this.contains(this.popup, target) || this.contains(this.anchor, target);
  }

  private hasSelection(): boolean {
    const selection = this.doc.getSelection();
    return Boolean(selection && !selection.isCollapsed && this.popup &&
      (this.contains(this.popup, selection.anchorNode) || this.contains(this.popup, selection.focusNode)));
  }

  private show(target: HTMLElement): void {
    this.cancelHide();
    if (target === this.anchor && this.popup) return;
    this.close();
    const details = this.targets.get(target);
    if (!details || !target.isConnected) return;
    const popup = this.doc.createElement("div");
    popup.className = "pgm-relationship-popover";
    popup.id = `pgm-relationship-popover-${++nextTooltipId}`;
    popup.setAttribute("role", "tooltip");
    const heading = this.doc.createElement("div");
    heading.className = "pgm-relationship-popover-heading";
    heading.textContent = "Relationship properties";
    popup.appendChild(heading);
    const table = this.doc.createElement("dl");
    table.className = "pgm-relationship-popover-properties";
    const addRow = (key: string, value: string, context = false) => {
      const term = this.doc.createElement("dt");
      const definition = this.doc.createElement("dd");
      term.textContent = key;
      definition.textContent = value;
      if (context) { term.className = "is-context"; definition.className = "is-context"; }
      table.append(term, definition);
    };
    if (details.source) addRow("Source", details.source, true);
    if (details.target) addRow("Target", details.target, true);
    for (const row of relationshipPropertyRows(details.properties)) addRow(row.key, row.value);
    popup.appendChild(table);
    popup.addEventListener("pointerenter", () => this.cancelHide());
    this.doc.body.appendChild(popup);
    this.anchor = target;
    this.popup = popup;
    target.setAttribute("aria-describedby", popup.id);
    const bounds = target.getBoundingClientRect();
    const width = this.doc.documentElement.clientWidth;
    const height = this.doc.documentElement.clientHeight;
    const rect = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(bounds.left, width - rect.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(bounds.bottom + 8 + rect.height > height ? bounds.top - rect.height - 8 : bounds.bottom + 8, height - rect.height - 8))}px`;
    const Observer = this.doc.defaultView?.MutationObserver;
    if (Observer) {
      this.observer = new Observer(() => {
        if (!target.isConnected) this.close();
      });
      this.observer.observe(this.doc.body, { childList: true, subtree: true });
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private scheduleHide(): void {
    this.cancelHide();
    if (!this.popup) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.selecting || this.hasSelection() || this.popup?.matches(":hover") ||
        this.anchor?.matches(":hover") || this.inside(this.doc.activeElement)) return;
      this.close();
    }, 180);
  }

  private close(): void {
    this.cancelHide();
    this.observer?.disconnect();
    this.observer = null;
    this.anchor?.removeAttribute("aria-describedby");
    this.popup?.remove();
    this.anchor = null;
    this.popup = null;
    this.selecting = false;
    this.selectionClick = false;
  }
}
