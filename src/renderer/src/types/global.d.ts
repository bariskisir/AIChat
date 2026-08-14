/**
 * Adds the typed preload bridge to the renderer Window interface.
 */

interface Window {
  app: import('@shared/index').ApiBridge
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.scss' {
  const classes: Record<string, string>
  export default classes
}
