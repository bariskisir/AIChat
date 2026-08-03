/** Implements the Claude Web provider family adapter over the shared Claude session auth. */

import type { ProviderConnectionInput, ProviderModelDefinition } from '@shared/index'
import type { ProviderFamily } from '../provider.family'
import type { ClaudeWebAuth } from './claude-web.auth'

/** Bridges the Claude Web login family to the provider registry and chat service. */
export class ClaudeWebFamily implements ProviderFamily {
  public readonly type = 'claude-web' as const

  /** Creates the Claude Web family around one shared session auth service. */
  public constructor(private readonly auth: ClaudeWebAuth) {}

  /** Fetches the bootstrap model catalog for a provider saved before the fetch. */
  public async fetchCatalog(
    connection: ProviderConnectionInput,
  ): Promise<ProviderModelDefinition[]> {
    if (!connection.id) throw new Error('Save the provider before fetching its models.')
    return this.auth.fetchModels(connection.id)
  }

  /** Opens the embedded Claude Web login window for one provider. */
  public startSignIn(providerId: string): Promise<void> {
    return this.auth.startLogin(providerId)
  }

  /** Clears the persistent session cookies for one provider. */
  public signOut(providerId: string): Promise<void> {
    return this.auth.logout(providerId)
  }

  /** Returns authentication state for one Claude Web session. */
  public authStatus(providerId: string) {
    return this.auth.status(providerId)
  }
}
