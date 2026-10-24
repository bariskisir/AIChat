/**
 * Pure protocol helpers for the OpenCode Zen backend: client version tracking,
 * per-conversation session identifiers, and the mandatory Responses tools.
 */

import { randomBytes } from 'node:crypto'
import { bunFetch } from '../../http/bun.fetch'

/** In-memory cached project identifier generated for OpenCode CLI emulation. */
let defaultProjectId: string | null = null

/** Generates or reuses a 40-character hex project identifier for OpenCode CLI emulation. */
export const opencodeProjectId = (): string => {
  if (process.env.OPENCODE_PROJECT) return process.env.OPENCODE_PROJECT
  if (!defaultProjectId) {
    defaultProjectId = randomBytes(20).toString('hex')
  }
  return defaultProjectId
}

/** Update endpoint holding the latest published opencode CLI version (v2 line). */
export const OPENCODE_LATEST_URL = 'https://opencode.ai/update/api/latest/cli/npm'

/** Pinned OpenCode client version used when the update endpoint is unreachable. */
export const DEFAULT_OPENCODE_CLIENT_VERSION = '2.0.29'

/**
 * Tools the OpenCode Responses endpoint requires on every request.
 * Every tool carries a description and a JSON-schema parameters object:
 * the free-tier gate rejects placeholder tools without them.
 */
export const OPENCODE_TOOLS: Array<Record<string, unknown>> = [
  {
    type: 'function',
    name: 'bash',
    description: 'Run a shell command',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'edit',
    description: 'Edit a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'glob',
    description: 'Find files by pattern',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'grep',
    description: 'Search file contents',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'read',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: false,
  },
  {
    type: 'function',
    name: 'write',
    description: 'Write a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    strict: false,
  },
]

/**
 * Tools the OpenCode chat-completions endpoint requires: function names nested
 * under `function`. Like the Responses tools, every entry carries a description
 * and a JSON-schema parameters object the free-tier gate accepts.
 */
export const OPENCODE_CHAT_TOOLS: Array<Record<string, unknown>> = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files by pattern',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Write a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
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
 * Canonical system prompt required by OpenCode CLI backend to identify
 * legitimate OpenCode client sessions.
 */
export const OPENCODE_HARNESS_SYSTEM_PROMPT = `You are an AI agent running in OpenCode, a coding agent harness. Help the user accomplish their goals using the tools you have available.

# Harness
- Responses are rendered as GitHub-flavored Markdown.
- <system-reminder> blocks are harness instructions, not user-authored content. Read and follow them.
- Prefer parallelizing independent tool calls.
- Prefer dedicated tools over shell commands; fall back to the shell when a tool cannot do what you need.
- Do not chain shell commands with separators like echo "====="; or printf '---'; the output becomes noisy in a way that makes the user's side of the conversation worse.
- Use the write tool to create files or completely replace their content. Prefer using the edit tool for targeted changes.
- Use the edit tool for targeted changes to existing text files. It replaces the exact text in oldString with newString, and the values must differ. By default, oldString must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set replaceAll to true to replace every occurrence.

# Communication
- Use clear file paths when referring to files.
- Keep responses clear and concise, and avoid unnecessary technical jargon.

# Working in codebases
- Keep changes consistent with the structure, naming, style, and patterns of the surrounding code.
- Treat unfamiliar files or changes as potential user work and investigate before deleting or overwriting them.

# Your Model
- Name: OpenCode Assistant
- Provider ID: opencode
- Model ID: default
# Code Mode

Use the execute tool to call the tools listed below. They cannot be called directly. They only work inside code you pass to execute.

The catalog is complete. Do not guess tool names.

## Available tools

- opencode (8 tools)
  - tools.opencode.list_mcp_resources
  - tools.opencode.models
  - tools.opencode.read_mcp_resource
  - tools.opencode.session_move
  - tools.opencode.session_rename
  - tools.opencode.worktree_create
  - tools.opencode.worktree_list
  - tools.opencode.worktree_remove

Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.
<available_skills>
  <skill>
    <id>opencode</id>
    <name>OpenCode</name>
    <description>OpenCode CLI assistant</description>
  </skill>
</available_skills>

Today's date: Sat Oct 24 2026

Here is some useful information about the environment you are running in:
<env>
  Working directory: C:\\Users\\black
  Workspace root folder: C:\\Users\\black
  Is directory a git repo: no
  Platform: win32
</env>`

/**
 * Merges the mandatory OpenCode harness system prompt into the message list,
 * preserving any user-defined system instructions under User Instructions.
 */
export const applyOpencodeSessionPolicy = <T extends OpencodeMessageLike>(
  messages: readonly T[],
): T[] => {
  const userSystemTexts: string[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text =
        typeof message.content === 'string'
          ? message.content.trim()
          : opencodeTextContent(message.content).trim()
      if (text) userSystemTexts.push(text)
    }
  }

  const systemContent =
    userSystemTexts.length > 0
      ? `${OPENCODE_HARNESS_SYSTEM_PROMPT}\n\n# User Instructions\n${userSystemTexts.join('\n\n')}`
      : OPENCODE_HARNESS_SYSTEM_PROMPT

  const nonSystemMessages = messages.filter((message) => message.role !== 'system')

  return [{ role: 'system', content: systemContent } as T, ...nonSystemMessages]
}

