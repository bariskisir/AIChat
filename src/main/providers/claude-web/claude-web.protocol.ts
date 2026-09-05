/**
 * Pure protocol helpers for the Claude Web family: bootstrap model catalogs, account
 * identity, flattened chat prompts, and the completion SSE parser.
 */

import {
  isReasoningEffortValue,
  parseDataUrl,
  type ProviderModelDefinition,
  type ReasoningEffort,
} from '@shared/index'

import type { ClaudeSseDelta, ClaudeStreamOutput, ClaudeWebAccount } from './claude-web.types'

/** Claude.ai web origin used by every conversation and bootstrap request. */
export const CLAUDE_ORIGIN = 'https://claude.ai'

type JsonObject = Record<string, unknown>

/** Guards a value as a plain object, returning undefined for primitives, arrays, and null. */
const asObject = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined

/** Extracts a trimmed non-empty string, returning undefined otherwise. */
const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** Reads a non-empty string without trimming its original payload. */
const readRawString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

/** Reads a non-negative integer content-block index. */
const readIndex = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

/** Reads the first present string among several object keys. */
const firstString = (value: JsonObject, keys: string[]): string | undefined => {
  for (const key of keys) {
    const result = readString(value[key])
    if (result) return result
  }
  return undefined
}

/** Reads effort options from one Claude bootstrap model thinking config. */
const parseEffortOptions = (value: unknown): ReasoningEffort[] => {
  if (!Array.isArray(value)) return []
  const efforts: ReasoningEffort[] = []
  for (const item of value) {
    const option = asObject(item)
    const raw = option ? firstString(option, ['id', 'value']) : undefined
    if (raw && isReasoningEffortValue(raw)) efforts.push(raw)
  }
  return [...new Set(efforts)]
}

/** Reads mode-toggle ids (e.g. an `off` switch) from one thinking config. */
const parseModeOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const modes: string[] = []
  for (const item of value) {
    const option = asObject(item)
    const raw = option ? firstString(option, ['id', 'value']) : undefined
    if (raw && !modes.includes(raw)) modes.push(raw)
  }
  return modes
}

/** Reads thinking capability and effort options from one bootstrap model entry. */
const parseThinking = (
  value: JsonObject,
): { supportsThinking: boolean; reasoningEfforts: ReasoningEffort[] | undefined } => {
  const thinking = asObject(value.thinking)
  const type = thinking ? readString(thinking.type) : undefined
  if (!thinking || !type || type === 'none') {
    return { supportsThinking: false, reasoningEfforts: undefined }
  }
  if (type === 'effort_and_mode') {
    const efforts = parseEffortOptions(thinking.effort_options)
    if (parseModeOptions(thinking.mode_options).includes('off') && !efforts.includes('off')) {
      efforts.push('off')
    }
    return {
      supportsThinking: true,
      reasoningEfforts: efforts.length
        ? ['default', ...efforts.filter((effort) => effort !== 'default')]
        : ['default', 'off'],
    }
  }
  return { supportsThinking: true, reasoningEfforts: ['default', 'off'] }
}

/** Converts one Claude bootstrap model entry into a provider model definition. */
const parseModel = (value: unknown): ProviderModelDefinition | undefined => {
  const model = asObject(value)
  if (!model) return undefined
  const modelId = firstString(model, ['id', 'model'])
  if (!modelId) return undefined
  if (
    model.inactive === true ||
    model.hidden === true ||
    model.disabled === true ||
    model.locked === true ||
    model.requiresUpgrade === true ||
    model.requires_upgrade === true ||
    model.enabled === false ||
    model.available === false ||
    readString(model.section) === 'deprecated'
  ) {
    return undefined
  }
  const name = firstString(model, ['name', 'display_name', 'displayName']) ?? modelId
  const { supportsThinking, reasoningEfforts } = parseThinking(model)
  return {
    modelId,
    name,
    group: 'Claude Web',
    capabilities: {
      chat: true,
      vision: true,
      imageGeneration: false,
      reasoning: supportsThinking,
    },
    ...(reasoningEfforts ? { reasoningEfforts } : {}),
  }
}

/** Extracts the chat selector model list from the bootstrap payload. */
const selectorModels = (root: JsonObject): ProviderModelDefinition[] => {
  if (!Array.isArray(root.model_selector_config)) return []
  const chat = root.model_selector_config
    .map(asObject)
    .find((config) => config && readString(config.id) === 'chat')
  return Array.isArray(chat?.models) ? chat.models.flatMap((model) => parseModel(model) ?? []) : []
}

