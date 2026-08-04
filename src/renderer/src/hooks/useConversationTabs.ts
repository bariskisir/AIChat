/**
 * Owns the conversation tab strip: every action mirrors the conversations
 * sidebar exactly, so tabs behave like the chats they represent.
 */

import { useCallback, useEffect } from 'react'
import { useConversationActions } from '@renderer/hooks/useConversationActions'
import { useAppSelector } from '@renderer/store'

/** Exposes conversation tab commands with sidebar-equivalent semantics. */
export const useConversationTabs = () => {
  const conversations = useAppSelector((state) => state.app.conversations)
  const currentConversationId = useAppSelector((state) => state.app.currentConversation?.id ?? null)
  const page = useAppSelector((state) => state.app.page)
  const conversationActions = useConversationActions()

  /** Opens a conversation in the workspace, same as a sidebar row click. */
  const openTab = useCallback(
    (id: string): void => {
      void conversationActions.openConversation(id)
    },
    [conversationActions],
  )

  /** Deletes one conversation, same as the sidebar row delete button. */
  const deleteTab = useCallback(
    (id: string): void => {
      void conversationActions.deleteConversation(id)
    },
    [conversationActions],
  )

  /** Renames one conversation, same as the sidebar row rename dialog. */
  const renameTab = useCallback(
    (id: string, title: string): Promise<boolean> =>
      conversationActions.renameConversation(id, title),
    [conversationActions],
  )

  /** Creates a new conversation, same as the sidebar new-chat button. */
  const createNewTab = useCallback((): void => {
    void conversationActions.createConversation()
  }, [conversationActions])

  /** Deletes every conversation, same as the sidebar delete-all button. */
  const deleteAllTabs = useCallback((): void => {
    void conversationActions.deleteAllConversations()
  }, [conversationActions])

  /** Moves the selection one step through the conversation list. */
  const cycleTab = useCallback(
    (direction: 1 | -1): void => {
      const ids = conversations.map((item) => item.id)
      if (ids.length === 0) return
      const index = currentConversationId === null ? -1 : ids.indexOf(currentConversationId)
      const base = index === -1 ? (direction === 1 ? -1 : 0) : index
      const next = ids[(base + direction + ids.length) % ids.length]
      if (next !== undefined && next !== currentConversationId) {
        void conversationActions.openConversation(next)
      }
    },
    [conversationActions, conversations, currentConversationId],
  )

  /** Applies browser-like tab shortcuts while the home page is visible. */
  useEffect(() => {
    if (page !== 'home') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        createNewTab()
      } else if (key === 'tab') {
        event.preventDefault()
        cycleTab(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNewTab, cycleTab, page])

  return { createNewTab, cycleTab, deleteAllTabs, deleteTab, openTab, renameTab }
}
