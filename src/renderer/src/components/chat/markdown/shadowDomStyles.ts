/** Copies application styles into isolated model-content shadow roots. */

/** Appends a snapshot of readable document stylesheets to one shadow root. */
export const copyDocumentStylesToShadowRoot = (shadowRoot: ShadowRoot): void => {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })
    .map((rule) => rule.cssText)
    .join('\n')
  shadowRoot.appendChild(stylesheet)
}
