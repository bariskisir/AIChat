/** Code block with hover toolbar, source/preview/split views, and diagram previews. */

import { App, Dropdown, Tooltip } from 'antd'
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  CodeXml,
  Download,
  EllipsisVertical,
  Eye,
  FileCode,
  Image,
  Square,
  SquareSplitHorizontal,
  Text as UnwrapIcon,
  WrapText as WrapIcon,
} from 'lucide-react'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from '../../MessageBubble.module.scss'
import { MAX_COLLAPSED_CODE_HEIGHT, SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from './constants'
import type { BasicPreviewHandles, ViewMode } from './types'

interface CodeBlockViewProps {
  children: string
  language: string
}

interface ToolSpec {
  id: string
  type: 'quick' | 'core'
  icon: React.ReactNode
  tooltip?: string
  visible?: () => boolean
  onClick?: () => void
  children?: Array<{ id: string; icon: React.ReactNode; tooltip: string; onClick: () => void }>
}

/** Maps a language name to its file extension for downloads. */
const getExtensionByLanguage = (language: string): string => {
  const extensions: Record<string, string> = {
    bash: '.sh',
    c: '.c',
    cpp: '.cpp',
    css: '.css',
    dot: '.gv',
    go: '.go',
    graphviz: '.gv',
    html: '.html',
    java: '.java',
    js: '.js',
    json: '.json',
    jsx: '.jsx',
    markdown: '.md',
    md: '.md',
    mermaid: '.mmd',
    plantuml: '.puml',
    py: '.py',
    python: '.py',
    rust: '.rs',
    scss: '.scss',
    sh: '.sh',
    sql: '.sql',
    svg: '.svg',
    ts: '.ts',
    tsx: '.tsx',
    xml: '.xml',
    yaml: '.yml',
    yml: '.yml',
  }
  return extensions[language] ?? ''
}

/** One hover toolbar button. */
const ToolButton = ({ tool }: { tool: ToolSpec }) => {
  const mainTool = tool.tooltip ? (
    <Tooltip title={tool.tooltip} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
      <button
        type="button"
        className={styles.codeBlockTool}
        onClick={tool.onClick}
        aria-label={tool.tooltip}
      >
        {tool.icon}
      </button>
    </Tooltip>
  ) : (
    <button type="button" className={styles.codeBlockTool} onClick={tool.onClick}>
      {tool.icon}
    </button>
  )

  if (tool.children?.length) {
    return (
      <Dropdown
        menu={{
          items: tool.children.map((child) => ({
            key: child.id,
            label: child.tooltip,
            icon: child.icon,
            onClick: child.onClick,
          })),
        }}
        trigger={['click']}
      >
        {mainTool}
      </Dropdown>
    )
  }

  return mainTool
}

/** Code block with copy/download/view-source/split/expand/wrap toolbar. */
const CodeBlockView = memo(({ children, language }: CodeBlockViewProps) => {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const [viewState, setViewState] = useState({
    mode: 'special' as ViewMode,
    previousMode: 'special' as ViewMode,
  })
  const { mode: viewMode } = viewState

  const setViewMode = useCallback((newMode: ViewMode) => {
    setViewState((current) => ({
      mode: newMode,
      previousMode: newMode !== 'split' ? newMode : current.previousMode,
    }))
  }, [])

  const toggleSplitView = useCallback(() => {
    setViewState((current) => {
      if (current.mode === 'split') {
        return { ...current, mode: current.previousMode }
      }
      return { mode: 'split', previousMode: current.mode }
    })
  }, [])

  const sourceViewRef = useRef<HTMLPreElement>(null)
  const specialViewRef = useRef<BasicPreviewHandles>(null)

  const hasSpecialView = useMemo(
    () => SPECIAL_VIEWS.includes(language as (typeof SPECIAL_VIEWS)[number]),
    [language],
  )

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && viewMode === 'special'
  }, [hasSpecialView, viewMode])

  const [expandOverride, setExpandOverride] = useState(true)
  const [wrapOverride, setWrapOverride] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)

  const shouldExpand = expandOverride
  const shouldWrap = wrapOverride

  const [sourceScrollHeight, setSourceScrollHeight] = useState(0)
  const expandable = useMemo(() => {
    return sourceScrollHeight > MAX_COLLAPSED_CODE_HEIGHT
  }, [sourceScrollHeight])

  useEffect(() => {
    const sourceView = sourceViewRef.current
    if (!sourceView) return

    /** Updates the measured source height without scheduling redundant renders. */
    const reportHeight = (): void => {
      startTransition(() => {
        setSourceScrollHeight((prev) =>
          prev === sourceView.scrollHeight ? prev : sourceView.scrollHeight,
        )
      })
    }

    reportHeight()
    const observer = new ResizeObserver(reportHeight)
    observer.observe(sourceView)
    return () => observer.disconnect()
  }, [])

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children.trimEnd())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      message.success(t('codeBlock.copy.success'))
    } catch {
      message.error(t('codeBlock.copy.failed'))
    }
  }, [children, message, t])

  const handleCopyImage = useCallback(async () => {
    try {
      await specialViewRef.current?.copy()
      setCopiedImage(true)
      setTimeout(() => setCopiedImage(false), 2000)
    } catch {
      message.error(t('codeBlock.copy.failed'))
    }
  }, [message, t])

  const handleDownloadSource = useCallback(async () => {
    const fileName = `${language}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`
    const ext = getExtensionByLanguage(language)
    await window.app.saveFile(`${fileName}${ext}`, children)
  }, [children, language])

  const showPreviewTools = useMemo(() => {
    return viewMode !== 'source' && hasSpecialView
  }, [hasSpecialView, viewMode])

  const tools = useMemo<ToolSpec[]>(() => {
    const specs: ToolSpec[] = []

    specs.push({
      id: 'copy',
      type: 'quick',
      icon: copied ? (
        <Check className={styles.codeBlockToolIcon} />
      ) : (
        <FileCode className={styles.codeBlockToolIcon} />
      ),
      tooltip: t('codeBlock.copy.source'),
      /** Copies the raw source text for this code block. */
      onClick: () => void handleCopySource(),
    })

    if (showPreviewTools && specialViewRef.current !== null) {
      specs.push({
        id: 'copy-image',
        type: 'quick',
        icon: copiedImage ? (
          <Check className={styles.codeBlockToolIcon} />
        ) : (
          <Image className={styles.codeBlockToolIcon} />
        ),
        tooltip: t('preview.copy.image'),
        /** Copies the rendered preview as an image. */
        onClick: () => void handleCopyImage(),
      })
    }

    const downloadChildren = [
      {
        id: 'download-source',
        icon: <FileCode size="1rem" />,
        tooltip: t('codeBlock.download.source'),
        /** Downloads the raw source using its language-specific extension. */
        onClick: () => void handleDownloadSource(),
      },
    ]
    if (showPreviewTools && specialViewRef.current !== null) {
      downloadChildren.push(
        {
          id: 'download-svg',
          icon: <CodeXml size="1rem" />,
          tooltip: t('codeBlock.download.svg'),
          /** Downloads the current preview as an SVG document. */
          onClick: () => void specialViewRef.current?.download('svg'),
        },
        {
          id: 'download-png',
          icon: <Image size="1rem" />,
          tooltip: t('codeBlock.download.png'),
          /** Downloads the current preview as a PNG image. */
          onClick: () => void specialViewRef.current?.download('png'),
        },
      )
    }
    specs.push({
      id: 'download',
      type: 'core',
      icon: <Download className={styles.codeBlockToolIcon} />,
      tooltip: t('codeBlock.download.label'),
      children: downloadChildren,
    })

    if (hasSpecialView && viewMode !== 'split') {
      specs.push({
        id: 'view-source',
        type: 'core',
        icon:
          viewMode === 'source' ? (
            <Eye className={styles.codeBlockToolIcon} />
          ) : (
            <CodeXml className={styles.codeBlockToolIcon} />
          ),
        tooltip: viewMode === 'source' ? t('preview.label') : t('preview.source'),
        /** Toggles between raw source and the rendered preview. */
        onClick: () => setViewMode(viewMode === 'source' ? 'special' : 'source'),
      })
    }

    if (hasSpecialView) {
      specs.push({
        id: 'split-view',
        type: 'core',
        icon:
          viewMode === 'split' ? (
            <Square className={styles.codeBlockToolIcon} />
          ) : (
            <SquareSplitHorizontal className={styles.codeBlockToolIcon} />
          ),
        tooltip: viewMode === 'split' ? t('codeBlock.split.restore') : t('codeBlock.split.label'),
        onClick: toggleSplitView,
      })
    }

    if (!isInSpecialView) {
      specs.push({
        id: 'expand',
        type: 'core',
        icon: shouldExpand ? (
          <ChevronsDownUp className={styles.codeBlockToolIcon} />
        ) : (
          <ChevronsUpDown className={styles.codeBlockToolIcon} />
        ),
        tooltip: shouldExpand ? t('codeBlock.collapse') : t('codeBlock.expand'),
        /** Reports whether the source is tall enough to expose expansion controls. */
        visible: () => expandable,
        /** Toggles the source height between collapsed and expanded states. */
        onClick: () => setExpandOverride((prev) => !prev),
      })

      specs.push({
        id: 'wrap',
        type: 'core',
        icon: shouldWrap ? (
          <UnwrapIcon className={styles.codeBlockToolIcon} />
        ) : (
          <WrapIcon className={styles.codeBlockToolIcon} />
        ),
        tooltip: shouldWrap ? t('codeBlock.wrap.off') : t('codeBlock.wrap.on'),
        /** Keeps the wrapping control available for every source block. */
        visible: () => true,
        /** Toggles long-line wrapping for the source view. */
        onClick: () => setWrapOverride((prev) => !prev),
      })
    }

    return specs
  }, [
    copied,
    copiedImage,
    expandable,
    handleCopyImage,
    handleCopySource,
    handleDownloadSource,
    hasSpecialView,
    isInSpecialView,
    setViewMode,
    shouldExpand,
    shouldWrap,
    showPreviewTools,
    t,
    toggleSplitView,
    viewMode,
  ])

  const sourceView = useMemo(
    () => (
      <pre
        ref={sourceViewRef}
        className={`${styles.codeBlockPre} ${shouldWrap ? styles.codeBlockWrap : ''} ${shouldExpand ? '' : styles.codeBlockCollapsed}`}
      >
        <code className={styles.codeBlockCode}>{children}</code>
      </pre>
    ),
    [children, shouldExpand, shouldWrap],
  )

  const specialView = useMemo(() => {
    const SpecialView = SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS]
    if (!SpecialView) return null

    return <SpecialView ref={specialViewRef}>{children}</SpecialView>
  }, [children, language])

  const renderHeader = useMemo(() => {
    if (isInSpecialView) {
      return <div className={`${styles.codeBlockHeader} ${styles.codeBlockHeaderSpecial}`} />
    }
    return (
      <div className={styles.codeBlockHeader}>
        <Code2 size="1.1em" className={styles.codeBlockHeaderIcon} />
        {language.charAt(0).toUpperCase() + language.slice(1)}
      </div>
    )
  }, [isInSpecialView, language])

  const renderContent = useMemo(() => {
    const showSpecialView = !!specialView && ['special', 'split'].includes(viewMode)
    const showSourceView = !specialView || viewMode !== 'special'

    return (
      <div
        className={`${styles.codeBlockContent} ${
          showSpecialView && !showSourceView ? styles.codeBlockContentSpecial : ''
        } ${showSpecialView && showSourceView ? styles.codeBlockContentSplit : ''}`}
      >
        {showSpecialView && specialView}
        {showSourceView && sourceView}
      </div>
    )
  }, [specialView, sourceView, viewMode])

  const visibleTools = tools.filter((tool) => !tool.visible || tool.visible())
  const quickTools = visibleTools.filter((tool) => tool.type === 'quick')
  const coreTools = visibleTools.filter((tool) => tool.type === 'core')
  const [showQuickTools, setShowQuickTools] = useState(false)

  if (visibleTools.length === 0) {
    return (
      <div className={styles.codeBlock}>
        {renderHeader}
        {renderContent}
      </div>
    )
  }

  return (
    <div className={styles.codeBlock}>
      {renderHeader}
      <div className={styles.codeBlockToolbar}>
        {quickTools.length === 1 || (quickTools.length > 1 && showQuickTools)
          ? quickTools.map((tool) => <ToolButton key={tool.id} tool={tool} />)
          : null}
        {quickTools.length > 1 && (
          <Tooltip title={t('codeBlock.more')} mouseEnterDelay={0.5}>
            <button
              type="button"
              className={`${styles.codeBlockTool} ${showQuickTools ? styles.codeBlockToolActive : ''}`}
              onClick={() => setShowQuickTools((prev) => !prev)}
              aria-label={t('codeBlock.more')}
              aria-expanded={showQuickTools}
            >
              <EllipsisVertical className={styles.codeBlockToolIcon} />
            </button>
          </Tooltip>
        )}
        {coreTools.map((tool) => (
          <ToolButton key={tool.id} tool={tool} />
        ))}
      </div>
      {renderContent}
    </div>
  )
})

export default CodeBlockView
