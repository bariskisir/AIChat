/** Renders one message with Markdown, reasoning, citations, token usage, and direct actions. */

import { memo, useMemo } from 'react'
import { Button, Image as AntImage, Tooltip } from 'antd'
import { Bot, Copy, GitBranch, Pencil, RefreshCw, Trash2, User, Users } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkAlert from 'remark-github-blockquote-alert'
import remarkMath from 'remark-math'
import { useTranslation } from 'react-i18next'
import { estimateTextTokens, type ChatMessage } from '@shared/index'
import {
  citationHostname,
  findCitationInChildren,
  withCitationTags,
  type CitationTagData,
} from '@renderer/utils/citations'
import { convertLatexDelimiters, stripBlankLinesInSvg } from '@renderer/utils/markdown'
import { getModelLogo } from '@renderer/utils/modelLogos'
import { createStreamingTextProjection } from '@renderer/utils/streamingProjection'
import 'katex/dist/katex.min.css'
import 'remark-github-blockquote-alert/alert.css'
import ThinkingBlock from './ThinkingBlock'
import SearchBlock from './SearchBlock'
import TokenUsageCard from './TokenUsageCard'
import CodeBlock from './markdown/CodeBlock'
import ImageViewer from './markdown/ImageViewer'
import MarkdownTable from './markdown/MarkdownTable'
import MarkdownSvg from './markdown/MarkdownSvg'
import ShadowDomStyle from './markdown/ShadowDomStyle'
import remarkDisableConstructs from './markdown/remarkDisableConstructs'
import rehypeHeadingIds from './markdown/rehypeHeadingIds'
import rehypeScalableSvg from './markdown/rehypeScalableSvg'
import styles from './MessageBubble.module.scss'

/** Raw HTML elements permitted in model output. */
const ALLOWED_ELEMENTS =
  /<(style|p|div|span|b|i|strong|em|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|blockquote|pre|code|br|hr|svg|path|circle|rect|line|polyline|polygon|text|g|defs|title|desc|tspan|sub|sup|details|summary)/i
/** Raw HTML elements never rendered from model output. */
const DISALLOWED_ELEMENTS = ['iframe', 'script']

/** User interactions exposed by one message row. */
export interface MessageBubbleProps {
  message: ChatMessage
  modelLabel: string
  expanded?: boolean
  onEdit: () => void
  onRegenerate: () => void
  onAnotherModel: () => void
  onDelete: () => void
  onBranch: () => void
}

/** Allows regular safe Markdown URLs plus generated in-memory image data URLs. */
const transformUrl = (url: string): string =>
  url.startsWith('data:image/png') || url.startsWith('data:image/jpeg')
    ? url
    : defaultUrlTransform(url)

/** Opens one Markdown link through the trusted system-browser bridge. */
const MarkdownLink: Components['a'] = ({ href, children }) => (
  <button
    type="button"
    className={styles.link}
    onClick={() => href && void window.app.openExternal(href)}
  >
    {children}
  </button>
)

/** Citation tooltip card with title, snippet, and hostname. */
const CitationTooltipCard = ({ citation }: { citation: CitationTagData }): React.JSX.Element => (
  <div className={styles.citationTooltipCard}>
    <div className={styles.citationTooltipTitle}>
      {citation.title || citationHostname(citation.url)}
    </div>
    {citation.content && <div className={styles.citationTooltipContent}>{citation.content}</div>}
    <div className={styles.citationTooltipHost}>{citationHostname(citation.url)}</div>
  </div>
)

/** Renders Markdown links, turning citation-tagged links into tooltip superscripts. */
const CitationSup: Components['a'] = ({ href, children }) => {
  const citationData = findCitationInChildren(children)
  if (citationData) {
    let parsed: CitationTagData
    try {
      parsed = JSON.parse(citationData)
    } catch {
      return <MarkdownLink href={href}>{children}</MarkdownLink>
    }
    return (
      <Tooltip arrow={false} placement="top" title={<CitationTooltipCard citation={parsed} />}>
        <sup className={styles.citationSup}>
          <button
            type="button"
            className={styles.citationSupButton}
            onClick={() => parsed.url && void window.app.openExternal(parsed.url)}
          >
            {parsed.id}
          </button>
        </sup>
      </Tooltip>
    )
  }
  return <MarkdownLink href={href}>{children}</MarkdownLink>
}

