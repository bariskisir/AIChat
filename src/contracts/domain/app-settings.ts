/** Defines persistent desktop-shell preferences and their enumerated option sets. */

/** Lists every supported renderer locale. */
export const APP_LOCALES = ['en', 'tr', 'de', 'fr', 'pt', 'zh', 'es', 'ru', 'ja', 'ko'] as const
/** Lists application theme modes. */
export const THEME_MODES = ['system', 'light', 'dark'] as const
/** Lists supported global navigation positions. */
export const NAVBAR_POSITIONS = ['left', 'top'] as const
/** Defines the supported page zoom range and control increment. */
export const PAGE_ZOOM_LIMITS = { min: 0.5, max: 2, step: 0.1, default: 1 } as const
/** Lists supported clock display formats. */
export const TIME_FORMATS = ['24-hour', '12-hour'] as const
/** Lists renderer and main-process logging thresholds. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const

/** Identifies one supported renderer locale. */
export type AppLocale = (typeof APP_LOCALES)[number]
/** Identifies one theme preference. */
export type ThemeMode = (typeof THEME_MODES)[number]
/** Identifies one global navigation placement. */
export type NavbarPosition = (typeof NAVBAR_POSITIONS)[number]
/** Identifies one clock display format. */
export type TimeFormat = (typeof TIME_FORMATS)[number]
/** Identifies one logging threshold. */
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Contains persistent desktop-shell preferences. */
export interface AppSettings {
  revision: 1
  language: AppLocale
  theme: ThemeMode
  navbarPosition: NavbarPosition
  pageZoom: number
  timeFormat: TimeFormat
  alwaysOnTop: boolean
  showTrayIcon: boolean
  minimizeToTray: boolean
  startMinimized: boolean
  autoUpdate: boolean
  telemetryEnabled: boolean
  logLevel: LogLevel
}

/** Describes an atomic partial settings update that never touches the revision. */
export type AppSettingsPatch = {
  [Key in keyof Omit<AppSettings, 'revision'>]?: AppSettings[Key] | undefined
}

/** Supplies safe settings for first launch or malformed persisted input. */
export const DEFAULT_SETTINGS: AppSettings = {
  revision: 1,
  language: 'en',
  theme: 'system',
  navbarPosition: 'top',
  pageZoom: PAGE_ZOOM_LIMITS.default,
  timeFormat: '24-hour',
  alwaysOnTop: false,
  showTrayIcon: false,
  minimizeToTray: false,
  startMinimized: false,
  autoUpdate: true,
  telemetryEnabled: true,
  logLevel: 'info',
}