/** Backwards-compatible alias kept for the first-message-only policy name. */
export const applyOpencodeFirstMessagePolicy = applyOpencodeSessionPolicy

/** Base62 alphabet used for the random tail of canonical OpenCode session identifiers. */
const SESSION_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Monotonic counter mixed into the timestamp so identifiers created in the same millisecond differ. */
let sessionCounter = 0
let lastSessionTimestamp = 0

/** In-memory affinity cache: one stable canonical session per local conversation. */
const sessionAffinityCache = new Map<string, string>()

/** Generates one canonical `ses_` identifier with an inverted timestamp prefix. */
const createCanonicalSessionId = (): string => {
  const timestamp = Date.now()
  if (timestamp !== lastSessionTimestamp) {
    lastSessionTimestamp = timestamp
    sessionCounter = 0
  }
  sessionCounter += 1
  const current = BigInt(timestamp) * 0x1000n + BigInt(sessionCounter)
  const inverted = ~current
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((inverted >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, '0'),
  ).join('')
  const bytes = randomBytes(14)
  let tail = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === undefined) continue
    tail += SESSION_BASE62[byte % SESSION_BASE62.length]
  }
  return `ses_${time}${tail}`
}

/**
 * Maps one local conversation to the stable OpenCode session identifier.
 * The identifier is always `ses_` followed by 12 lowercase hex characters
 * (inverted timestamp, matching `ses_<12 hex><14 base62>`) and 14 Base62
 * characters. Identifiers are generated once per conversation and reused
 * so provider routing and prompt caching stay stable, mirroring
 * `SessionAffinity` in the OpenCode CLI.
 */
export const opencodeSessionId = (conversationId?: string | undefined): string => {
  const key = (conversationId ?? '').trim() || 'default'
  const cached = sessionAffinityCache.get(key)
  if (cached) return cached
  const created = createCanonicalSessionId()
  sessionAffinityCache.set(key, created)
  return created
}

let cachedClientVersion: string | null = null
let cachedClientVersionPromise: Promise<string> | null = null

/** Resets the cached OpenCode client version, allowing tests to refetch deterministically. */
export const resetOpencodeClientVersionCache = (): void => {
  cachedClientVersion = null
  cachedClientVersionPromise = null
  defaultProjectId = null
  sessionAffinityCache.clear()
  sessionCounter = 0
  lastSessionTimestamp = 0
}

/** Resolves the OpenCode client version from the update endpoint once per process. */
export const getOpencodeClientVersion = async (): Promise<string> => {
  if (cachedClientVersion) return cachedClientVersion
  if (cachedClientVersionPromise) return cachedClientVersionPromise
  cachedClientVersionPromise = (async (): Promise<string> => {
    try {
      const currentVersion = cachedClientVersion ?? DEFAULT_OPENCODE_CLIENT_VERSION
      const response = await bunFetch(OPENCODE_LATEST_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': opencodeUserAgent(currentVersion),
          'x-opencode-client': 'cli',
        },
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
export const opencodeUserAgent = (version: string): string => `opencode/latest/${version}/cli`

/** Generates W3C traceparent and B3 tracing headers matching OpenCode CLI behavior. */
export const createOpencodeTraceHeaders = (): { b3: string; traceparent: string } => {
  const traceId = randomBytes(16).toString('hex')
  const spanId = randomBytes(8).toString('hex')
  const sampleTail = randomBytes(8).toString('hex')
  return {
    b3: `${traceId}-${spanId}-1-${sampleTail}`,
    traceparent: `00-${traceId}-${spanId}-01`,
  }
}

/** Parameters required to format canonical OpenCode headers. */
export interface OpencodeHeaderOptions {
  version: string
  apiKey?: string | undefined
  conversationId?: string | undefined
  customHeaders?: Record<string, string> | undefined
}

/** Formats the complete Bun-compatible header set for OpenCode API requests. */
export const buildOpencodeHeaders = (options: OpencodeHeaderOptions): Record<string, string> => {
  const affinity = opencodeSessionId(options.conversationId)
  const bearer = options.apiKey || 'public'
  const traces = createOpencodeTraceHeaders()
  const project = opencodeProjectId()

  const custom = { ...(options.customHeaders ?? {}) }
  for (const key of Object.keys(custom)) {
    if (key.toLowerCase() === 'user-agent' || key.toLowerCase() === 'x-api-key') {
      delete custom[key]
    }
  }

  return {
    'Content-Type': 'application/json',
    ...custom,
    'User-Agent': opencodeUserAgent(options.version),
    Authorization: `Bearer ${bearer}`,
    b3: traces.b3,
    traceparent: traces.traceparent,
    'x-opencode-client': 'cli',
    'x-opencode-project': project,
    'x-opencode-session': affinity,
    'x-opencode-session-id': affinity,
    'x-session-affinity': affinity,
    'x-session-id': affinity,
    'X-Session-Id': affinity,
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    Connection: 'keep-alive',
  }
}
