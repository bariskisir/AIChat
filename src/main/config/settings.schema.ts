/** Centralizes persisted and IPC settings validation. */

import {
  APP_LOCALES,
  DEFAULT_SETTINGS,
  LOG_LEVELS,
  NAVBAR_POSITIONS,
  PAGE_ZOOM_LIMITS,
  TIME_FORMATS,
  THEME_MODES,
  type AppSettings,
} from '@shared/index'
import { z } from 'zod'

const settingsFieldsSchema = z.object({
  revision: z.literal(1),
  language: z.enum(APP_LOCALES),
  theme: z.enum(THEME_MODES),
  navbarPosition: z.enum(NAVBAR_POSITIONS),
  pageZoom: z.number().min(PAGE_ZOOM_LIMITS.min).max(PAGE_ZOOM_LIMITS.max),
  timeFormat: z.enum(TIME_FORMATS),
  alwaysOnTop: z.boolean(),
  showTrayIcon: z.boolean(),
  minimizeToTray: z.boolean(),
  autoUpdate: z.boolean(),
  telemetryEnabled: z.boolean(),
  logLevel: z.enum(LOG_LEVELS),
})

export const settingsSchema = settingsFieldsSchema.superRefine((settings, context) => {
  if (settings.minimizeToTray && !settings.showTrayIcon) {
    context.addIssue({
      code: 'custom',
      path: ['minimizeToTray'],
      message: 'Minimize to tray requires the tray icon to be enabled.',
    })
  }
})

export const settingsPatchSchema = settingsFieldsSchema
  .omit({ revision: true })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'At least one setting must be provided.')

/** Returns an object record only when a persisted value can contain named settings. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Merges persisted settings over the defaults and forces the current revision. */
export const parsePersistedSettings = (input: unknown): AppSettings => {
  const persisted = asRecord(input)
  if (!persisted) return structuredClone(DEFAULT_SETTINGS)

  const candidate = { ...DEFAULT_SETTINGS, ...persisted, revision: 1 }
  const parsed = settingsSchema.safeParse(candidate)
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS)
}
