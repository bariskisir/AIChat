/**
 * Builds identity-stable react-markdown component maps so streaming deltas never
 * churn component identities inside message bubbles.
 */

import { useMemo, useRef } from 'react'
import { Tooltip } from 'antd'
import type { Components } from 'react-markdown'
import type { ChatMessage } from '@shared/index'
import {
  citationHostname,
  findCitationInChildren,
  type CitationTagData,
} from '@renderer/utils/citations'
import styles from '../MessageBubble.module.scss'
import CodeBlock from './CodeBlock'
import ImageViewer from './ImageViewer'
import MarkdownSvg from './MarkdownSvg'
import MarkdownTable from './MarkdownTable'
import ShadowDomStyle from './ShadowDomStyle'

/** Type of one concrete renderer function accepted by react-markdown. */

/** Opens one Markdown link through the trusted system-browser bridge. */
const MarkdownLink: NonNullable<Components['a']> = ({ href, children }) => (
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
const CitationSup: NonNullable<Components['a']> = ({ href, children }) => {
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

/** Builds the Markdown table renderer whose copy handler reads a live content getter. */
const createTableComponent =
  (getMessageContent: () => string): NonNullable<Components['table']> =>
  (props) => (
    <MarkdownTable
      onCopy={async () => {
        const position = props.node?.position
        if (!position?.start?.line || !position.end?.line) return ''
        return getMessageContent()
          .split('\n')
          .slice(position.start.line - 1, position.end.line)
          .join('\n')
          .trim()
      }}
    >
      {props.children}
    </MarkdownTable>
  )

/** Maps every static renderer once so streaming deltas never recreate it. */
const STATIC_COMPONENTS: Partial<Components> = {
  a: CitationSup,
  code: CodeBlock,
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

/** Builds one Markdown component map, adding the message-bound table renderer. */
export const createMarkdownComponents = (getMessageContent: () => string): Partial<Components> => ({
  ...STATIC_COMPONENTS,
  table: createTableComponent(getMessageContent),
})

/** Returns an identity-stable Markdown component map that reads message content lazily. */
export const useStableMarkdownComponents = (message: ChatMessage): Partial<Components> => {
  const contentRef = useRef(message.content)
  contentRef.current = message.content
  return useMemo(() => createMarkdownComponents(() => contentRef.current), [])
}
