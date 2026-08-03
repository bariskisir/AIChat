/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

import type { ApiBridge } from '@shared/index'

declare global {
  interface Window {
    app: ApiBridge
  }
}
