/** Defines ChatGPT-specific credential and persistence shapes. */

/** The Codex CLI auth.json token shape also used by ChatGPT in-app logins. */
export interface CodexAuthTokens {
  access_token: string
  refresh_token: string
  id_token: string
  account_id: string
}

/** The persisted ChatGPT credential document. */
export interface CodexAuthFile {
  tokens?: Partial<CodexAuthTokens>
  last_refresh?: string
}

/** Live ChatGPT credentials resolved from the persisted token document. */
export interface ChatGptCredentials {
  accessToken: string
  accountId: string
}
