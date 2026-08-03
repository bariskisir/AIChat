/** Scrollable table with copy action. */

import { useState } from 'react'
import { Tooltip } from 'antd'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from '../MessageBubble.module.scss'

interface MarkdownTableProps {
  children: React.ReactNode
  onCopy: () => Promise<string>
}

/** Renders a table with a hover copy toolbar. */
const MarkdownTable = ({ children, onCopy }: MarkdownTableProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  /** Copies the source Markdown for this table and briefly confirms success. */
  const copyTable = async (): Promise<void> => {
    const tableMarkdown = await onCopy()
    if (!tableMarkdown) return
    await navigator.clipboard.writeText(tableMarkdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={styles.tableWrapper}>
      <div className={styles.tableScroll}>
        <table>{children}</table>
      </div>
      <div className={styles.tableToolbar}>
        <Tooltip title={copied ? t('common.copied') : t('common.copy')}>
          <button type="button" className={styles.tableCopy} onClick={() => void copyTable()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export default MarkdownTable
