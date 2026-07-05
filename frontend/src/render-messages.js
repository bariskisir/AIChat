import * as Constants from "./constants.js";
import * as Markdown from "./markdown.js";
import * as MessageUtils from "./message-utils.js";
import * as AppContext from "./app-context.js";
import { renderStatus, updateButtons } from "./render-controls.js";
import { cssEscape } from "./render-model.js";
// Renders all messages in the active session.
export function renderMessages(refs, session, scrollOptions) {
    refs.chatMessages.innerHTML = "";
    if (!session.messages.length) {
        const empty = document.createElement("div");
        empty.className = Constants.CSS.CH_CHAT_EMPTY;
        empty.textContent = Constants.PLACEHOLDER_EMPTY_CHAT;
        refs.chatMessages.appendChild(empty);
        return;
    }
    for (const message of session.messages) {
        refs.chatMessages.appendChild(messageNode(message));
    }
    if (scrollOptions.scrollToBottom) {
        scrollToBottom(refs.chatMessages);
        return;
    }
    refs.chatMessages.scrollTop = Math.min(scrollOptions.preservedScrollTop, maxScrollTop(refs.chatMessages));
}
// Builds one chat message bubble.
function messageNode(message) {
    const item = document.createElement("article");
    item.className = `ch-bubble ch-bubble--${message.role}`;
    item.dataset.messageId = message.id;
    for (const imageDataUrl of MessageUtils.imageDataUrls(message)) {
        const image = document.createElement("img");
        image.className = Constants.CSS.CH_BUBBLE_IMAGE;
        image.src = imageDataUrl;
        image.alt = "";
        item.appendChild(image);
    }
    const text = document.createElement("div");
    text.className = Constants.CSS.CH_BUBBLE_TEXT;
    renderMessageText(text, message);
    item.appendChild(text);
    return item;
}
// Renders message text with markdown only for assistant messages.
function renderMessageText(container, message) {
    const isPendingAssistant = message.role === Constants.ROLE.ASSISTANT && !message.text.trim();
    container.classList.toggle(Constants.CSS.IS_PENDING, isPendingAssistant);
    if (isPendingAssistant) {
        container.classList.remove(Constants.CSS.CH_MD);
        container.textContent = "";
        return;
    }
    if (message.role === Constants.ROLE.ASSISTANT) {
        if (AppContext.model.markdownEnabled) {
            Markdown.renderInto(container, message.text);
        }
        else {
            container.classList.remove(Constants.CSS.CH_MD);
            container.textContent = message.text;
        }
        return;
    }
    container.classList.remove(Constants.CSS.CH_MD);
    container.textContent = message.text || Constants.IMAGE_ALT_TEXT;
}
// Scrolls a container to its bottom edge.
function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
}
// Returns whether a scroll container is near its bottom.
export function isNearBottom(element) {
    return maxScrollTop(element) - element.scrollTop <= Constants.AUTO_SCROLL_THRESHOLD;
}
// Computes the maximum scrollTop for a container.
function maxScrollTop(element) {
    return Math.max(0, element.scrollHeight - element.clientHeight);
}
// Applies a streamed assistant text delta.
export function renderAssistantMessage(refs, model, sessionId, messageId, text) {
    const active = model.appState?.activeSession;
    if (!active || active.id !== sessionId) {
        return;
    }
    let message = active.messages.find((item) => item.id === messageId);
    if (!message) {
        message = {
            id: messageId,
            role: Constants.ROLE.ASSISTANT,
            text: "",
            imageDataUrls: [],
            createdAt: new Date().toISOString(),
        };
        active.messages.push(message);
    }
    message.text += text;
    const node = refs.chatMessages.querySelector(`[${"data-message-id"}="${cssEscape(messageId)}"] .${Constants.CSS.CH_BUBBLE_TEXT}`);
    if (node) {
        renderMessageText(node, message);
    }
    else {
        renderMessages(refs, active, {
            preservedScrollTop: refs.chatMessages.scrollTop,
            scrollToBottom: model.streamAutoScroll,
        });
    }
    if (model.streamAutoScroll) {
        scrollToBottom(refs.chatMessages);
    }
    renderStatus(refs, Constants.STATUS_STREAMING);
    updateButtons(refs, model);
}
