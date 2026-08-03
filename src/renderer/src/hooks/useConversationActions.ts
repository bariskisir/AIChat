/**
 * Exposes renderer commands for conversation workspace management.
 */

import { useCallback } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  addConversationSummary,
  removeConversationSummary,
  replaceCurrentConversation,
  replaceConversationSummary,
  setCurrentConversation,
} from '@renderer/store/appSlice'
import { toConversationSummary } from '@renderer/utils/formatters'

const logger = createLogger('ConversationActions')
let selectionRevision = 0

/** Returns stable local conversation management commands. */
export const useConversationActions = () => {
  const dispatch = useAppDispatch()
  const conversations = useAppSelector((state) => state.app.conversations)
  const currentConversationId = useAppSelector((state) => state.app.currentConversation?.id ?? null)
  const { message } = AntdApp.useApp()
  const { t } = useTranslation()

  /** Loads a complete conversation from local storage. */
  const openConversation = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const conversation = await window.app.getConversation(id)
        if (!conversation) {
          dispatch(removeConversationSummary(id))
          if (conversations.length === 1) {
            const replacement = await window.app.createConversation()
            dispatch(addConversationSummary(toConversationSummary(replacement)))
            if (revision === selectionRevision) dispatch(setCurrentConversation(replacement))
          } else if (currentConversationId === id) {
            const next = conversations.find((item) => item.id !== id)
            if (next) {
              const loaded = await window.app.getConversation(next.id)
              if (loaded && revision === selectionRevision) dispatch(setCurrentConversation(loaded))
            }
          }
          return
        }
        if (revision === selectionRevision) dispatch(setCurrentConversation(conversation))
      } catch (error) {
        if (revision !== selectionRevision) return
        logger.error('Conversation could not be loaded.', error)
        void message.error(t('errors.generic'))
      }
    },
    [dispatch, message, conversations, currentConversationId, t],
  )

  /** Creates and selects a new conversation workspace. */
  const createConversation = useCallback(async (): Promise<void> => {
    const revision = ++selectionRevision
    try {
      const conversation = await window.app.createConversation()
      dispatch(addConversationSummary(toConversationSummary(conversation)))
      if (revision === selectionRevision) dispatch(setCurrentConversation(conversation))
    } catch (error) {
      logger.error('Conversation workspace could not be created.', error)
      void message.error(t('errors.generic'))
    }
  }, [dispatch, message, t])

  /** Renames a conversation and synchronizes the active document and summary. */
  const renameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const conversation = await window.app.renameConversation(id, title)
        dispatch(replaceCurrentConversation(conversation))
        dispatch(replaceConversationSummary(toConversationSummary(conversation)))
        return true
      } catch (error) {
        logger.error('Conversation could not be renamed.', error)
        void message.error(t('errors.generic'))
        return false
      }
    },
    [dispatch, message, t],
  )

  /** Deletes one conversation; the final conversation is always replaced by a fresh empty one. */
  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      const revision = ++selectionRevision
      try {
        const result = await window.app.deleteConversation(id)
        if (!result.deleted) return
        dispatch(removeConversationSummary(id))
        if (result.replacement) {
          dispatch(addConversationSummary(toConversationSummary(result.replacement)))
          if (revision === selectionRevision) dispatch(setCurrentConversation(result.replacement))
          return
        }

        if (currentConversationId !== id) return
        const remaining = conversations.filter((item) => item.id !== id)
        const nextConversation =
          remaining[0] !== undefined ? await window.app.getConversation(remaining[0].id) : null
        if (nextConversation) {
          if (revision === selectionRevision) dispatch(setCurrentConversation(nextConversation))
          return
        }
        const fresh = await window.app.createConversation()
        dispatch(addConversationSummary(toConversationSummary(fresh)))
        if (revision === selectionRevision) dispatch(setCurrentConversation(fresh))
      } catch (error) {
        logger.error('Conversation could not be deleted.', error)
        void message.error(t('errors.generic'))
      }
    },
    [currentConversationId, dispatch, conversations, message, t],
  )

  /** Deletes every topic and leaves a fresh empty conversation selected. */
  const deleteAllConversations = useCallback(async (): Promise<void> => {
    try {
      const conversation = await window.app.deleteAllConversations()
      for (const item of conversations) dispatch(removeConversationSummary(item.id))
      dispatch(addConversationSummary(toConversationSummary(conversation)))
      dispatch(setCurrentConversation(conversation))
    } catch (error) {
      logger.error('Conversations could not be deleted.', error)
      void message.error(t('errors.generic'))
    }
  }, [dispatch, conversations, message, t])

  return {
    createConversation,
    deleteConversation,
    deleteAllConversations,
    openConversation,
    renameConversation,
  }
}
