/** Renders a web-search button with Off, Google, Bing, and DuckDuckGo choices. */

import { useState } from 'react'
import { Button, Popover, Switch, Tooltip } from 'antd'
import { Check, Globe, Power } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WebSearchMode } from '@shared/index'
import { BingLogo, DuckDuckGoLogo, GoogleLogo } from '@renderer/components/app/icons'
import styles from './ChatToolControl.module.scss'

/** Properties accepted by the per-chat web-search provider control. */
export interface WebSearchControlProps {
  value: WebSearchMode
  onChange: (value: WebSearchMode) => void
  useWebSearchFallback: boolean
  onWebSearchFallbackChange: (value: boolean) => void
}

/** Maps each enabled engine to its display name. */
const WEB_SEARCH_LABELS: Record<Exclude<WebSearchMode, 'off'>, string> = {
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
}

/** Returns the icon associated with the disabled state or selected search engine. */
const webSearchIcon = (mode: WebSearchMode, size = 18): React.JSX.Element => {
  if (mode === 'off') return <Globe size={size} />
  if (mode === 'google') return <GoogleLogo width={size} height={size} />
  if (mode === 'bing') return <BingLogo width={size} height={size} />
  return <DuckDuckGoLogo width={size} height={size} />
}

/** Lets the user choose whether outgoing messages use Google, Bing, DuckDuckGo, or no web search. */
const WebSearchControl = ({
  value,
  onChange,
  useWebSearchFallback,
  onWebSearchFallbackChange,
}: WebSearchControlProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const modes: WebSearchMode[] = ['off', 'google', 'bing', 'duckduckgo']

  /** Applies one engine mode and closes the choice panel. */
  const selectMode = (mode: WebSearchMode): void => {
    onChange(mode)
    setOpen(false)
  }

  const panel = (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{t('chat.webSearch')}</div>
      {modes.map((mode) => (
        <button
          type="button"
          className={`${styles.choice} ${value === mode ? styles.selected : ''}`}
          key={mode}
          onClick={() => selectMode(mode)}
        >
          <span className={styles.choiceIcon}>
            {mode === 'off' ? <Power size={16} /> : webSearchIcon(mode, 16)}
          </span>
          <span className={styles.choiceText}>
            <strong>
              {mode === 'off'
                ? t('chat.off')
                : WEB_SEARCH_LABELS[mode as Exclude<WebSearchMode, 'off'>]}
            </strong>
            <small>{t(`chat.webSearchDescriptions.${mode}`)}</small>
          </span>
          {value === mode && <Check size={15} />}
        </button>
      ))}
      <div className={styles.panelDivider} />
      <div className={styles.searchFallbackRow}>
        <span className={styles.choiceText}>
          <strong>{t('chat.useWebSearchFallback')}</strong>
        </span>
        <Switch size="small" checked={useWebSearchFallback} onChange={onWebSearchFallbackChange} />
      </div>
    </div>
  )

  return (
    <Popover
      arrow={false}
      content={panel}
      open={open}
      placement="topLeft"
      trigger="click"
      onOpenChange={setOpen}
    >
      <Tooltip title={t('chat.webSearch')}>
        <Button
          type="text"
          className={`${styles.toolButton} ${value !== 'off' ? styles.active : ''}`}
          aria-label={t('chat.webSearch')}
          aria-pressed={value !== 'off'}
          icon={webSearchIcon(value)}
        />
      </Tooltip>
    </Popover>
  )
}

export default WebSearchControl
