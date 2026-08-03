/** Renders message token usage as a compact trigger with a visual hover card. */

import { ArrowDown, ArrowUp, Clock, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from 'antd'
import type { ChatMessage, TokenUsage } from '@shared/index'
import styles from './MessageBubble.module.scss'

interface TokenUsageCardProps {
  usage: TokenUsage
  message: ChatMessage
  modelLabel: string
}

/** Formats an elapsed-milliseconds duration into a short human label. */
const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, milliseconds) / 1_000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** Compact token breakdown with model, timing, and totals on hover. */
const TokenUsageCard = ({ usage, message, modelLabel }: TokenUsageCardProps): React.JSX.Element => {
  const { t } = useTranslation()

  const elapsed = message.reasoningStartedAt ? Date.now() - message.reasoningStartedAt : null

  const details = (
    <div className={styles.tokenCard}>
      <div className={styles.tokenCardHeader}>
        <span className={styles.tokenCardTitle}>{modelLabel}</span>
        <span className={styles.tokenCardTime}>
          <Clock size={11} />
          {message.reasoningStartedAt
            ? formatDuration(elapsed ?? 0)
            : new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div className={styles.tokenCardRow}>
        <span>
          <ArrowUp size={11} />
          {t('chat.inputTokens', { count: usage.promptTokens })}
        </span>
        <span>
          <ArrowDown size={11} />
          {t('chat.outputTokens', { count: usage.completionTokens })}
        </span>
      </div>
      <div className={styles.tokenCardTotal}>
        <Layers size={11} />
        {t('chat.totalTokens', {
          count: usage.totalTokens ?? usage.promptTokens + usage.completionTokens,
        })}
      </div>
    </div>
  )

  return (
    <Tooltip arrow={false} placement="top" title={details} mouseEnterDelay={0.4}>
      <div className={styles.usage}>
        <span>
          <ArrowUp size={11} />
          {t('chat.inputTokens', { count: usage.promptTokens })}
        </span>
        <span>
          <ArrowDown size={11} />
          {t('chat.outputTokens', { count: usage.completionTokens })}
        </span>
      </div>
    </Tooltip>
  )
}

export default TokenUsageCard
