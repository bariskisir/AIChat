/**
 * Tests the static reasoning-parameter mapping: provider-kind detection,
 * effort-option lookups, and per-model-family request parameter shapes.
 */

import { describe, expect, it } from 'vitest'
import {
  buildReasoningParameters,
  detectProviderKind,
  getModelSupportedReasoningEffortOptions,
  getThinkingBudget,
} from '@main/reasoning'

const groq = { id: 'groq', baseUrl: 'https://api.groq.com' }
const openrouter = { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' }
const dashscope = { id: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }
const generic = { id: 'local', baseUrl: 'http://localhost:8000/v1' }

describe('detectProviderKind', () => {
  it('detects known provider hosts', () => {
    expect(detectProviderKind(openrouter)).toBe('openrouter')
    expect(detectProviderKind(groq)).toBe('groq')
    expect(detectProviderKind({ baseUrl: 'https://api.deepseek.com' })).toBe('deepseek')
    expect(detectProviderKind({ baseUrl: 'https://api.moonshot.cn/v1' })).toBe('moonshot')
    expect(detectProviderKind({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })).toBe('zhipu')
    expect(detectProviderKind({ name: 'Volces Ark' })).toBe('doubao')
    expect(detectProviderKind({ baseUrl: 'https://api.openai.com/v1' })).toBe('openai')
    expect(detectProviderKind({ baseUrl: 'http://localhost:11434' })).toBe('ollama')
    expect(detectProviderKind({ baseUrl: 'http://localhost:1234' })).toBe('lmstudio')
    expect(detectProviderKind(generic)).toBe('generic')
    expect(detectProviderKind()).toBe('generic')
  })
})

describe('getModelSupportedReasoningEffortOptions', () => {
  it('maps none to off and includes default first', () => {
    expect(getModelSupportedReasoningEffortOptions({ id: 'gpt-5.1' })).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'deepseek-v4' })).toEqual([
      'default',
      'off',
      'low',
      'high',
      'xhigh',
    ])
  })

  it('returns family-specific effort sets', () => {
    expect(getModelSupportedReasoningEffortOptions({ id: 'gpt-5' })).toEqual([
      'default',
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'gemini-2.5-flash' })).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'auto',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'gemini-3-flash' })).toEqual([
      'default',
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'kimi-k3' })).toEqual([
      'default',
      'off',
      'auto',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'sonar-deep-research' })).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'claude-opus-4-1' })).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'claude-opus-5' })).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'claude-fable-5' })).toEqual([
      'default',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('exposes Gemma 4 as a thinking toggle on Gemini and Ollama providers', () => {
    const gemini = { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
    const ollama = { id: 'ollama', baseUrl: 'http://localhost:11434' }
    expect(getModelSupportedReasoningEffortOptions({ id: 'gemma-4-26b-a4b-it' }, gemini)).toEqual([
      'default',
      'off',
      'auto',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'gemma-4-31b-it' }, ollama)).toEqual([
      'default',
      'off',
      'auto',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'gemma-4-26b-a4b-it' })).toBeUndefined()
  })

  it('returns undefined for models without thinking control', () => {
    expect(getModelSupportedReasoningEffortOptions({ id: 'gpt-4o' })).toBeUndefined()
    expect(
      getModelSupportedReasoningEffortOptions({ id: 'text-embedding-3-small' }),
    ).toBeUndefined()
  })
})

describe('getThinkingBudget', () => {
  it('computes Claude-style budgets from the token map and effort ratio', () => {
    expect(getThinkingBudget(undefined, 'medium', 'claude-opus-4-1')).toBe(16512)
  })

  it('caps budgets at the provided max tokens', () => {
    expect(getThinkingBudget(4096, 'medium', 'claude-opus-4-1')).toBe(4096)
  })

  it('returns undefined for off or unknown models', () => {
    expect(getThinkingBudget(undefined, 'off', 'claude-opus-4-1')).toBeUndefined()
    expect(getThinkingBudget(undefined, 'medium', 'unknown-model')).toBeUndefined()
  })
})

