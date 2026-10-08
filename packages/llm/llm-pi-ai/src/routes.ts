/**
 * The `llmPiAiRoutes` service: provider routes another plugin supplies at
 * runtime to the default `llm-pi-ai` instance, beside the routes its
 * configuration declares.
 *
 * @module
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { PiAiProviderProfile } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmPiAiRoutes: PiAiRouteContributions
  }
}

/** The `llm-pi-ai` instance's side of {@link PiAiRouteContributions}. */
export interface PiAiRouteContributionHost {
  /**
   * Validate and publish one contribution.
   * @param providers - the contributed profiles, keyed by route.
   * @returns the key that withdraws exactly this contribution.
   * @throws {LlmError} when a route key is already served, or a profile is invalid.
   */
  add(providers: Readonly<Record<string, PiAiProviderProfile>>): symbol
  /**
   * Withdraw one contribution.
   * @param key - the key `add` returned.
   */
  remove(key: symbol): void
}

/**
 * Provider routes contributed at runtime. A contributed route serves requests
 * and appears in model selectors exactly like a configured one, but it is not
 * part of the plugin's configuration or user settings: the configurable
 * provider directory (the Models page) does not list it, and no settings or
 * patch layer is written.
 */
export class PiAiRouteContributions extends Service {
  /**
   * @param ctx - the `llm-pi-ai` plugin context that owns the routes.
   * @param host - the instance that validates and serves contributions.
   */
  constructor(ctx: Context, private readonly host: PiAiRouteContributionHost) {
    super(ctx, 'llmPiAiRoutes')
  }

  /**
   * Serve `providers` until the returned function is called or the calling
   * plugin unloads. Profiles take the same fields and validation as the
   * plugin's `providers` configuration. To change a contribution, withdraw
   * it and contribute the replacement.
   * @param providers - profiles keyed by route; keys must not collide with a
   *   configured route or another live contribution.
   * @returns a function that withdraws this contribution; calling it again is a no-op.
   * @throws {LlmError} `DUPLICATE_ROUTE` on a key collision; `INVALID_ROUTE` on an invalid profile.
   */
  contribute(providers: Readonly<Record<string, PiAiProviderProfile>>): () => void {
    const host = this.host
    const dispose = this.ctx.effect(function* () {
      const key = host.add(providers)
      yield () => { host.remove(key) }
    }, 'llmPiAiRoutes.contribute()')
    return () => void dispose()
  }
}
