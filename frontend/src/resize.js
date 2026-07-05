/** Drag resize behavior for the sidebar and composer. */
import * as AppContext from "./app-context.js";
// Connects all resize separators to their drag behavior.
export function bind(refs) {
    bindSidebar(refs);
    bindComposer(refs);
}
// Lets the user resize the chat session sidebar by dragging the separator.
function bindSidebar(refs) {
    let startX = 0;
    let startWidth = 0;
    const minWidth = 80;
    const maxWidth = 360;
    refs.resizerSidebar.addEventListener("mousedown", (event) => {
        startX = event.clientX;
        startWidth = refs.navSessions.closest(".ch-sidebar")?.offsetWidth || 115;
        document.body.classList.add("is-resizing-sidebar");
        document.addEventListener("mousemove", resizeSidebar);
        document.addEventListener("mouseup", stopSidebarResize, { once: true });
    });
    // Applies the sidebar width while dragging the separator.
    function resizeSidebar(event) {
        const sidebar = refs.navSessions.closest(".ch-sidebar");
        if (!sidebar) {
            return;
        }
        const width = Math.min(maxWidth, Math.max(minWidth, startWidth + event.clientX - startX));
        sidebar.style.width = `${width}px`;
    }
    // Clears temporary resize listeners and cursor state.
    function stopSidebarResize() {
        document.body.classList.remove("is-resizing-sidebar");
        document.removeEventListener("mousemove", resizeSidebar);
        void AppContext.saveSettings();
    }
}
// Lets the user resize the message composer by dragging the horizontal separator.
function bindComposer(refs) {
    let startY = 0;
    let startHeight = 0;
    const minHeight = 46;
    const maxHeight = 220;
    refs.resizerComposer.addEventListener("mousedown", (event) => {
        event.preventDefault();
        startY = event.clientY;
        startHeight = refs.inputComposer.offsetHeight || 58;
        document.body.classList.add("is-resizing-composer");
        document.addEventListener("mousemove", resizeComposer);
        document.addEventListener("mouseup", stopComposerResize, { once: true });
    });
    // Applies the composer height while dragging the separator.
    function resizeComposer(event) {
        const nextHeight = Math.min(maxHeight, Math.max(minHeight, startHeight - (event.clientY - startY)));
        refs.inputComposer.style.height = `${nextHeight}px`;
    }
    // Clears temporary composer resize listeners and cursor state.
    function stopComposerResize() {
        document.body.classList.remove("is-resizing-composer");
        document.removeEventListener("mousemove", resizeComposer);
    }
}
