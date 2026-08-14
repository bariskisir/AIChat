// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { extractSelectedTextWithKatex } from '@renderer/utils/selection'

describe('extractSelectedTextWithKatex', () => {
  it('returns empty string for null or collapsed selection', () => {
    expect(extractSelectedTextWithKatex(null)).toBe('')
  })

  it('restores KaTeX math annotations to original TeX source', () => {
    const container = document.createElement('div')
    const texSource = '\\frac{a}{b} = c'
    container.innerHTML = `
      <p>Here is an equation:
        <span class="katex">
          <span class="katex-mathml">
            <math xmlns="http://www.w3.org/1998/Math/MathML">
              <semantics>
                <mrow><mfrac><mi>a</mi><mi>b</mi></mfrac><mo>=</mo><mi>c</mi></mrow>
                <annotation encoding="application/x-tex">${texSource}</annotation>
              </semantics>
            </math>
          </span>
          <span class="katex-html" aria-hidden="true">
            <span class="base"><span class="mord"><span class="mopen nulldelimiter"></span></span></span>
          </span>
        </span>
      </p>
    `
    document.body.appendChild(container)

    const range = document.createRange()
    range.selectNodeContents(container)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const extracted = extractSelectedTextWithKatex(selection)
    expect(extracted).toContain(texSource)
    expect(extracted).not.toContain('katex-html')

    document.body.removeChild(container)
  })
})
