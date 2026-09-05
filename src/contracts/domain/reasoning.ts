/** Defines the portable reasoning-effort vocabulary shared by every provider family. */

/** Lists portable provider reasoning-effort choices, including an untouched server default. */
export const REASONING_EFFORTS = [
  'default',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'auto',
] as const

/**
 * Identifies one model reasoning-effort setting. Server catalogs may report
 * extra levels (e.g. OpenRouter `max`), so any safe string is accepted beyond
 * the known vocabulary.
 */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number] | (string & {})

/** Matches future server-supplied levels absent from the known vocabulary. */
const EXTRA_EFFORT_PATTERN = /^[a-z0-9_-]{1,50}$/i

/** Returns true for known levels and safe server-supplied extras such as `max`. */
export const isReasoningEffortValue = (value: unknown): value is ReasoningEffort =>
  typeof value === 'string' &&
  ((REASONING_EFFORTS as readonly string[]).includes(value) || EXTRA_EFFORT_PATTERN.test(value))
