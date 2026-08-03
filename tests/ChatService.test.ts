/**
 * Tests reasoning delta parsing shared by the chat streaming pipeline.
 */

import { describe, expect, it } from 'vitest'
import { createProviderError, readReasoningDelta } from '@main/chat/chat.errors'
import { MAX_CHAT_ERROR_LENGTH } from '@shared/index'

describe('createProviderError', () => {
  it('includes the provider response body with the HTTP status', async () => {
    const error = await createProviderError(
      new Response(JSON.stringify({ error: { message: 'Model not found.' } }), {
        status: 404,
        statusText: 'Not Found',
      }),
    )

    expect(error.message).toBe(
      'Provider returned 404 Not Found.\n{"error":{"message":"Model not found."}}',
    )
  })

  it('keeps a status-only fallback when the provider returns an empty body', async () => {
    const error = await createProviderError(new Response('', { status: 400 }))

    expect(error.message).toBe('Provider returned 400.')
  })

  it('bounds large provider bodies so the error remains persistable', async () => {
    const error = await createProviderError(new Response('x'.repeat(10_000), { status: 500 }))

    expect(error.message).toHaveLength(MAX_CHAT_ERROR_LENGTH)
    expect(error.message).toMatch(/\[Provider response truncated\.\]$/)
  })
})

describe('readReasoningDelta', () => {
  it('reads OpenAI and DeepSeek reasoning_content', () => {
    expect(readReasoningDelta({ reasoning_content: 'thinking…' })).toBe('thinking…')
  })

  it('reads camelCase reasoningContent', () => {
    expect(readReasoningDelta({ reasoningContent: 'thinking…' })).toBe('thinking…')
  })

  it('reads OpenRouter reasoning', () => {
    expect(readReasoningDelta({ reasoning: 'thinking…' })).toBe('thinking…')
  })

  it('reads thinking_content and thinking fields', () => {
    expect(readReasoningDelta({ thinking_content: 'thinking…' })).toBe('thinking…')
    expect(readReasoningDelta({ thinking: 'thinking…' })).toBe('thinking…')
  })

  it('reads reasoning_details arrays with text or summary parts', () => {
    expect(
      readReasoningDelta({
        reasoning_details: [
          { text: 'step one' },
          { summary: 'summary' },
          { unrelated: true },
          null,
        ],
      }),
    ).toBe('step onesummary')
  })

  it('returns an empty string when no reasoning field matches', () => {
    expect(readReasoningDelta({ content: 'answer' })).toBe('')
    expect(readReasoningDelta({})).toBe('')
  })
})
