/**
 * Verifies Claude Web protocol helpers: bootstrap model catalogs, account identity,
 * prompt flattening, thinking resolution, and the completion SSE parser.
 */

import { describe, expect, it } from 'vitest'
import {
  buildClaudePrompt,
  ClaudeStreamAccumulator,
  extractClaudeToolOutput,
  parseClaudeSseLine,
  parseClaudeWebAccount,
  parseClaudeWebModels,
  resolveClaudeThinking,
} from '@main/providers/claude-web/claude-web.protocol'

describe('parseClaudeWebAccount', () => {
  it('reads the email and normalizes the plan name', () => {
    const account = parseClaudeWebAccount({
      account: {
        email_address: 'user@example.com',
        memberships: [
          { organization: { capabilities: ['claude_pro_usage'], billing_type: 'stripe' } },
        ],
      },
    })
    expect(account).toEqual({ email: 'user@example.com', plan: 'Pro Usage' })
  })
})

describe('parseClaudeWebModels', () => {
  it('extracts and sorts selector models with thinking configs', () => {
    const models = parseClaudeWebModels({
      model_selector_config: [
        {
          id: 'chat',
          models: [
            {
              id: 'claude-opus-5',
              name: 'Opus',
              thinking: {
                type: 'effort_and_mode',
                effort_options: [{ id: 'low' }, { value: 'max' }],
              },
            },
            { id: 'claude-haiku-4', name: 'Haiku', thinking: { type: 'none' } },
            { id: 'non-claude-model' },
            { id: 'claude-opus-5' },
          ],
        },
      ],
    })
    expect(models.map((model) => model.modelId)).toEqual(['claude-haiku-4', 'claude-opus-5'])
    const opus = models[1]
    expect(opus?.capabilities.reasoning).toBe(true)
    expect(opus?.reasoningEfforts).toEqual(['default', 'low', 'xhigh'])
    expect(models[0]?.capabilities.reasoning).toBe(false)
  })

  it('filters tier-gated models below the account plan', () => {
    const models = parseClaudeWebModels({
      account: {
        memberships: [{ organization: { capabilities: ['claude_pro_usage'] } }],
      },
      model_selector_config: [
        {
          id: 'chat',
          models: [{ id: 'claude-opus-5', name: 'Opus', thinking: { type: 'effort_and_mode' } }],
        },
      ],
      model_tiers: [
        { model_id: 'claude-opus-5', minimum_tier: 'enterprise' },
        { model_id: 'claude-sonnet-5', minimum_tier: 'free' },
      ],
    })
    expect(models.map((model) => model.modelId)).toEqual([])
  })
})

describe('resolveClaudeThinking', () => {
  it('keeps thinking auto when capability info is missing, unless explicitly disabled', () => {
    expect(resolveClaudeThinking(false, undefined, 'high')).toEqual({ thinkingMode: 'auto' })
    expect(resolveClaudeThinking(false, undefined, 'off')).toEqual({ thinkingMode: 'off' })
  })

  it('maps an allowed requested effort', () => {
    expect(resolveClaudeThinking(true, ['default', 'low', 'high'], 'high')).toEqual({
      thinkingMode: 'auto',
      effort: 'high',
    })
  })

  it('falls back to auto when the effort is not offered', () => {
    expect(resolveClaudeThinking(true, ['default', 'low'], 'xhigh')).toEqual({
      thinkingMode: 'auto',
    })
  })
})

describe('buildClaudePrompt', () => {
  it('flattens system, human, and assistant turns and captures inline images', () => {
    const { prompt, images } = buildClaudePrompt([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,QUJDRA==' },
          },
          { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
        ],
      },
    ])
    expect(prompt).toContain('System: Be concise.')
    expect(prompt).toContain('Human: Hello')
    expect(prompt).toContain('Human: Analyze this\n[Image attached]')
    expect(images).toEqual([{ mediaType: 'image/png', data: 'QUJDRA==' }])
  })

  it('rejects empty prompts', () => {
    expect(() => buildClaudePrompt([{ role: 'user', content: '' }])).toThrow(
      'requires a non-empty prompt',
    )
  })
})