/** Displays a durable user or assistant message and its context-sensitive direct actions. */
const MessageBubble = ({
  message,
  modelLabel,
  expanded,
  onEdit,
  onRegenerate,
  onAnotherModel,
  onDelete,
  onBranch,
}: MessageBubbleProps): React.JSX.Element => {
  const { t } = useTranslation()
  const assistant = message.role === 'assistant'
  const userTokenCount = message.tokenCount ?? estimateTextTokens(message.content)

  const searchQueries = message.searchQueries ?? []
  const searchRunning = searchQueries.some((sq) => sq.done !== true)
  const searchFailed = searchQueries.every((sq) => sq.done === true && sq.count < 0)
  const searchCount = searchQueries.reduce(
    (sum, sq) => (sq.done === true && sq.count >= 0 ? sum + sq.count : sum),
    0,
  )
  const modelLogo = assistant
    ? getModelLogo(message.model ? { modelId: message.model.modelId } : undefined)
    : undefined

  const markdownContent = useMemo(() => {
    const padded = withCitationTags(message.content, message.citations ?? [])
    const viewContent =
      message.status === 'streaming'
        ? createStreamingTextProjection(padded, ({ language, lineCount, charCount }) =>
            t('chat.codeBlockProgress', {
              language,
              lines: lineCount.toLocaleString(),
              characters: charCount.toLocaleString(),
            }),
          )
        : padded
    return stripBlankLinesInSvg(convertLatexDelimiters(viewContent))
  }, [message.content, message.citations, message.status, t])

  const remarkPlugins = useMemo<PluggableList>(
    () => [
      [remarkGfm, { singleTilde: false }],
      remarkAlert,
      remarkCjkFriendly,
      remarkDisableConstructs(['codeIndented']),
      remarkMath,
    ],
    [],
  )

  const rehypePlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = []
    if (ALLOWED_ELEMENTS.test(markdownContent)) {
      plugins.push(rehypeRaw, rehypeScalableSvg)
    }
    plugins.push(rehypeHeadingIds, rehypeKatex)
    return plugins
  }, [markdownContent])

  const components = useMemo(() => {
    const map: Partial<Components> = {
      a: CitationSup,
      code: CodeBlock,
      /** Wraps Markdown tables with source-aware copy controls. */
      table: (props) => (
        <MarkdownTable
          onCopy={async () => {
            const position = props.node?.position
            if (!position?.start?.line || !position.end?.line) return ''
            return message.content
              .split('\n')
              .slice(position.start.line - 1, position.end.line)
              .join('\n')
              .trim()
          }}
        >
          {props.children}
        </MarkdownTable>
      ),
      /** Renders Markdown images with preview and context-menu actions. */
      img: ({ node, style: _style, ...rest }) => <ImageViewer {...rest} />,
      svg: MarkdownSvg,
      /** Lets fenced-code containers expose their own overflow behavior. */
      pre: ({ node, className, ...rest }) => (
        <pre className={`${styles.markdownPre} ${className ?? ''}`} {...rest} />
      ),
      /** Avoids invalid paragraph nesting when a paragraph contains an image. */
      p: ({ node, ...rest }) => {
        const hasImage = node?.children.some(
          (child) => child.type === 'element' && child.tagName === 'img',
        )
        if (hasImage) return <div {...rest} />
        return <p {...rest} />
      },
      /** Scopes model-authored style tags to a shadow-root subtree. */
      style: (props) => <ShadowDomStyle>{props.children}</ShadowDomStyle>,
    }
    return map
  }, [message.content])

  /** True when the message renders multiple images, enabling grouped prev/next preview. */
  const hasMultipleImages = useMemo(() => {
    const images = message.content.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []
    return images.length > 1
  }, [message.content])

  /** Copies only the readable message content to the system clipboard. */
  const copyMessage = async (): Promise<void> => {
    await navigator.clipboard.writeText(message.content)
  }

  /** Renders the message body, grouped so multiple images share prev/next navigation. */
  const markdownElement = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      disallowedElements={DISALLOWED_ELEMENTS}
      urlTransform={transformUrl}
    >
      {markdownContent}
    </ReactMarkdown>
  )

  return (
    <article
      className={`${styles.message} ${assistant ? styles.assistant : ''} ${expanded ? styles.messageExpanded : ''}`}
    >
      {modelLogo ? (
        <div className={styles.avatarPlain}>
          <img src={modelLogo} alt="" />
        </div>
      ) : (
        <div className={styles.avatar}>{assistant ? <Bot size={17} /> : <User size={17} />}</div>
      )}
      <div className={styles.body}>
        <header className={styles.header}>
          <strong>{assistant ? modelLabel || t('chat.assistant') : t('chat.you')}</strong>
          {message.status === 'streaming' && (
            <span className={styles.generating}>{t('chat.generating')}</span>
          )}
          {message.status === 'stopped' && <span>{t('chat.stopped')}</span>}
          {message.status === 'error' && (
            <span className={styles.error}>{t('chat.requestFailed')}</span>
          )}
        </header>
        {message.status === 'error' &&
          message.error &&
          message.error !== t('chat.requestFailed') && (
            <div className={styles.errorDetails}>{message.error}</div>
          )}
        {message.attachments && message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {message.attachments.map((attachment) => (
              <span key={attachment.id}>{attachment.name}</span>
            ))}
          </div>
        )}
        {message.reasoning && (
          <ThinkingBlock
            content={message.reasoning}
            streaming={message.status === 'streaming'}
            startedAt={message.reasoningStartedAt}
          />
        )}
        {searchQueries.length > 0 && (
          <SearchBlock
            running={searchRunning}
            failed={searchFailed}
            count={searchCount}
            engine={searchQueries[0]?.engine ?? ''}
            citations={message.citations ?? []}
          />
        )}
        <div className={styles.markdown}>
          {message.content ? (
            hasMultipleImages ? (
              <AntImage.PreviewGroup>{markdownElement}</AntImage.PreviewGroup>
            ) : (
              markdownElement
            )
          ) : message.status === 'streaming' ? (
            <span className={styles.cursor}>●</span>
          ) : null}
        </div>
        {assistant && message.usage ? (
          <TokenUsageCard usage={message.usage} message={message} />
        ) : !assistant && userTokenCount > 0 ? (
          <div className={styles.usage}>
            <span>{t('chat.estimatedTokens', { count: userTokenCount })}</span>
          </div>
        ) : null}
        <div className={styles.actions}>
          <Tooltip title={t('chat.copy')}>
            <Button
              type="text"
              size="small"
              icon={<Copy size={14} />}
              onClick={() => void copyMessage()}
            />
          </Tooltip>
          {assistant ? (
            <>
              <Tooltip title={t('chat.regenerate')}>
                <Button
                  type="text"
                  size="small"
                  icon={<RefreshCw size={14} />}
                  onClick={onRegenerate}
                />
              </Tooltip>
              <Tooltip title={t('chat.anotherModel')}>
                <Button
                  type="text"
                  size="small"
                  icon={<Users size={14} />}
                  onClick={onAnotherModel}
                />
              </Tooltip>
            </>
          ) : (
            <Tooltip title={t('common.edit')}>
              <Button type="text" size="small" icon={<Pencil size={14} />} onClick={onEdit} />
            </Tooltip>
          )}
          <Tooltip title={t('chat.newBranch')}>
            <Button type="text" size="small" icon={<GitBranch size={14} />} onClick={onBranch} />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <Button
              type="text"
              danger
              size="small"
              icon={<Trash2 size={14} />}
              onClick={onDelete}
            />
          </Tooltip>
        </div>
      </div>
    </article>
  )
}

export default memo(MessageBubble, (prev, next) => {
  return (
    prev.message === next.message &&
    prev.modelLabel === next.modelLabel &&
    prev.expanded === next.expanded
  )
})
