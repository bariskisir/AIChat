/** Renders a thinking button with an explanatory effort panel. */

import { useState } from 'react'
import { Button, Popover, Tooltip } from 'antd'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReasoningEffort } from '@shared/index'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80,
  MdiLightbulbOn90,
  MdiLightbulbQuestion,
} from '@renderer/components/app/icons'
import styles from './ChatToolControl.module.scss'

/** Properties accepted by the per-chat reasoning control. */
export interface ReasoningControlProps {
  options: ReasoningEffort[]
  value: ReasoningEffort
  onChange: (value: ReasoningEffort) => void
}

/** Matches the bulb state shown for each reasoning effort. */
const reasoningIcon = (effort: ReasoningEffort, size = 18): React.JSX.Element => {
  const props = { width: size, height: size }
  switch (effort) {
    case 'default':
      return <MdiLightbulbQuestion {...props} />
    case 'off':
      return <MdiLightbulbOffOutline {...props} />
    case 'minimal':
      return <MdiLightbulbOn30 {...props} />
    case 'low':
      return <MdiLightbulbOn50 {...props} />
    case 'medium':
      return <MdiLightbulbOn80 {...props} />
    case 'high':
      return <MdiLightbulbOn90 {...props} />
    case 'xhigh':
      return <MdiLightbulbOn {...props} />
    case 'auto':
      return <MdiLightbulbAutoOutline {...props} />
  }
}

/** Lets the user inspect and select the active model's supported reasoning effort. */
const ReasoningControl = ({
  options,
  value,
  onChange,
}: ReasoningControlProps): React.JSX.Element => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const uniqueOptions = [...new Set(options)]
  const orderedOptions = uniqueOptions.includes('off')
    ? (['off', ...uniqueOptions.filter((option) => option !== 'off')] as ReasoningEffort[])
    : uniqueOptions

  /** Applies one effort level and closes the choice panel. */
  const selectEffort = (option: ReasoningEffort): void => {
    onChange(option)
    setOpen(false)
  }

  const panel = (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{t('chat.reasoning')}</div>
      {orderedOptions.map((option) => (
        <button
          type="button"
          className={`${styles.choice} ${value === option ? styles.selected : ''}`}
          key={option}
          onClick={() => selectEffort(option)}
        >
          <span className={styles.choiceIcon}>{reasoningIcon(option, 16)}</span>
          <span className={styles.choiceText}>
            <strong>{t(`chat.reasoningLevels.${option}`)}</strong>
            <small>{t(`chat.reasoningDescriptions.${option}`)}</small>
          </span>
          {value === option && <Check size={15} />}
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
      <Tooltip title={t('chat.reasoning')}>
        <Button
          type="text"
          className={`${styles.toolButton} ${value !== 'off' && value !== 'default' ? styles.active : ''}`}
          aria-label={t('chat.reasoning')}
          aria-pressed={value !== 'off' && value !== 'default'}
          icon={reasoningIcon(value)}
        />
      </Tooltip>
    </Popover>
  )
}

export default ReasoningControl
