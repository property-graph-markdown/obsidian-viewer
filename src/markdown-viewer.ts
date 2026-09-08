export interface MarkdownViewerOptions {
  readonly path: string;
  readonly markdown: string;
  readonly onClose: () => void;
}

/** A reusable, read-only Markdown panel for web hosts of the graph viewer. */
export function renderMarkdownViewer(
  container: HTMLElement,
  options: MarkdownViewerOptions,
): void {
  const ownerDocument = container.ownerDocument;
  const panel = ownerDocument.createElement("section");
  panel.className = "pgm-markdown-viewer";
  panel.setAttribute("aria-label", "Markdown viewer");

  const header = ownerDocument.createElement("header");
  header.className = "pgm-markdown-header";

  const title = ownerDocument.createElement("h2");
  title.className = "pgm-markdown-title";
  title.textContent = options.path;

  const close = ownerDocument.createElement("button");
  close.className = "pgm-markdown-close";
  close.type = "button";
  close.setAttribute("aria-label", "Close Markdown viewer");
  close.title = "Close Markdown viewer";
  close.textContent = "×";
  close.addEventListener("click", () => options.onClose());
  header.append(title, close);

  const content = ownerDocument.createElement("pre");
  content.className = "pgm-markdown-content";
  content.textContent = options.markdown;
  content.tabIndex = 0;
  panel.append(header, content);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    options.onClose();
  });

  // Listeners belong to the replaceable panel, never the persistent host.
  container.replaceChildren(panel);
}