describe('parseClaudeSseLine', () => {
  it('emits text and thinking deltas', () => {
    const text = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })}`,
    )
    expect(text).toMatchObject({ content: 'Hi', reasoning: '', error: null })
    const thinking = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Reasoning' } } })}`,
    )
    expect(thinking).toMatchObject({ content: '', reasoning: 'Reasoning' })
  })

  it('emits Claude Web summarized-thinking deltas', () => {
    const thinking = parseClaudeSseLine(
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'thinking_summary_delta',
          summary: { summary: 'Analyzed the request.' },
        },
      })}`,
    )
    expect(thinking).toMatchObject({ index: 0, content: '', reasoning: 'Analyzed the request.' })
  })

  it('reports stream errors and completion', () => {
    const error = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'error', error: { message: 'Overloaded' } } })}`,
    )
    expect(error?.error).toBe('Overloaded')
    const done = parseClaudeSseLine(`data: ${JSON.stringify({ event: { type: 'message_stop' } })}`)
    expect(done?.done).toBe(true)
  })

  it('ignores non-data and malformed lines', () => {
    expect(parseClaudeSseLine('')).toBeNull()
    expect(parseClaudeSseLine('data:')).toBeNull()
    expect(parseClaudeSseLine('data: {not json}')).toBeNull()
  })

  it('tracks output-tool announcements, json deltas, and block stops', () => {
    const start = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'output', input: {} } } })}`,
    )
    expect(start?.toolUseStart).toEqual({ name: 'output', input: {} })
    const partial = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"content":"<svg></svg>"}' } } })}`,
    )
    expect(partial?.toolJsonDelta).toBe('{"content":"<svg></svg>"}')
    const stop = parseClaudeSseLine(
      `data: ${JSON.stringify({ event: { type: 'content_block_stop' } })}`,
    )
    expect(stop?.blockStop).toBe(true)
  })

  it('surfaces tool_result text as content', () => {
    const result = parseClaudeSseLine(
      `data: ${JSON.stringify({
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_result',
            content: [{ type: 'text', text: 'executed' }],
          },
        },
      })}`,
    )
    expect(result?.toolResultText).toBe('executed')
  })
})

describe('extractClaudeToolOutput', () => {
  it('wraps svg artifacts in a code fence', () => {
    const rendered = extractClaudeToolOutput(
      JSON.stringify({ type: 'artifact', title: 'Diagram', content: '<svg/>', language: 'svg' }),
    )
    expect(rendered).toBe('```svg\n<svg/>\n```')
  })

  it('returns markdown artifacts and other content verbatim', () => {
    expect(extractClaudeToolOutput(JSON.stringify({ type: 'artifact', content: '# Hi' }))).toBe(
      '# Hi',
    )
    expect(extractClaudeToolOutput(JSON.stringify({ content: 'plain' }))).toBe('plain')
    expect(extractClaudeToolOutput('{not json')).toBeNull()
    expect(extractClaudeToolOutput(JSON.stringify({ type: 'artifact' }))).toBeNull()
  })

  it('recognizes SVG file tools and nested artifact payloads', () => {
    expect(
      extractClaudeToolOutput(
        JSON.stringify({ path: 'diagram.svg', file_text: '<svg viewBox="0 0 1 1"></svg>' }),
      ),
    ).toBe('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')
    expect(
      extractClaudeToolOutput(
        JSON.stringify({ artifact: { mime_type: 'image/svg+xml', content: '<svg/>' } }),
      ),
    ).toBe('```svg\n<svg/>\n```')
  })
})

describe('ClaudeStreamAccumulator', () => {
  it('keeps indexed tool inputs separate and renders the matching SVG block', () => {
    const accumulator = new ClaudeStreamAccumulator()
    expect(
      accumulator.push(
        `data: ${JSON.stringify({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', name: 'create_file', input: {} },
        })}`,
      ),
    ).toEqual([])
    expect(
      accumulator.push(
        `data: ${JSON.stringify({
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'text', text: '' },
        })}`,
      ),
    ).toEqual([])
    expect(
      accumulator.push(
        `data: ${JSON.stringify({
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":"diagram.svg","file_text":"<svg></svg>"}',
          },
        })}`,
      ),
    ).toEqual([])
    expect(
      accumulator.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: 2 })}`),
    ).toEqual([])
    expect(
      accumulator.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}`),
    ).toEqual([{ type: 'content', delta: '\n\n```svg\n<svg></svg>\n```\n\n' }])
  })

  it('renders complete tool input supplied in content_block_start', () => {
    const accumulator = new ClaudeStreamAccumulator()
    accumulator.push(
      `data: ${JSON.stringify({
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'tool_use',
          name: 'mcp__cowork__create_artifact',
          input: { artifact: { language: 'svg', content: '<svg/>' } },
        },
      })}`,
    )
    expect(
      accumulator.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: 3 })}`),
    ).toEqual([{ type: 'content', delta: '\n\n```svg\n<svg/>\n```\n\n' }])
  })

  it('wraps SVG returned through a tool-result block', () => {
    const accumulator = new ClaudeStreamAccumulator()
    expect(
      accumulator.push(
        `data: ${JSON.stringify({
          type: 'content_block_start',
          index: 4,
          content_block: {
            type: 'tool_result',
            content: [{ type: 'text', text: '<svg viewBox="0 0 2 2"></svg>' }],
          },
        })}`,
      ),
    ).toEqual([
      {
        type: 'content',
        delta: '\n\n```svg\n<svg viewBox="0 0 2 2"></svg>\n```\n\n',
      },
    ])
  })
})