/** Extracts models from the per-organization bootstrap config fallback. */
const bootstrapModels = (root: JsonObject): ProviderModelDefinition[] => {
  const account = asObject(root.account)
  if (!Array.isArray(account?.memberships)) return []
  return account.memberships.flatMap((membership) => {
    const organization = asObject(asObject(membership)?.organization)
    const models = organization?.claude_ai_bootstrap_models_config
    return Array.isArray(models) ? models.flatMap((model) => parseModel(model) ?? []) : []
  })
}

/** Reads the account email and subscription plan from a Claude bootstrap payload. */
export const parseClaudeWebAccount = (value: unknown): ClaudeWebAccount => {
  const root = asObject(value)
  const account = root && asObject(root.account)
  const membership = Array.isArray(account?.memberships)
    ? asObject(account.memberships[0])
    : undefined
  const organization = membership && asObject(membership.organization)
  const capabilities = Array.isArray(organization?.capabilities) ? organization.capabilities : []
  const capabilityPlan = capabilities.find(
    (item) => typeof item === 'string' && item.startsWith('claude_'),
  )
  const rawPlan =
    (typeof capabilityPlan === 'string' ? capabilityPlan : undefined) ??
    firstString(organization ?? {}, ['rate_limit_tier', 'billing_type']) ??
    ''
  const normalizedPlan = rawPlan
    .replace(/^claude_/, '')
    .replaceAll('_', ' ')
    .trim()
  return {
    email: firstString(account ?? {}, ['email_address', 'email']) ?? '',
    plan: normalizedPlan ? normalizedPlan.replace(/\b\w/g, (letter) => letter.toUpperCase()) : '',
  }
}

/** Ranks Claude subscription tiers so gated models can be filtered by plan. */
const tierRank = (value: string): number => {
  const tier = value.toLowerCase().replaceAll(/[-_ ]/g, '')
  if (tier.includes('enterprise')) return 4
  if (tier.includes('business') || tier.includes('team')) return 3
  if (tier.includes('max')) return 2
  if (tier.includes('pro')) return 1
  return 0
}

/** Collects the model ids allowed for the account's plan from tier-gate configs. */
const collectTierAllowedModels = (root: JsonObject): Set<string> | undefined => {
  const currentRank = tierRank(parseClaudeWebAccount(root).plan)
  const allowed = new Set<string>()
  let foundTierConfig = false
  /** Visits nested bootstrap data to find model-to-subscription-tier constraints. */
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const tierEntries = value
        .map(asObject)
        .filter((item): item is JsonObject => item !== undefined)
      if (tierEntries.some((item) => readString(item.model_id) && readString(item.minimum_tier))) {
        foundTierConfig = true
        for (const item of tierEntries) {
          const modelId = readString(item.model_id)
          const minimumTier = readString(item.minimum_tier)
          if (modelId && minimumTier && tierRank(minimumTier) <= currentRank) allowed.add(modelId)
        }
      }
      value.forEach(visit)
      return
    }
    const object = asObject(value)
    if (object) Object.values(object).forEach(visit)
  }
  visit(root)
  return foundTierConfig ? allowed : undefined
}

/** Normalizes a Claude bootstrap payload into ordered, deduplicated provider models. */
export const parseClaudeWebModels = (value: unknown): ProviderModelDefinition[] => {
  const root = asObject(value)
  if (!root) return []
  const selected = selectorModels(root)
  const models = selected.length > 0 ? selected : bootstrapModels(root)
  const allowedModels = collectTierAllowedModels(root)
  const seen = new Set<string>()
  const unique = models.filter((model) => {
    if (allowedModels && !allowedModels.has(model.modelId)) return false
    if (seen.has(model.modelId)) return false
    seen.add(model.modelId)
    return true
  })
  return unique.sort((left, right) => left.name.localeCompare(right.name))
}

/** Resolves the Claude Web thinking payload from model capabilities and the requested effort. */
export const resolveClaudeThinking = (
  supportsReasoning: boolean,
  reasoningEfforts: ReasoningEffort[] | undefined,
  requestedEffort: ReasoningEffort,
): { thinkingMode: 'auto' | 'off'; effort?: string } => {
  if (requestedEffort === 'off') return { thinkingMode: 'off' }
  if (!supportsReasoning) return { thinkingMode: 'auto' }
  const allowed = new Set(reasoningEfforts?.filter((effort) => effort !== 'default') ?? [])
  const requested =
    requestedEffort !== 'default' && requestedEffort !== 'auto' ? requestedEffort : undefined
  const effort = requested && allowed.has(requested) ? requested : undefined
  return effort ? { thinkingMode: 'auto', effort } : { thinkingMode: 'auto' }
}

