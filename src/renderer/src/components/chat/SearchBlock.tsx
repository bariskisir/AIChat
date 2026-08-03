/** Renders web-search status as an expandable box that reveals its references. */

import { useState } from 'react'
import { ChevronRight, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Citation } from '@shared/index'
import { citationHostname } from '@renderer/utils/citations'
import { BingLogo, GoogleLogo } from '@renderer/components/app/icons'
import styles from './SearchBlock.module.scss'

/** Returns the monochrome mark of the selected web-search engine. */
const engineIcon = (engine: string): React.JSX.Element => {
  if (engine === 'google') return <GoogleLogo width={15} height={15} />
  if (engine === 'bing') return <BingLogo width={15} height={15} />
  return <Globe size={15} className={styles.fallback} />
}

/** Properties accepted by the web-search presentation. */
export interface SearchBlockProps {
  running: boolean
  failed: boolean
  count: number
  engine: string
  citations: Citation[]
}

/** Renders one reference row: website and page title. */
const SearchReference = ({ citation }: { citation: Citation }) => (
  <button
    type="button"
    className={styles.reference}
    onClick={() => void window.app.openExternal(citation.url)}
  >
    <span className={styles.referenceIndex}>{citation.index}</span>
    <span className={styles.referenceText}>
      {citationHostname(citation.url)}
      {citation.title && <span className={styles.referenceDivider}>{citation.title}</span>}
    </span>
  </button>
)

/** Shows search status in a reasoning-style header and its references when expanded. */
const SearchBlock = ({
  running,
  failed,
  count,
  engine,
  citations,
}: SearchBlockProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const status = running
    ? t('chat.searching')
    : failed
      ? t('chat.searchFailed', { engine })
      : t('chat.searchResultsFound', { count })

  return (
    <section className={`${styles.container} ${expanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={`${styles.icon} ${running ? styles.searching : ''}`}>
          {engineIcon(engine)}
        </span>
        <span className={styles.heading}>
          <strong>{status}</strong>
        </span>
        <ChevronRight className={styles.chevron} size={18} />
      </button>
      {expanded && citations.length > 0 && (
        <div className={styles.content}>
          {citations.map((citation) => (
            <SearchReference key={citation.index} citation={citation} />
          ))}
        </div>
      )}
    </section>
  )
}

export default SearchBlock