describe('buildReasoningParameters', () => {
  it('returns null for the untouched server default', () => {
    expect(buildReasoningParameters('kimi-k3', 'default')).toBeNull()
    expect(buildReasoningParameters('openai/gpt-5', 'default')).toBeNull()
  })

  it('returns null for every Groq request', () => {
    expect(buildReasoningParameters('llama-3.3-70b', 'high', groq)).toBeNull()
    expect(buildReasoningParameters('deepseek-r1-distill-llama-70b', 'off', groq)).toBeNull()
  })

  it('emits OpenRouter reasoning blocks', () => {
    expect(buildReasoningParameters('grok-4-fast', 'medium', openrouter)).toEqual({
      reasoning: { enabled: true },
    })
    expect(buildReasoningParameters('grok-3-mini', 'high', openrouter)).toEqual({
      reasoning: { effort: 'high' },
    })
    expect(buildReasoningParameters('gpt-5.1', 'high', openrouter)).toEqual({
      reasoning: { effort: 'high' },
    })
    expect(buildReasoningParameters('claude-opus-4-1', 'off', openrouter)).toEqual({
      reasoning: { enabled: false, exclude: true },
    })
    expect(buildReasoningParameters('gpt-5.1', 'off', openrouter)).toEqual({
      reasoning: { effort: 'none' },
    })
  })

  it('enables Claude thinking with a budget capped by max tokens', () => {
    expect(buildReasoningParameters('anthropic/claude-opus-4-1', 'medium')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 2048 },
    })
    expect(buildReasoningParameters('claude-3-7-sonnet', 'high')).toEqual({
      thinking: { type: 'enabled', budget_tokens: 3276 },
    })
  })

  it('enables adaptive-thinking Claude models without a known token budget', () => {
    expect(buildReasoningParameters('anthropic/claude-opus-5', 'medium')).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(buildReasoningParameters('anthropic/claude-fable-5', 'high')).toEqual({
      thinking: { type: 'enabled' },
    })
  })

  it('sends nothing for Claude off and deepseek hybrid off', () => {
    expect(buildReasoningParameters('claude-opus-4-1', 'off')).toBeNull()
    expect(buildReasoningParameters('deepseek-chat', 'off')).toBeNull()
  })

  it('routes Qwen thinking through chat_template_kwargs on generic providers', () => {
    expect(buildReasoningParameters('qwen3-235b-a22b-thinking-2507', 'medium')).toEqual({
      chat_template_kwargs: { thinking_budget: 40960 },
    })
    expect(buildReasoningParameters('qwen3.5-235b', 'off')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    })
  })

  it('uses enable_thinking on compatible providers', () => {
    expect(buildReasoningParameters('qwen-plus', 'medium', dashscope)).toEqual({
      enable_thinking: true,
      thinking_budget: 40960,
    })
  })

  it('emits DeepSeek shapes per provider kind', () => {
    expect(buildReasoningParameters('deepseek-chat', 'medium')).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(buildReasoningParameters('deepseek-chat', 'medium', dashscope)).toEqual({
      enable_thinking: true,
      incremental_output: true,
    })
    expect(buildReasoningParameters('deepseek-v4', 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(buildReasoningParameters('deepseek-v4', 'off')).toEqual({
      thinking: { type: 'disabled' },
    })
  })

  it('disables Gemini flash thinking with a zero budget', () => {
    expect(buildReasoningParameters('gemini-2.5-flash', 'off')).toEqual({
      extra_body: { google: { thinking_config: { thinking_budget: 0 } } },
    })
  })

  it('uses reasoning_effort for Gemini 3 models', () => {
    expect(buildReasoningParameters('gemini-3-flash', 'medium')).toEqual({
      reasoning_effort: 'medium',
    })
  })

  it('toggles thinking through the Ollama think parameter', () => {
    const ollama = { id: 'ollama', baseUrl: 'http://localhost:11434' }
    expect(buildReasoningParameters('gemma-4-31b-it', 'auto', ollama)).toEqual({ think: true })
    expect(buildReasoningParameters('gemma-4-31b-it', 'high', ollama)).toEqual({ think: 'high' })
    expect(buildReasoningParameters('gemma-4-31b-it', 'off', ollama)).toEqual({ think: false })
  })

  it('recognizes bare Kimi K3 model IDs', () => {
    expect(getModelSupportedReasoningEffortOptions({ id: 'k3' })).toEqual([
      'default',
      'off',
      'auto',
    ])
    expect(getModelSupportedReasoningEffortOptions({ id: 'k3-256k' })).toEqual([
      'default',
      'off',
      'auto',
    ])
  })

  it('keeps the Gemini thinking-config wire for Google-hosted Gemma 4', () => {
    const gemini = { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
    expect(buildReasoningParameters('gemma-4-26b-a4b-it', 'auto', gemini)).toEqual({
      extra_body: { google: { thinking_config: { thinking_budget: -1, include_thoughts: true } } },
    })
  })

  it('handles Doubao thinking modes', () => {
    expect(buildReasoningParameters('doubao-seed-1-6-flash', 'high')).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(buildReasoningParameters('doubao-seed-1-6-flash', 'off')).toEqual({
      thinking: { type: 'disabled' },
    })
  })

  it('handles MiniMax models', () => {
    expect(buildReasoningParameters('minimax-m1', 'medium')).toEqual({
      thinking: { type: 'enabled' },
    })
    expect(buildReasoningParameters('minimax-m3', 'auto')).toEqual({
      thinking: { type: 'adaptive' },
    })
    expect(buildReasoningParameters('minimax-m1', 'off')).toEqual({
      thinking: { type: 'disabled' },
    })
  })

  it('maps validated reasoning_effort models and falls back to the first option', () => {
    expect(buildReasoningParameters('gpt-5.1', 'high')).toEqual({ reasoning_effort: 'high' })
    expect(buildReasoningParameters('gpt-5.1', 'off')).toEqual({ reasoning_effort: 'none' })
    expect(buildReasoningParameters('sonar-deep-research', 'medium')).toEqual({
      reasoning_effort: 'medium',
    })
    expect(buildReasoningParameters('gpt-5.2-codex', 'minimal')).toEqual({
      reasoning_effort: 'low',
    })
  })
})
