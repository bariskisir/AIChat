/** Verifies fuzzy model search matching and ranking tiers. */

import { describe, expect, it } from 'vitest'
import { getModelLogoById } from '@renderer/utils/modelLogos'
import { getSearchMatchScore, type ModelSearchField } from '@renderer/utils/modelSearch'

describe('modelSearch', () => {
  const fields = [
    { value: 'GPT-4o', weight: 0, allowAbbreviation: true },
    { value: 'gpt-4o-mini', weight: 1, allowAbbreviation: true },
  ]

  it('should return 0 for empty keywords', () => {
    expect(getSearchMatchScore('', fields)).toBe(0)
    expect(getSearchMatchScore('   ', fields)).toBe(0)
  })

  it('should match exact text case-insensitively', () => {
    const score = getSearchMatchScore('gpt', fields)
    expect(score).not.toBeNull()
  })

  it('should match normalized segment (ignore punctuation)', () => {
    const score = getSearchMatchScore('gpt4o', fields)
    expect(score).not.toBeNull()
  })

  it('should return null for punctuation-only keyword', () => {
    expect(getSearchMatchScore(':', fields)).toBeNull()
    expect(getSearchMatchScore('---', fields)).toBeNull()
    expect(getSearchMatchScore('   :   ', fields)).toBeNull()
  })

  it('should return null if any keyword does not match', () => {
    expect(getSearchMatchScore('gpt claude', fields)).toBeNull()
  })

  it('should rank exact matches higher (lower score is better)', () => {
    const scoreExact = getSearchMatchScore('gpt-4o', fields)
    const scoreAbbr = getSearchMatchScore('g4', fields)
    expect(scoreExact).not.toBeNull()
    expect(scoreAbbr).not.toBeNull()
    expect(scoreExact as number).toBeLessThan(scoreAbbr as number)
  })

  it('should match token initials and ordered-character abbreviations', () => {
    const testFields = [
      { value: 'DeepSeek-V3', weight: 0, allowAbbreviation: true },
      { value: 'DeepSeekV4', weight: 0, allowAbbreviation: true },
    ]
    expect(getSearchMatchScore('dsv', testFields)).not.toBeNull()
    expect(getSearchMatchScore('dv', testFields)).not.toBeNull()
  })

  it('should not match abbreviation when allowAbbreviation is false', () => {
    const fieldsNoAbbr = [{ value: 'DeepSeek-V3', weight: 0, allowAbbreviation: false }]
    expect(getSearchMatchScore('dsv', fieldsNoAbbr)).toBeNull()
    expect(getSearchMatchScore('dv', fieldsNoAbbr)).toBeNull()
  })

  it('should rank name above id above group above description based on weights', () => {
    const nameField: ModelSearchField = { value: 'test-model', weight: 0, allowAbbreviation: true }
    const apiField: ModelSearchField = { value: 'test-api-id', weight: 1, allowAbbreviation: true }
    const groupField: ModelSearchField = { value: 'test-group', weight: 2, allowAbbreviation: true }
    const descField: ModelSearchField = { value: 'test-desc', weight: 30, allowAbbreviation: true }

    const scoreName = getSearchMatchScore('test', [nameField])
    const scoreApi = getSearchMatchScore('test', [apiField])
    const scoreGroup = getSearchMatchScore('test', [groupField])
    const scoreDesc = getSearchMatchScore('test', [descField])

    expect(scoreName).not.toBeNull()
    expect(scoreApi).not.toBeNull()
    expect(scoreGroup).not.toBeNull()
    expect(scoreDesc).not.toBeNull()
    expect(scoreName as number).toBeLessThan(scoreApi as number)
    expect(scoreApi as number).toBeLessThan(scoreGroup as number)
    expect(scoreGroup as number).toBeLessThan(scoreDesc as number)
  })

  it('should rank a name abbreviation higher than a description raw match', () => {
    const nameField: ModelSearchField = { value: 'DeepSeek-V3', weight: 0, allowAbbreviation: true }
    const descField: ModelSearchField = {
      value: 'dsv-model-description',
      weight: 30,
      allowAbbreviation: false,
    }
    const scoreNameAbbr = getSearchMatchScore('dsv', [nameField])
    const scoreDescRaw = getSearchMatchScore('dsv', [descField])
    expect(scoreNameAbbr).not.toBeNull()
    expect(scoreDescRaw).not.toBeNull()
    expect(scoreNameAbbr as number).toBeLessThan(scoreDescRaw as number)
  })

  it('resolves brand logos for vendor model ids including bare Kimi K3', () => {
    expect(getModelLogoById('k3')).toBeDefined()
    expect(getModelLogoById('k3-256k')).toBeDefined()
    expect(getModelLogoById('k3po')).toBeUndefined()
    expect(getModelLogoById('deepseek-chat')).toBeDefined()
    expect(getModelLogoById('claude-3-7-sonnet')).toBeDefined()
  })
})
