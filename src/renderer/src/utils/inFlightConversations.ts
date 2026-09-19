/**
 * Tracks the newest in-memory document of conversations with in-flight chat
 * streams so background updates and tab switches never depend on disk timing.
 */

import type { Conversation } from '@shared/index'

const documents = new Map<string, Conversation>()

/** Records the latest known document of a conversation already being tracked. */
export const rememberInFlightConversation = (conversation: Conversation): void => {
  if (documents.has(conversation.id)) documents.set(conversation.id, conversation)
}

/** Starts tracking a conversation when one of its streams begins. */
export const trackInFlightConversation = (conversation: Conversation): void => {
  documents.set(conversation.id, conversation)
}

/** Returns the latest known in-memory document of an in-flight conversation. */
export const getInFlightConversation = (id: string): Conversation | undefined => documents.get(id)

/** Stops tracking a conversation once its stream has settled and been persisted. */
export const forgetInFlightConversation = (id: string): void => {
  documents.delete(id)
}
