/** Safe Markdown rendering for assistant messages via marked + DOMPurify. */
const { marked, DOMPurify } = window;
marked.setOptions({
    gfm: true,
    breaks: true,
});
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer noopener");
    }
});
export function renderInto(container, text) {
    container.classList.add("ch-md");
    const html = marked.parse(text ?? "", { async: false });
    container.innerHTML = DOMPurify.sanitize(html);
}