/** Flattens compatible messages into the Claude Web prompt and collects inline images. */
export const buildClaudePrompt = (
  messages: ReadonlyArray<{ role: string; content: string | Array<Record<string, unknown>> }>,
): { prompt: string; images: Array<{ mediaType: string; data: string }> } => {
  const images: Array<{ mediaType: string; data: string }> = []
  const sections: string[] = []
  /** Appends one non-empty normalized message section to the flattened prompt. */
  const pushContent = (prefix: string, content: unknown): void => {
    const text = contentToText(content, images)
    if (text) sections.push(`${prefix}: ${text}`)
  }
  for (const message of messages) {
    if (message.role === 'system') pushContent('System', message.content)
    else if (message.role === 'assistant') pushContent('Assistant', message.content)
    else if (message.role === 'user') pushContent('Human', message.content)
  }
  const prompt = sections.join('\n\n')
  if (!prompt.trim()) throw new Error('Claude Web requires a non-empty prompt.')
  if (prompt.length > 2_000_000) throw new Error('Claude Web prompt is too large.')
  return { prompt, images }
}

/** Converts one message content value into prompt text, capturing data-URL images. */
const contentToText = (
  content: unknown,
  images: Array<{ mediaType: string; data: string }>,
): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part): string[] => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return []
      const record = part as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') return [record.text]
      if (record.type === 'image_url') {
        const imageUrl = asObject(record.image_url)
        const url = imageUrl ? readString(imageUrl.url) : undefined
        if (url) {
          const parsed = parseDataUrl(url)
          if (parsed?.isBase64 && parsed.mediaType?.startsWith('image/') && parsed.data) {
            images.push({ mediaType: parsed.mediaType, data: parsed.data })
            return ['[Image attached]']
          }
        }
        return []
      }

      return []
    })
    .join('\n')
}

/** Extracts renderer-ready markdown from one finished artifact or file-tool input document. */
export const extractClaudeToolOutput = (inputJson: string): string | null => {
  try {
    const input = asObject(JSON.parse(inputJson) as unknown)
    if (!input) return null
    const candidates = [
      input,
      asObject(input.artifact),
      asObject(input.file),
      asObject(input.output),
    ].filter((value): value is JsonObject => value !== undefined)
    const contentKeys = ['content', 'code', 'text', 'file_text', 'fileText', 'data']
    const candidate = candidates.find((value) =>
      contentKeys.some((key) => readRawString(value[key]) !== undefined),
    )
    if (!candidate) return null
    const content = contentKeys
      .map((key) => readRawString(candidate[key]))
      .find((value) => value !== undefined)
    if (!content) return null
    const metadata = { ...input, ...candidate }
    const language = firstString(metadata, [
      'language',
      'artifact_type',
      'artifactType',
      'mime_type',
      'mimeType',
      'content_type',
      'contentType',
    ])
    const fileName = firstString(metadata, ['path', 'file_path', 'filePath', 'filename', 'name'])
    const isSvg =
      /^(?:svg|image\/svg\+xml)$/i.test(language ?? '') ||
      /\.svg$/i.test(fileName ?? '') ||
      /^\s*<svg(?:\s|>)/i.test(content)
    if (isSvg) {
      if (/^\s*```svg\b/i.test(content)) return content
      return `\`\`\`svg\n${content}\n\`\`\``
    }
    return content
  } catch {
    return null
  }
}

/** Extracts text content from a tool_result content block, when present. */
const readToolResult = (inner: JsonObject): string | null => {
  const block = asObject(inner.content_block)
  if (block?.type !== 'tool_result') return null
  const parts = Array.isArray(block.content) ? block.content : [block.content]
  const text = parts
    .map((part) => (asObject(part) && readString((part as JsonObject).text)) ?? '')
    .join('')
  return text || null
}

/** One artifact tool input announced by a content block start, when present. */
const readToolUseStart = (
  inner: JsonObject,
): { name: string; input: Record<string, unknown> | null } | null => {
  const block = asObject(inner.content_block)
  if (!block) return null
  if (block.type === 'tool_use' || block.type === 'server_tool_use') {
    const name = readString(block.name)
    return name ? { name, input: asObject(block.input) ?? null } : null
  }
  if (block.type === 'artifact' || block.type === 'code') {
    return { name: String(block.type), input: block }
  }
  return null
}

/** Parses one Claude Web completion SSE data line into content, reasoning, and errors. */
export const parseClaudeSseLine = (line: string): ClaudeSseDelta | null => {
  const value = line.trim()
  if (!value.startsWith('data:')) return null
  const data = value.slice(5).trim()
  if (!data) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  const event = asObject(parsed)
  if (!event) return null
  const inner = asObject(event.event) ?? event
  const type = readString(inner.type)
  const index = readIndex(inner.index) ?? readIndex(event.index)
  const empty = {
    index,
    content: '',
    reasoning: '',
    done: false,
    error: null,
    toolUseStart: null,
    toolJsonDelta: null,
    toolResultText: null,
    blockStop: false,
  }
  if (type === 'error') {
    const error = asObject(inner.error)
    const message = error
      ? readString(error.message) || readString(error.type) || 'Claude Web returned an error.'
      : 'Claude Web returned an error.'
    return { ...empty, error: message }
  }
  if (type === 'message_stop') return { ...empty, done: true }
  if (type === 'content_block_start') {
    return {
      ...empty,
      toolUseStart: readToolUseStart(inner),
      toolResultText: readToolResult(inner),
    }
  }
  if (type === 'content_block_stop') return { ...empty, blockStop: true }
  if (type === 'content_block_delta') {
    const delta = asObject(inner.delta)
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { ...empty, content: delta.text }
    }
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      return { ...empty, reasoning: delta.thinking }
    }
    if (delta?.type === 'thinking_summary_delta') {
      const summary = asObject(delta.summary)
      const reasoning =
        readRawString(summary?.summary) ??
        readRawString(summary?.text) ??
        readRawString(delta.summary) ??
        readRawString(delta.text)
      return reasoning ? { ...empty, reasoning } : empty
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      return { ...empty, toolJsonDelta: delta.partial_json }
    }
    return empty
  }
  return empty
}

