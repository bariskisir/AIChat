/** Defines runtime identity and renderer diagnostic records shared across processes. */

import type { LogLevel } from './app-settings'

/** Identifies one supported desktop operating-system family. */
export type DesktopPlatform = 'win32' | 'darwin' | 'linux'

/** Describes one bounded renderer diagnostic forwarded to the main logger. */
export interface LogRecord {
  level: LogLevel
  module: string
  message: string
  details?: string | undefined
}
