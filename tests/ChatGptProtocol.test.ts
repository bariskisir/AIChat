/**
 * Verifies ChatGPT Responses protocol helpers: request building, SSE parsing,
 * model normalization, and the wham usage parser.
 */

import { describe, expect, it } from 'vitest'
import {
  buildResponsesRequest,
  extractResponsesText,
  mapResponsesEffort,
  normalizeChatGptModels,
  parseChatGptUsage,
  parseResponsesSseLine,
} from '@main/providers/chatgpt/chatgpt.protocol'

describe('mapResponsesEffort', () => {
  it('maps app efforts onto Responses API reasoning efforts', () => {
    expect(mapResponsesEffort('off')).toBe('off')
    expect(mapResponsesEffort('minimal')).toBe('low')
    expect(mapResponsesEffort('low')).toBe('low')
    expect(mapResponsesEffort('medium')).toBe('medium')
    expect(mapResponsesEffort('high')).toBe('high')
    expect(mapResponsesEffort('xhigh')).toBe('xhigh')
    expect(mapResponsesEffort('default')).toBeNull()
    expect(mapResponsesEffort('auto')).toBeNull()
    expect(mapResponsesEffort('max')).toBe('max')
    expect(mapResponsesEffort('ultra')).toBe('ultra')
  })
})

describe('buildResponsesRequest', () => {
  it('collects system instructions, message turns, and inline images', () => {
    const request = buildResponsesRequest(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'https://example.com/remote.png' } },
          ],
        },
        { role: 'assistant', content: 'Sure.' },
      ],
      'gpt-5',
      'high',
      true,
    )
    expect(request.model).toBe('gpt-5')
    expect(request.stream).toBe(true)
    expect(request.store).toBe(false)
    expect(request.instructions).toBe('You are helpful.')
    expect(request.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    expect(request.input).toHaveLength(3)
    const input = request.input as Array<Record<string, unknown>>
    expect(input[0]).toMatchObject({ type: 'message', role: 'user' })
    expect(input[2]).toMatchObject({ role: 'assistant' })
    expect((input[2] as { content: Array<Record<string, unknown>> }).content[0]).toEqual({
      type: 'output_text',
      text: 'Sure.',
    })
    const parts = (input[1] as { content: Array<Record<string, unknown>> }).content
    expect(parts[0]).toEqual({ type: 'input_text', text: 'Look at this' })
    expect(parts[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,AAAA' })
    expect(parts).toHaveLength(2)
  })

  it('omits the reasoning block for the default effort', () => {
    const request = buildResponsesRequest([], 'gpt-5', 'default', false)
    expect(request.reasoning).toBeUndefined()
  })
})

describe('extractResponsesText', () => {
  it('joins output text parts', () => {
    const text = extractResponsesText({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'First' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Second' }] },
      ],
    })
    expect(text).toBe('First\nSecond')
  })

  it('returns an empty string for malformed payloads', () => {
    expect(extractResponsesText(undefined)).toBe('')
    expect(extractResponsesText({})).toBe('')
  })
})

describe('parseResponsesSseLine', () => {
  it('emits content deltas', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hi' })}`,
    )
    expect(delta).toMatchObject({ content: 'Hi', reasoning: '', error: null })
  })

  it('preserves whitespace that makes streamed Markdown and SVG fences valid', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: '\n```svg\n<svg viewBox="0 0 1 1"></svg>\n```\n',
      })}`,
    )
    expect(delta?.content).toBe('\n```svg\n<svg viewBox="0 0 1 1"></svg>\n```\n')
  })

  it('emits reasoning deltas', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'Thinking' })}`,
    )
    expect(delta).toMatchObject({ content: '', reasoning: 'Thinking' })
  })

  it('emits plaintext reasoning_text deltas', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({ type: 'response.reasoning_text.delta', delta: 'Deep thought' })}`,
    )
    expect(delta).toMatchObject({ content: '', reasoning: 'Deep thought' })
  })

  it('ignores encrypted reasoning deltas that cannot be rendered', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({ type: 'response.reasoning.encrypted_content.delta', delta: 'base64:cipher' })}`,
    )
    expect(delta).toMatchObject({ content: '', reasoning: '', error: null })
  })

  it('reports stream errors', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({ type: 'error', message: 'Rate limited' })}`,
    )
    expect(delta?.error).toBe('Rate limited')
  })

  it('ignores keepalive and non-data lines', () => {
    expect(parseResponsesSseLine('data: [DONE]')).toBeNull()
    expect(parseResponsesSseLine(': ping')).toBeNull()
    expect(parseResponsesSseLine('not json')).toBeNull()
  })

  it('parses usage from the completed response event', () => {
    const delta = parseResponsesSseLine(
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: { usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
      })}`,
    )
    expect(delta?.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 })
  })
})

describe('normalizeChatGptModels', () => {
  it('normalizes slug, name, reasoning levels, and input modalities', () => {
    const models = normalizeChatGptModels({
      models: [
        {
          slug: 'gpt-5',
          display_name: 'GPT-5',
          supported_reasoning_levels: [
            'low',
            'medium',
            'xhigh',
            'max',
            { effort: 'ultra' },
            'bogus level!',
          ],
          input_modalities: ['text', 'image'],
        },
        { slug: 'gpt-4o', display_name: 'GPT-4o', input_modalities: ['text'] },
        { slug: 'hidden-model', hidden: true },
        { slug: 'gpt-5' },
      ],
    })
    expect(models).toHaveLength(2)
    const gpt5 = models.find((model) => model.modelId === 'gpt-5')
    expect(gpt5?.group).toBe('Codex')
    expect(gpt5?.capabilities.vision).toBe(true)
    expect(gpt5?.capabilities.reasoning).toBe(true)
    expect(gpt5?.reasoningEfforts).toEqual(['default', 'low', 'medium', 'xhigh', 'max', 'ultra'])
    expect(models.find((model) => model.modelId === 'gpt-4o')?.capabilities.reasoning).toBe(false)
  })
})

describe('parseChatGptUsage', () => {
  it('parses primary and secondary windows with reset timestamps', () => {
    const nowMs = 1_700_000_000_000
    const state = parseChatGptUsage(
      {
        plan_name: 'ChatGPT Plus',
        rate_limit: {
          primary_window: { used_percent: 75, reset_at: nowMs + 60_000 },
          secondary_window: { used_percent: 10, reset_at: nowMs - 5_000 },
        },
      },
      nowMs,
    )
    expect(state.plan).toBe('ChatGPT Plus')
    expect(state.windows).toHaveLength(2)
    expect(state.windows[0]).toMatchObject({
      label: 'Session',
      percent: 75,
      resetAt: nowMs + 60_000,
    })
    expect(state.windows[1]?.resetAt).toBe(0)
  })

  it('returns empty windows for malformed payloads', () => {
    expect(parseChatGptUsage(null)).toEqual({
      plan: '',
      windows: [],
      fetchedAt: expect.any(Number),
    })
  })
})
