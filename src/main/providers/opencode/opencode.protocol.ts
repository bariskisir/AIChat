/**
 * Pure protocol helpers for the OpenCode Zen backend: client version tracking,
 * per-conversation session identifiers, and the mandatory Responses tools.
 */

import { randomBytes } from 'node:crypto'
import { httpFetch } from '../../http/http.fetch'

/** NPM registry document holding the latest published opencode-ai version. */
export const OPENCODE_LATEST_URL = 'https://registry.npmjs.org/opencode-ai/latest'

/** Pinned OpenCode client version used when the NPM registry is unreachable. */
export const DEFAULT_OPENCODE_CLIENT_VERSION = '1.18.31'

/** Tools the OpenCode Zen Responses endpoint requires on every request. */
export const OPENCODE_TOOLS: Array<Record<string, unknown>> = [
  { type: 'function', name: 'bash', parameters: {} },
  { type: 'function', name: 'read', parameters: {} },
]

/** Tools the OpenCode Zen chat-completions endpoint requires: function names nested under `function`. */
export const OPENCODE_CHAT_TOOLS: Array<Record<string, unknown>> = [
  { type: 'function', function: { name: 'bash' } },
  { type: 'function', function: { name: 'read' } },
]

/** Instruction prepended to the first OpenCode user message so the model avoids tool calls. */
export const OPENCODE_NO_TOOLS_INSTRUCTION = 'Do not use tools.'

/** Minimal message shape shared by chat-completions and Responses request builders. */
export interface OpencodeMessageLike {
  role: string
  content: string | Array<Record<string, unknown>>
}

/** Extracts plain text from one message content value, preserving stream-significant whitespace. */
const opencodeTextContent = (content: string | Array<Record<string, unknown>>): string => {
  if (typeof content === 'string') return content
  const parts: string[] = []
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      parts.push(part.text)
    }
  }
  return parts.join('\n\n')
}

/**
 * Merges system prompts into every user message for OpenCode providers.
 * The Zen backend handles system instructions more reliably when they are
 * inlined, and every OpenCode turn carries an explicit no-tools directive
 * so the whole session stays tool-free. System messages are removed from
 * the returned array.
 */
export const applyOpencodeSessionPolicy = <T extends OpencodeMessageLike>(
  messages: readonly T[],
): T[] => {
  const systemTexts: string[] = []
  for (const message of messages) {
    if (message.role !== 'system') continue
    const text =
      typeof message.content === 'string'
        ? message.content.trim()
        : opencodeTextContent(message.content).trim()
    if (text) systemTexts.push(text)
  }
  const prefix =
    systemTexts.length > 0
      ? `${systemTexts.join('\n\n')}\n\n${OPENCODE_NO_TOOLS_INSTRUCTION}`
      : OPENCODE_NO_TOOLS_INSTRUCTION
  const withoutSystem = messages.filter((message) => message.role !== 'system')
  if (!withoutSystem.some((message) => message.role === 'user')) {
    return [{ role: 'user', content: prefix } as T, ...withoutSystem]
  }
  return withoutSystem.map((message) => {
    if (message.role !== 'user') return message
    if (typeof message.content === 'string') {
      if (message.content.startsWith(prefix)) return message
      const original = message.content.trim()
      return {
        ...message,
        content: original ? `${prefix}\n\n${message.content}` : prefix,
      }
    }
    const first = message.content[0]
    if (
      first &&
      first.type === 'text' &&
      typeof first.text === 'string' &&
      first.text.startsWith(prefix)
    ) {
      return message
    }
    return {
      ...message,
      content: [{ type: 'text', text: prefix }, ...message.content],
    }
  })
}

/** Backwards-compatible alias kept for the first-message-only policy name. */
export const applyOpencodeFirstMessagePolicy = applyOpencodeSessionPolicy

/** Lowercase alphanumeric alphabet used for session identifier padding. */
const SESSION_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Generates cryptographically random lowercase alphanumeric characters. */
const randomSuffix = (length: number): string => {
  if (length <= 0) return ''
  const bytes = randomBytes(length)
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === undefined) continue
    output += SESSION_ALPHABET[byte % SESSION_ALPHABET.length]
  }
  return output
}

/**
 * Maps one local conversation to the stable OpenCode session identifier.
 * The identifier is always `ses_` followed by exactly 26 lowercase
 * alphanumeric characters, deriving deterministically from the conversation
 * identifier and padding with random characters when it is too short.
 */
export const opencodeSessionId = (conversationId?: string | undefined): string => {
  const cleaned = (conversationId ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  const deterministic = cleaned.slice(0, 26)
  const suffix =
    deterministic.length >= 26
      ? deterministic
      : `${deterministic}${randomSuffix(26 - deterministic.length)}`
  return `ses_${suffix}`
}

let cachedClientVersion: string | null = null
let cachedClientVersionPromise: Promise<string> | null = null

/** Resets the cached OpenCode client version, allowing tests to refetch deterministically. */
export const resetOpencodeClientVersionCache = (): void => {
  cachedClientVersion = null
  cachedClientVersionPromise = null
}

/** Resolves the OpenCode client version from the NPM registry once per process. */
export const getOpencodeClientVersion = async (): Promise<string> => {
  if (cachedClientVersion) return cachedClientVersion
  if (cachedClientVersionPromise) return cachedClientVersionPromise
  cachedClientVersionPromise = (async (): Promise<string> => {
    try {
      const response = await httpFetch(OPENCODE_LATEST_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const payload = (await response.json()) as unknown
        const version =
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).version
            : ''
        if (typeof version === 'string' && version.trim()) {
          cachedClientVersion = version.trim()
          return cachedClientVersion
        }
      }
    } catch {
      // Fall back to the pinned client version when the registry is unreachable.
    }
    cachedClientVersion = DEFAULT_OPENCODE_CLIENT_VERSION
    return cachedClientVersion
  })()
  return cachedClientVersionPromise
}

/** Builds the mandatory OpenCode User-Agent header value for one client version. */
export const opencodeUserAgent = (version: string): string => `opencode/${version}`
