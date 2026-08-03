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

/** Identifies one model reasoning-effort setting. */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
