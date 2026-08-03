/** Renders the persistent Quick Model choice used by lightweight internal chat tasks. */

import { App, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ModelReference } from '@shared/index'
import ModelSelect from '@renderer/components/chat/ModelSelect'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setProviders } from '@renderer/store/appSlice'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

const logger = createLogger('QuickModelSettings')

/** Lets the user choose the model used for title generation and web-search planning. */
const QuickModelSettingsSection = (): React.JSX.Element => {
  const snapshot = useAppSelector((state) => state.app.providers)
  const dispatch = useAppDispatch()
  const { message } = App.useApp()
  const { t } = useTranslation()

  /** Persists the optional Quick Model selection. */
  const saveQuickModel = async (quickModel: ModelReference | null): Promise<void> => {
    try {
      dispatch(setProviders(await window.app.setQuickModel(quickModel)))
    } catch (error) {
      logger.error('Quick Model could not be saved.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Persists whether the Quick Model generates names for newly started chats. */
  const saveTitleGeneration = async (enabled: boolean): Promise<void> => {
    try {
      dispatch(setProviders(await window.app.setTitleGenerationEnabled(enabled)))
    } catch (error) {
      logger.error('Title generation preference could not be saved.', error)
      void message.error(t('errors.generic'))
    }
  }

  /** Persists a favorite toggle and refreshes every model picker. */
  const toggleFavorite = async (model: ModelReference, favorite: boolean): Promise<void> => {
    try {
      dispatch(setProviders(await window.app.setFavoriteModel(model, favorite)))
    } catch (error) {
      logger.error('Favorite model could not be changed.', error)
      void message.error(t('errors.generic'))
    }
  }

  return (
    <section className={styles.settingContainer}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t('models.title')}</h2>
          <p>{t('models.description')}</p>
        </div>
      </div>
      <div className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel title={t('models.quickModel')} description={t('models.quickDescription')} />
          <ModelSelect
            className={styles.wideControl ?? ''}
            models={snapshot.models}
            providers={snapshot.providers}
            value={snapshot.quickModel}
            allowClear
            onChange={(value) => void saveQuickModel(value)}
            onFavorite={(model, favorite) => void toggleFavorite(model, favorite)}
          />
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('models.titleGeneration')}
            description={t('models.titleGenerationDescription')}
          />
          <Switch
            checked={snapshot.titleGenerationEnabled}
            aria-label={t('models.titleGeneration')}
            onChange={(enabled) => void saveTitleGeneration(enabled)}
          />
        </div>
      </div>
    </section>
  )
}

export default QuickModelSettingsSection
