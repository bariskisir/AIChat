/** Renders a web-search button with Off, Google, and Bing choices. */

import { useState } from 'react'
import { Button, Popover, Tooltip } from 'antd'
import { Check, Globe, Power } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WebSearchMode } from '@shared/index'
import { BingLogo, GoogleLogo } from '@renderer/components/app/icons'
import styles from './ChatToolControl.module.scss'

/** Properties accepted by the per-chat web-search provider control. */
export interface WebSearchControlProps {
  value: WebSearchMode
  onChange: (value: WebSearchMode) => void
}

/** Returns the icon associated with the disabled state or selected search engine. */
const webSearchIcon = (mode: WebSearchMode, size = 18): React.JSX.Element => {
  if (mode === 'off') return <Globe size={size} />
  return mode === 'google' ? (
    <GoogleLogo width={size} height={size} />
  ) : (
    <BingLogo width={size} height={size} />
  )
}

/** Lets the user choose whether outgoing messages use Google, Bing, or no web search. */
const WebSearchControl = ({ value, onChange }: WebSearchControlProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const modes: WebSearchMode[] = ['off', 'google', 'bing']

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
              {mode === 'off' ? t('chat.off') : mode === 'google' ? 'Google' : 'Bing'}
            </strong>
            <small>{t(`chat.webSearchDescriptions.${mode}`)}</small>
          </span>
          {value === mode && <Check size={15} />}
        </button>
      ))}
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
