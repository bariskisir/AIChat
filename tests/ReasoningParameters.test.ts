/** Verifies provider-level reasoning controls and portable compatible request parameters. */

import { describe, expect, it } from 'vitest'
import { getProviderReasoningEfforts } from '@shared/index'
import { buildReasoningParameters } from '@main/reasoning'

describe('getProviderReasoningEfforts', () => {
  it('uses one complete control list for every OpenAI-compatible provider', () => {
    expect(getProviderReasoningEfforts('openai-compatible', undefined)).toEqual([
      'off',
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('appends server extras after the fixed list', () => {
    expect(getProviderReasoningEfforts('openai-compatible', ['default', 'low', 'max'])).toEqual([
      'off',
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getProviderReasoningEfforts('openai-compatible', undefined)).toEqual([
      'off',
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('uses only options supplied by login-provider catalogs', () => {
    expect(getProviderReasoningEfforts('chatgpt', ['default', 'low', 'xhigh'])).toEqual([
      'default',
      'low',
      'xhigh',
    ])
    expect(getProviderReasoningEfforts('claude-web', undefined)).toEqual([])
  })
})

describe('buildReasoningParameters', () => {
  it('leaves the server default untouched', () => {
    expect(buildReasoningParameters('any-model', 'default')).toBeNull()
  })

  it('sends each selected portable effort without inspecting model or provider names', () => {
    expect(buildReasoningParameters('any-model', 'off')).toEqual({ reasoning_effort: 'none' })
    expect(buildReasoningParameters('any-model', 'low')).toEqual({ reasoning_effort: 'low' })
    expect(buildReasoningParameters('any-model', 'medium')).toEqual({ reasoning_effort: 'medium' })
    expect(buildReasoningParameters('any-model', 'high')).toEqual({ reasoning_effort: 'high' })
    expect(buildReasoningParameters('any-model', 'xhigh')).toEqual({ reasoning_effort: 'xhigh' })
    expect(buildReasoningParameters('any-model', 'max')).toEqual({ reasoning_effort: 'max' })
  })
})
