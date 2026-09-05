/** Builds portable reasoning parameters for OpenAI-compatible requests. */

import type { ReasoningEffort } from '@shared/index'

/** Maps the application off value to the portable API vocabulary. */
const toApiEffort = (effort: ReasoningEffort): string => (effort === 'off' ? 'none' : effort)

/** Builds one generic reasoning parameter set without inspecting the selected model or endpoint. */
export const buildReasoningParameters = (
  _modelId: string,
  effort: ReasoningEffort,
  _provider?: { id?: string | undefined; name?: string | undefined; baseUrl?: string | undefined },
): Record<string, unknown> | null =>
  effort === 'default' ? null : { reasoning_effort: toApiEffort(effort) }
