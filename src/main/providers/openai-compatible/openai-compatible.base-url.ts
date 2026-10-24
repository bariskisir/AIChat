/** Provides pure URL helpers shared by OpenAI-compatible model and generation requests. */

/** Appends the OpenAI-compatible API prefix while preserving URLs that already include it. */
export const normalizeOpenAiBaseUrl = (input: string): string => {
  const url = new URL(input)
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (url.hostname.toLowerCase() === 'opencode.ai') {
    if (url.pathname === '/inference/v1' || url.pathname === '/zen/v1') {
      url.pathname = '/inference/openai/v1'
    }
  }
  if (!/\/v1$/i.test(url.pathname)) url.pathname = `${url.pathname}/v1`.replace(/\/{2,}/g, '/')
  return url.toString().replace(/\/$/, '')
}
