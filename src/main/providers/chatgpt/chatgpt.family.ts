/** Implements the ChatGPT provider family adapter over the shared ChatGPT auth service. */

import type { ProviderConnectionInput, ProviderModelDefinition } from '@shared/index'
import type { ProviderFamily } from '../provider.family'
import type { ChatGptAuth } from './chatgpt.auth'

/** Bridges the ChatGPT login family to the provider registry and chat service. */
export class ChatGptFamily implements ProviderFamily {
  public readonly type = 'chatgpt' as const

  /** Creates the ChatGPT family around one shared auth service. */
  public constructor(private readonly auth: ChatGptAuth) {}

  /** Fetches the Codex model catalog for a provider saved before the fetch. */
  public async fetchCatalog(
    connection: ProviderConnectionInput,
  ): Promise<ProviderModelDefinition[]> {
    if (!connection.id) throw new Error('Save the provider before fetching its models.')
    return this.auth.fetchModels(connection.id)
  }

  /** Starts the ChatGPT PKCE OAuth flow in the system browser for one provider. */
  public startSignIn(providerId: string): Promise<void> {
    return Promise.resolve(this.auth.startLogin(providerId))
  }

  /** Clears the persisted credential document of one ChatGPT provider. */
  public signOut(providerId: string): Promise<void> {
    return this.auth.logout(providerId)
  }

  /** Returns renderer-safe authentication state for the app-owned ChatGPT login. */
  public authStatus(providerId: string) {
    return this.auth.getAuthStatus(providerId)
  }

  /** Fetches rate-limit usage for the ChatGPT provider account. */
  public fetchUsage(providerId: string) {
    return this.auth.fetchUsage(providerId)
  }
}
