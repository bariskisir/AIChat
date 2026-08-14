/**
 * Manages saved conversations in the collapsible workspace sidebar.
 */

import { useEffect, useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, type MenuProps } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationSummary } from '@shared/index'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useConversationActions } from '@renderer/hooks/useConversationActions'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setConversationsSidebarWidth } from '@renderer/store/appSlice'
import styles from './ConversationsSidebar.module.scss'

const MIN_SIDEBAR_WIDTH = 100
const SIDEBAR_WIDTH_KEY = 'conversationsSidebarWidth'

/** Renders new, open, rename, delete, and collapse actions for locally persisted conversations. */
const ConversationsSidebar = (): React.JSX.Element => {
  const conversations = useAppSelector((state) => state.app.conversations)
  const currentConversation = useAppSelector((state) => state.app.currentConversation)
  const sidebarOpen = useAppSelector((state) => state.app.conversationsSidebarOpen)
  const sidebarWidth = useAppSelector((state) => state.app.conversationsSidebarWidth)
  const generatingConversationIds = useAppSelector((state) => state.app.generatingConversationIds)
  const titleGeneratingConversationId = useAppSelector(
    (state) => state.app.titleGeneratingConversationId,
  )
  const dispatch = useAppDispatch()
  const actions = useConversationActions()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const [resizing, setResizing] = useState(false)

  /** Restores the previously dragged sidebar width from local storage on mount. */
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (stored !== null) {
      const parsed = Number(stored)
      if (Number.isFinite(parsed)) {
        const maxFit = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 160)
        dispatch(
          setConversationsSidebarWidth(Math.min(Math.max(parsed, MIN_SIDEBAR_WIDTH), maxFit)),
        )
      }
    }
  }, [dispatch])

  /** Persists the sidebar width so it survives application restarts. */
  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  }, [sidebarWidth])

  /** Shrinks the sidebar when the window becomes too narrow for it and the chat. */
  useEffect(() => {
    /** Clamps the persisted sidebar width to the space available after a window resize. */
    const onResize = (): void => {
      const maxFit = Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 160)
      if (sidebarWidth > maxFit) dispatch(setConversationsSidebarWidth(maxFit))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sidebarWidth, dispatch])

  /** Tracks pointer movement to resize the sidebar until the pointer is released. */
  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    setResizing(true)
    const startX = event.clientX
    const startWidth = sidebarWidth
    document.body.classList.add('conversations-sidebar-resizing')
    /** Applies the pointer delta to the current sidebar width. */
    const onMove = (moveEvent: PointerEvent): void => {
      const next = startWidth + moveEvent.clientX - startX
      dispatch(setConversationsSidebarWidth(Math.max(next, MIN_SIDEBAR_WIDTH)))
    }
    /** Finishes resizing and removes the temporary global pointer listeners. */
    const onUp = (): void => {
      document.body.classList.remove('conversations-sidebar-resizing')
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const onlyEmptyConversation =
    conversations.length === 1 &&
    conversations[0]?.id === currentConversation?.id &&
    currentConversation?.messages.length === 0

  /** Resolves a generated title from the active interface locale while preserving custom names. */
  const displayTitle = (item: ConversationSummary): string =>
    item.isDefaultTitle ? t('conversations.newConversation') : item.title

  /** Opens the rename dialog with the selected conversation's current title. */
  const beginRename = (item: ConversationSummary): void => {
    setRenameTarget(item)
    setRenameValue(displayTitle(item))
  }

  /** Persists the edited title and closes the dialog after a successful update. */
  const commitRename = async (): Promise<void> => {
    if (!renameTarget || !renameValue.trim()) return
    setRenaming(true)
    const renamed = await actions.renameConversation(renameTarget.id, renameValue.trim())
    setRenaming(false)
    if (renamed) setRenameTarget(null)
  }

  /** Deletes every conversation in one atomic step and keeps an empty chat selected. */
  const deleteAllConversations = async (): Promise<void> => {
    if (deletingAll) return
    setDeletingAll(true)
    try {
      await actions.deleteAllConversations()
    } finally {
      setDeletingAll(false)
    }
  }

  /** Builds the right-click context menu for a single conversation row. */
  const conversationMenu = (item: ConversationSummary): MenuProps => ({
    items: [
      { key: 'rename', icon: <Pencil size={14} />, label: t('common.rename') },
      { type: 'divider' },
      {
        key: 'delete',
        danger: true,
        disabled: onlyEmptyConversation,
        icon: <Trash2 size={14} />,
        label: t('common.delete'),
      },
    ],
    /** Dispatches the selected conversation context-menu action. */
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'rename') beginRename(item)
      if (key === 'delete') void actions.deleteConversation(item.id)
    },
  })

  return (
    <>
      <aside
        className={`${styles.container} ${sidebarOpen ? '' : styles.collapsed} ${resizing ? styles.resizing : ''}`}
        data-sidebar-width={sidebarWidth}
        aria-hidden={!sidebarOpen}
      >
        {sidebarOpen && (
          <>
            <div className={styles.resizeHandle} aria-hidden="true" onPointerDown={beginResize} />
            <header className={styles.header}>
              <span>{t('nav.conversations')}</span>
              <div className={styles.headerActions}>
                <Button
                  type="text"
                  danger
                  size="small"
                  aria-label={t('conversations.deleteAll')}
                  icon={<Trash2 size={15} />}
                  disabled={deletingAll || conversations.length === 0 || onlyEmptyConversation}
                  onClick={() => void deleteAllConversations()}
                />
                <Button
                  type="text"
                  size="small"
                  aria-label={t('conversations.newConversation')}
                  icon={<Plus size={15} />}
                  onClick={() => void actions.createConversation()}
                />
              </div>
            </header>

            <div className={styles.scrollArea}>
              {conversations.length === 0 ? (
                <div className={styles.emptyWrap}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('conversations.emptyTitle')}
                  />
                </div>
              ) : (
                <div className={styles.list}>
                  {conversations.map((item) => (
                    <Dropdown key={item.id} menu={conversationMenu(item)} trigger={['contextMenu']}>
                      <div
                        className={`${styles.item} ${currentConversation?.id === item.id ? styles.active : ''}`}
                      >
                        <button
                          type="button"
                          className={styles.openButton}
                          onClick={() => void actions.openConversation(item.id)}
                        >
                          <span className={styles.itemBody}>
                            <span
                              className={`${styles.itemTitle} ${
                                titleGeneratingConversationId === item.id ||
                                generatingConversationIds.includes(item.id)
                                  ? styles.generatingTitle
                                  : ''
                              }`}
                            >
                              {displayTitle(item)}
                            </span>
                          </span>
                        </button>
                        <Button
                          className={styles.deleteButton ?? ''}
                          type="text"
                          danger
                          size="small"
                          aria-label={t('common.delete')}
                          icon={<Trash2 size={13} />}
                          disabled={onlyEmptyConversation}
                          onClick={() => void actions.deleteConversation(item.id)}
                        />
                      </div>
                    </Dropdown>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </aside>
      <Modal
        title={t('conversations.renameConversation')}
        open={renameTarget !== null}
        okText={t('common.rename')}
        cancelText={t('common.cancel')}
        confirmLoading={renaming}
        okButtonProps={{
          disabled: !renameValue.trim(),
          ...(light ? { ghost: true as const } : {}),
        }}
        onOk={() => void commitRename()}
        onCancel={() => setRenameTarget(null)}
        destroyOnHidden
      >
        <Input
          className={styles.renameInput}
          value={renameValue}
          placeholder={t('conversations.renameConversation')}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            void commitRename()
          }}
        />
      </Modal>
    </>
  )
}

export default ConversationsSidebar
