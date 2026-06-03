/** Safe Markdown rendering for assistant messages via marked + DOMPurify. */

import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked once for GitHub Flavored Markdown.
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Force every generated link to open externally without leaking the opener.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noreferrer noopener");
  }
});

// Renders Markdown text into a container, sanitizing all generated HTML.
export function renderInto(container: HTMLElement, text: string): void {
  container.classList.add("ch-md");
  const html = marked.parse(text ?? "", { async: false });
  container.innerHTML = DOMPurify.sanitize(html);
}
