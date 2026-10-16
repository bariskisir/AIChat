/**
 * Bootstraps renderer state and binds main-to-renderer lifecycle events.
 */

import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import i18n from '@renderer/i18n'
import { createLogger } from '@renderer/services/LoggerService'
import { hydrate, setPage, setUpdateState } from '@renderer/store/appSlice'
import { useAppDispatch, useAppSelector } from '@renderer/store'

const logger = createLogger('AppInit')

/** Loads persisted state and maintains typed IPC subscriptions for the app lifetime. */
export const useAppInit = (): void => {
  const dispatch = useAppDispatch()
  const initialized = useAppSelector((state) => state.app.initialized)
  const sidebarOpen = useAppSelector((state) => state.app.conversationsSidebarOpen)
  const sidebarWidth = useAppSelector((state) => state.app.conversationsSidebarWidth)
  const { message } = AntdApp.useApp()
  const messageRef = useRef(message)

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    if (!initialized) return
    void window.app
      .setSidebarState({ open: sidebarOpen, width: sidebarWidth })
      .catch((error) => logger.warn('Conversation sidebar state could not be persisted.', error))
  }, [initialized, sidebarOpen, sidebarWidth])

  useEffect(() => {
    let active = true
    const cleanup = [
      window.app.onUpdateState((event) => dispatch(setUpdateState(event))),
      window.app.onSettingsOpenRequested(() => dispatch(setPage('settings'))),
    ]

    void window.app
      .bootstrap()
      .then(async (payload) => {
        if (!active) return
        dispatch(hydrate(payload))
        document.documentElement.lang = payload.settings.language
        await i18n.changeLanguage(payload.settings.language)
      })
      .catch((error) => {
        logger.error('Renderer bootstrap failed.', error)
        void messageRef.current.error(i18n.t('errors.generic'))
      })

    return () => {
      active = false
      cleanup.forEach((unsubscribe) => {
        unsubscribe()
      })
    }
  }, [dispatch])
}
