/** Renders streamed model reasoning as a compact expandable thinking block. */

import { useEffect, useMemo, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { ChevronRight, Copy, Lightbulb } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useTranslation } from 'react-i18next'
import MarkdownSvg from './markdown/MarkdownSvg'
import { useMinimumDisplayDuration } from './useMinimumDisplayDuration'
import styles from './ThinkingBlock.module.scss'

/** Properties accepted by the streamed reasoning presentation. */
export interface ThinkingBlockProps {
  content: string
  streaming: boolean
  startedAt?: number | undefined
}

/** Minimum time the live preview stays visible after the stream stops. */
const THINKING_PREVIEW_MIN_DURATION_MS = 1_000

/** Converts elapsed milliseconds into tenths of a second. */
const formatSeconds = (milliseconds: number): string =>
  (Math.max(100, milliseconds) / 1_000).toFixed(1)

/** Displays a live compact preview and an expandable Markdown reasoning body. */
const ThinkingBlock = ({
  content,
  streaming,
  startedAt,
}: ThinkingBlockProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [tick, setTick] = useState(0)
  void tick
  const preview = useMemo(
    () =>
      content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1) ?? '',
    [content],
  )
  const stablePreview = useMinimumDisplayDuration(streaming ? preview : '', {
    enabled: streaming,
    minimumDurationMs: THINKING_PREVIEW_MIN_DURATION_MS,
  })

  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => setTick((v) => v + 1), 100)
    return () => window.clearInterval(timer)
  }, [streaming])

  const elapsed = streaming && startedAt ? Date.now() - startedAt : 0
  const seconds = formatSeconds(elapsed)
  const status = streaming
    ? t('chat.thinkingActive', { seconds })
    : elapsed > 0
      ? t('chat.thoughtFor', { seconds })
      : t('chat.reasoning')

  /** Copies the complete reasoning transcript to the system clipboard. */
  const copyReasoning = async (): Promise<void> => {
    await navigator.clipboard.writeText(content)
  }

  return (
    <section className={`${styles.container} ${expanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`${styles.icon} ${streaming ? styles.thinking : ''}`}>
          <Lightbulb size={15} />
        </span>
        <span className={styles.heading}>
          <strong>{status}</strong>
          {!expanded && stablePreview && <small>{stablePreview}</small>}
        </span>
        <ChevronRight className={styles.chevron} size={18} />
      </button>
      {expanded && (
        <div className={styles.content}>
          {!streaming && (
            <Tooltip title={t('chat.copy')}>
              <Button
                type="text"
                size="small"
                className={styles.copyButton ?? ''}
                icon={<Copy size={13} />}
                onClick={() => void copyReasoning()}
              />
            </Tooltip>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{ svg: MarkdownSvg }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </section>
  )
}

export default ThinkingBlock
