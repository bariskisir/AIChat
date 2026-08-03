/** Code block with language detection preview/source views. */

import CodeBlockView from './CodeBlockView'

interface CodeBlockProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode
}

/** Renders inline code and fenced blocks with preview and toolbar support. */
const CodeBlock = ({ className, children }: CodeBlockProps): React.JSX.Element => {
  const languageMatch = /language-([\w-+]+)/.exec(className || '')
  const isMultiline = String(children ?? '').includes('\n')
  const detectedLanguage = languageMatch?.[1] ?? (isMultiline ? 'text' : null)
  const language =
    detectedLanguage !== 'xml'
      ? detectedLanguage
      : /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(String(children))
        ? 'svg'
        : detectedLanguage
  const content = String(children ?? '').replace(/\n+$/, '')

  if (language === null) {
    return <code className={className}>{children}</code>
  }

  return <CodeBlockView language={language}>{content}</CodeBlockView>
}

export default CodeBlock
