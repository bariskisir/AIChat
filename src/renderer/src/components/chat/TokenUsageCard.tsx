/** Renders message token usage with timing inline next to the token counts. */

import { ArrowDown, ArrowUp, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, TokenUsage } from '@shared/index'
import styles from './MessageBubble.module.scss'

interface TokenUsageCardProps {
  usage: TokenUsage
  message: ChatMessage
}

/** Formats an elapsed-milliseconds duration into a short human label. */
const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, milliseconds) / 1_000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return `${minutes}m ${rest}s`
}

/** Inline token breakdown with duration, no hover popup. */
const TokenUsageCard = ({ usage, message }: TokenUsageCardProps): React.JSX.Element => {
  const { t } = useTranslation()

  const elapsed =
    message.durationMs !== undefined
      ? message.durationMs
      : message.status === 'streaming' && message.reasoningStartedAt
        ? Date.now() - message.reasoningStartedAt
        : null

  return (
    <div className={styles.usage}>
      <span>
        <ArrowUp size={11} />
        {t('chat.inputTokens', { count: usage.promptTokens })}
      </span>
      <span>
        <ArrowDown size={11} />
        {t('chat.outputTokens', { count: usage.completionTokens })}
      </span>
      <span>
        <Clock size={11} />
        {elapsed !== null
          ? formatDuration(elapsed)
          : new Date(message.createdAt).toLocaleTimeString()}
      </span>
    </div>
  )
}

export default TokenUsageCard
