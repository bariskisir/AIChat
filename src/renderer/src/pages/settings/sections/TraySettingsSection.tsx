/**
 * Renders system-tray icon and tray-dependent startup preferences.
 */

import { Select, Switch, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { TrayIconPreset } from '@shared/index'
import { useSettingsActions } from '@renderer/hooks/useSettingsActions'
import { useAppSelector } from '@renderer/store'
import SettingLabel from '../components/SettingLabel'
import styles from '../SettingsPage.module.scss'

/** Displays system-tray and startup minimization controls. */
const TraySettingsSection = (): React.JSX.Element => {
  const settings = useAppSelector((state) => state.app.settings)
  const platform = useAppSelector((state) => state.app.platform)
  const settingsActions = useSettingsActions()
  const { t } = useTranslation()
  const trayUnavailable = platform === 'linux'

  /** Keeps tray-dependent options disabled whenever their required tray icon is removed. */
  const changeTrayIcon = (showTrayIcon: boolean): void => {
    void settingsActions.saveSettings({
      showTrayIcon,
      ...(showTrayIcon ? {} : { minimizeToTray: false, startMinimized: false }),
    })
  }

  /** Enables the required tray icon when close-to-tray is selected. */
  const changeMinimizeToTray = (minimizeToTray: boolean): void => {
    void settingsActions.saveSettings({
      minimizeToTray,
      ...(minimizeToTray ? { showTrayIcon: true } : {}),
    })
  }

  /** Enables the required tray icon when minimized startup is selected. */
  const changeStartMinimized = (startMinimized: boolean): void => {
    void settingsActions.saveSettings({
      startMinimized,
      ...(startMinimized ? { showTrayIcon: true } : {}),
    })
  }

  /** Hides the taskbar entry independently of the tray icon. */
  const changeShowTaskbar = (showTaskbar: boolean): void => {
    void settingsActions.saveSettings({ showTaskbar })
  }

  return (
    <div className={styles.settingContainer}>
      <h2 className={styles.groupTitle}>{t('settings.traySettings')}</h2>
      <section className={styles.settingGroup}>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.showTrayIcon')}
            description={t('settings.showTrayIconDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.showTrayIcon}
                disabled={trayUnavailable}
                onChange={changeTrayIcon}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.trayIcon')}
            description={t('settings.trayIconDescription')}
          />
          <div className={styles.settingControl}>
            <Select
              value={settings.trayIcon}
              disabled={trayUnavailable || !settings.showTrayIcon}
              style={{ width: 180 }}
              options={[
                { value: 'default', label: t('settings.trayIconDefault') },
                { value: 'bluetooth', label: t('settings.trayIconBluetooth') },
                { value: 'weather', label: t('settings.trayIconWeather') },
              ]}
              onChange={(trayIcon) =>
                void settingsActions.saveSettings({ trayIcon: trayIcon as TrayIconPreset })
              }
            />
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.minimizeToTray')}
            description={t('settings.minimizeToTrayDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.minimizeToTray}
                disabled={trayUnavailable}
                onChange={changeMinimizeToTray}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.startMinimized')}
            description={t('settings.startMinimizedDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.startMinimized}
                disabled={trayUnavailable}
                onChange={changeStartMinimized}
              />
            </Tooltip>
          </div>
        </div>
        <div className={styles.settingRow}>
          <SettingLabel
            title={t('settings.showTaskbar')}
            description={t('settings.showTaskbarDescription')}
          />
          <div className={styles.settingControl}>
            <Tooltip title={trayUnavailable ? t('settings.trayUnavailable') : undefined}>
              <Switch
                checked={settings.showTaskbar}
                disabled={trayUnavailable}
                onChange={changeShowTaskbar}
              />
            </Tooltip>
          </div>
        </div>
      </section>
    </div>
  )
}

export default TraySettingsSection