interface ClaudeToolBlock {
  name: string
  input: Record<string, unknown> | null
  partialJson: string
}

/** Returns whether one Claude tool can carry response content that belongs in the chat. */
const isRenderableTool = (name: string): boolean =>
  /(?:^|__|_)(?:output|artifact|create_file|write_file|present_files?)(?:$|_)/i.test(name) ||
  /artifact/i.test(name)

/** Accumulates indexed Claude content blocks and emits renderer-ready stream deltas. */
export class ClaudeStreamAccumulator {
  private readonly tools = new Map<number, ClaudeToolBlock>()

  /** Consumes one SSE data line and returns every displayable delta it completes. */
  public push(line: string): ClaudeStreamOutput[] {
    const event = parseClaudeSseLine(line)
    if (!event) return []
    if (event.error) throw new Error(event.error)
    const outputs: ClaudeStreamOutput[] = []
    const index = event.index ?? 0
    if (event.toolUseStart) {
      this.tools.set(index, {
        name: event.toolUseStart.name,
        input: event.toolUseStart.input,
        partialJson: '',
      })
    }
    if (event.toolJsonDelta) {
      const tool = this.tools.get(index)
      if (tool) tool.partialJson += event.toolJsonDelta
    }
    if (event.blockStop) outputs.push(...this.finishTool(index))
    if (event.reasoning) outputs.push({ type: 'reasoning', delta: event.reasoning })
    if (event.toolResultText) {
      const rendered =
        extractClaudeToolOutput(JSON.stringify({ content: event.toolResultText })) ??
        event.toolResultText
      outputs.push({ type: 'content', delta: `\n\n${rendered}\n\n` })
    }
    if (event.content) outputs.push({ type: 'content', delta: event.content })
    if (event.done) {
      for (const toolIndex of [...this.tools.keys()]) outputs.push(...this.finishTool(toolIndex))
    }
    return outputs
  }

  /** Finishes one indexed tool block and emits its artifact when it is renderer-safe. */
  private finishTool(index: number): ClaudeStreamOutput[] {
    const tool = this.tools.get(index)
    this.tools.delete(index)
    if (!tool || !isRenderableTool(tool.name)) return []
    const inputJson = tool.partialJson.trim() ? tool.partialJson : JSON.stringify(tool.input ?? {})
    const rendered = extractClaudeToolOutput(inputJson)
    return rendered ? [{ type: 'content', delta: `\n\n${rendered}\n\n` }] : []
  }
}
