/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

interface Window {
  app: import('@shared/index').ApiBridge
}
