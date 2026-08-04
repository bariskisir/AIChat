/**
 * Renders the horizontal conversation strip above the chat workspace.
 * Mirrors the conversations sidebar: every tab is one chat, opening and
 * deleting behave identically to the sidebar rows.
 */

import { Button, Tooltip } from 'antd'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConversationTabs } from '@renderer/hooks/useConversationTabs'
import { useAppSelector } from '@renderer/store'
import styles from './ConversationTabs.module.scss'

/** Renders every conversation as a tab with sidebar-equivalent delete actions. */
interface ConversationTabsProps {
  expanded: boolean
}

const ConversationTabs = ({ expanded }: ConversationTabsProps): React.JSX.Element | null => {
  const { t } = useTranslation()
  const tabs = useConversationTabs()
  const sidebarOpen = useAppSelector((state) => state.app.conversationsSidebarOpen)
  const conversations = useAppSelector((state) => state.app.conversations)
  const currentConversation = useAppSelector((state) => state.app.currentConversation)
  const generatingConversationIds = useAppSelector((state) => state.app.generatingConversationIds)
  const titleGeneratingConversationId = useAppSelector(
    (state) => state.app.titleGeneratingConversationId,
  )

  if (sidebarOpen) return null

  const onlyEmptyConversation =
    conversations.length === 1 &&
    conversations[0]?.id === currentConversation?.id &&
    currentConversation?.messages.length === 0

  const displayTitle = (item: (typeof conversations)[number]): string =>
    item.isDefaultTitle ? t('conversations.newConversation') : item.title

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
            <div
              key={item.id}
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
                <span className={`${styles.itemTitle} ${generating ? styles.generatingTitle : ''}`}>
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
    </nav>
  )
}

export default ConversationTabs
