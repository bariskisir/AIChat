/** Barrel for the provider layer: families, registries, and shared contracts. */

export { ChatGptAuth } from './chatgpt/chatgpt.auth'
export { ChatGptFamily } from './chatgpt/chatgpt.family'
export * from './chatgpt/chatgpt.protocol'
export type { ChatGptCredentials } from './chatgpt/chatgpt.types'
export { ClaudeWebAuth } from './claude-web/claude-web.auth'
export { ClaudeWebFamily } from './claude-web/claude-web.family'
export * from './claude-web/claude-web.protocol'
export type { ClaudeWebAccount } from './claude-web/claude-web.types'
export { ProviderRegistry } from './provider.registry'
export { OpenAiCompatibleFamily } from './openai-compatible/openai-compatible.family'
export { normalizeOpenAiBaseUrl } from './openai-compatible/openai-compatible.base-url'
export type { ProviderFamily } from './provider.family'
