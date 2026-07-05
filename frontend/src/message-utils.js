/** Message formatting and attachment helpers. */
// Returns all image attachments for a message.
export function imageDataUrls(message) {
    return message.imageDataUrls || [];
}
// Reports whether a message has copyable text or image markers.
export function hasCopyableContent(message) {
    return message.text.trim() !== "" || imageDataUrls(message).length > 0;
}
// Reports whether a session has copyable text or image markers.
export function hasCopyableMessages(session) {
    return session.messages.some(hasCopyableContent);
}
// Formats the active chat transcript for clipboard output.
export function transcriptText(session) {
    if (!session) {
        return "";
    }
    return session.messages
        .filter(hasCopyableContent)
        .map((message) => {
        const role = message.role === "user" ? "User" : "Assistant";
        const parts = [];
        if (message.text.trim()) {
            parts.push(message.text.trim());
        }
        const imageCount = imageDataUrls(message).length;
        if (imageCount > 0) {
            parts.push(imageCount === 1 ? "[Image attached]" : `[${imageCount} images attached]`);
        }
        return `${role}: ${parts.join("\n")}`;
    })
        .join("\n\n");
}
// Returns the raw text of the last assistant message, or empty string.
export function lastAssistantText(session) {
    if (!session)
        return "";
    for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.role === "assistant" && msg.text.trim()) {
            return msg.text.trim();
        }
    }
    return "";
}
