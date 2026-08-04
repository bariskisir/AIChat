/**
 * Renders the horizontal conversation strip above the chat workspace.
 * Mirrors the conversations sidebar: every tab is one chat, opening,
 * renaming, and deleting behave identically to the sidebar rows.
 */

import { useState } from 'react'
import { Button, Dropdown, Input, Modal, Tooltip, type MenuProps } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationSummary } from '@shared/index'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useConversationTabs } from '@renderer/hooks/useConversationTabs'
import { useAppSelector } from '@renderer/store'
import styles from './ConversationTabs.module.scss'

/** Renders every conversation as a tab with sidebar-equivalent rename and delete actions. */
interface ConversationTabsProps {
  expanded: boolean
}

const ConversationTabs = ({ expanded }: ConversationTabsProps): React.JSX.Element | null => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const light = theme === 'light'
  const tabs = useConversationTabs()
  const sidebarOpen = useAppSelector((state) => state.app.conversationsSidebarOpen)
  const conversations = useAppSelector((state) => state.app.conversations)
  const currentConversation = useAppSelector((state) => state.app.currentConversation)
  const generatingConversationIds = useAppSelector((state) => state.app.generatingConversationIds)
  const titleGeneratingConversationId = useAppSelector(
    (state) => state.app.titleGeneratingConversationId,
  )
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  if (sidebarOpen) return null

  const onlyEmptyConversation =
    conversations.length === 1 &&
    conversations[0]?.id === currentConversation?.id &&
    currentConversation?.messages.length === 0

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
    const renamed = await tabs.renameTab(renameTarget.id, renameValue.trim())
    setRenaming(false)
    if (renamed) setRenameTarget(null)
  }

  /** Builds the right-click context menu for a single conversation tab. */
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
    /** Dispatches the selected tab context-menu action. */
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      if (key === 'rename') beginRename(item)
      if (key === 'delete') tabs.deleteTab(item.id)
    },
  })

  return (
    <nav
      className={`${styles.tabBar} ${expanded ? '' : styles.compact}`}
      aria-label={t('nav.conversations')}
    >
      <span className={styles.label}>{t('nav.conversations')}</span>
      <div className={styles.strip}>
        {conversations.map((item) => {
          const active = item.id === currentConversation?.id
          const generating =
            titleGeneratingConversationId === item.id || generatingConversationIds.includes(item.id)
          return (
            <Dropdown key={item.id} menu={conversationMenu(item)} trigger={['contextMenu']}>
              <div
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={`${styles.item} ${active ? styles.active : ''}`}
              >
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => tabs.openTab(item.id)}
                >
                  <span
                    className={`${styles.itemTitle} ${generating ? styles.generatingTitle : ''}`}
                  >
                    {displayTitle(item)}
                  </span>
                </button>
                <Tooltip title={t('common.delete')}>
                  <Button
                    type="text"
                    danger
                    size="small"
                    className={styles.deleteButton ?? ''}
                    aria-label={t('common.delete')}
                    icon={<Trash2 size={13} />}
                    disabled={onlyEmptyConversation}
                    onClick={(event) => {
                      event.stopPropagation()
                      tabs.deleteTab(item.id)
                    }}
                  />
                </Tooltip>
              </div>
            </Dropdown>
          )
        })}
      </div>
      <div className={styles.actions}>
        <Tooltip title={t('conversations.deleteAll')}>
          <Button
            type="text"
            danger
            size="small"
            className={styles.actionDanger ?? ''}
            aria-label={t('conversations.deleteAll')}
            icon={<Trash2 size={15} />}
            disabled={conversations.length === 0 || onlyEmptyConversation}
            onClick={tabs.deleteAllTabs}
          />
        </Tooltip>
        <Tooltip title={t('conversations.newConversation')}>
          <Button
            type="text"
            size="small"
            className={styles.actionButton ?? ''}
            aria-label={t('conversations.newConversation')}
            icon={<Plus size={15} />}
            onClick={tabs.createNewTab}
          />
        </Tooltip>
      </div>
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
          maxLength={200}
          autoFocus
          placeholder={t('conversations.renameConversation')}
          onChange={(event) => setRenameValue(event.target.value)}
          onPressEnter={() => void commitRename()}
        />
      </Modal>
    </nav>
  )
}

export default ConversationTabs
