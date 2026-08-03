/** Claude Web protocol contracts: bootstrap catalogs, accounts, prompts, and SSE deltas. */

/** Claude.ai web origin used by every conversation and bootstrap request. */
export const CLAUDE_ORIGIN = 'https://claude.ai'

/** The Claude Web upload endpoint accept header sent by the embedded browser session. */
export const CLAUDE_UPLOAD_ACCEPT = 'application/json'

/** One parsed Claude Web SSE event with renderer-ready deltas. */
export interface ClaudeSseDelta {
  index: number | null
  content: string
  reasoning: string
  done: boolean
  error: string | null
  toolUseStart: { name: string; input: Record<string, unknown> | null } | null
  toolJsonDelta: string | null
  toolResultText: string | null
  blockStop: boolean
}

/** One renderer-facing text or reasoning delta produced from a Claude Web stream line. */
export interface ClaudeStreamOutput {
  type: 'content' | 'reasoning'
  delta: string
}

/** The account and organization identity extracted from a Claude bootstrap payload. */
export interface ClaudeWebAccount {
  email: string
  plan: string
}
