/** Message formatting and attachment helpers. */

// Returns all image attachments for a message.
export function imageDataUrls(message: ChatMessage): string[] {
  return message.imageDataUrls || [];
}

// Reports whether a message has copyable text or image markers.
export function hasCopyableContent(message: ChatMessage): boolean {
  return message.text.trim() !== "" || imageDataUrls(message).length > 0;
}

// Reports whether a session has copyable text or image markers.
export function hasCopyableMessages(session: ChatSession): boolean {
  return session.messages.some(hasCopyableContent);
}

// Formats the active chat transcript for clipboard output.
export function transcriptText(session: ChatSession | null | undefined): string {
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
