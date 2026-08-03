/** Defines the provider family contract that every provider type implements. */

import type {
  ProviderAuthStatus,
  ProviderConnectionInput,
  ProviderModelDefinition,
  ProviderType,
  ProviderUsageState,
} from '@shared/index'

/** A family-specific adapter handling catalog fetches and optional authentication for one provider type. */
export interface ProviderFamily {
  readonly type: ProviderType
  /** Fetches the model catalog using the connection fields or the saved provider identifier. */
  fetchCatalog(connection: ProviderConnectionInput): Promise<ProviderModelDefinition[]>
  /** Starts the family's sign-in flow (OAuth browser or embedded login window). */
  startSignIn?(providerId: string): Promise<void>
  /** Signs the family out and clears its persisted credentials. */
  signOut?(providerId: string): Promise<void>
  /** Returns renderer-safe authentication state for one saved provider. */
  authStatus?(providerId: string): Promise<ProviderAuthStatus>
  /** Fetches rate-limit usage for one saved provider account. */
  fetchUsage?(providerId: string): Promise<ProviderUsageState>
}
