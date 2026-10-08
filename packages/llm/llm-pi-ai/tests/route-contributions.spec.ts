/** Routes contributed through `llmPiAiRoutes` serve requests without entering configuration. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** Another adapter family's route holder; never asked to stream. */
class StubAdapter extends LlmAdapter {
  override async * stream(): AsyncIterable<never> {
    throw new Error('stub adapter must never stream')
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** The contributor plugin's live handle, set while its fiber is active. */
const contributor: { routes?: Context['llmPiAiRoutes'] | undefined } = {}

/** A downstream plugin that contributes routes, standing in for a distribution's gateway plugin. */
const RouteContributor = {
  name: 'test-route-contributor',
  inject: ['llmPiAiRoutes'],
  apply(ctx: Context) {
    contributor.routes = ctx.llmPiAiRoutes
    ctx.effect(() => () => { contributor.routes = undefined })
  },
}

/** Boot a dormant `llm-pi-ai`, the credential store, and the contributor through a real profile. */
async function loadComposition(): Promise<{ ctx: Context; patchPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-pi-contributions-'))
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  GATEWAY_KEY: gateway-key-from-store\n', { mode: 0o600 })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '- id: route-contributor',
    "  name: 'test-route-contributor'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ['test-route-contributor', RouteContributor],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  const patchPath = await profileComposition(ctx, root, configPath)
  return { ctx, patchPath }
}

/** A hand-declared OpenAI-compatible gateway route. */
function gatewayRoute(baseURL: string, models: { id: string; name: string }[]): PiAiProviderProfile {
  return { displayName: 'Gateway Cloud', api: 'openai-completions', baseURL, apiKeyEnv: 'GATEWAY_KEY', models }
}

const readPatch = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '<absent>')

function providerIds(ctx: Context): string[] {
  return ctx.llm.listProviders().map(provider => provider.id)
}

describe('llm-pi-ai contributed routes', () => {
  it('serves a contributed route with the stored credential, outside configuration and the directory', async () => {
    vi.stubEnv('GATEWAY_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, patchPath } = await loadComposition()
    const patchBefore = await readPatch(patchPath)

    contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })

    expect(providerIds(ctx)).toEqual(['gateway'])
    expect(ctx.llm.listProviders()[0]?.name).toBe('Gateway Cloud')
    expect(ctx.llm.listConfigurableProviders().some(entry => entry.provider === 'gateway')).toBe(false)
    expect((await ctx.llm.listModels('gateway')).map(model => model.id)).toEqual(['chat'])
    const result = await assemble(ctx, { provider: 'gateway', model: 'chat', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer gateway-key-from-store')
    expect(await readPatch(patchPath)).toBe(patchBefore)
  })

  it('announces a model-list change and serves the new model', async () => {
    vi.stubEnv('GATEWAY_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx } = await loadComposition()
    const withdraw = contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })
    const updated = vi.fn()
    ctx.on('llm/adapters-updated', updated)

    withdraw()
    contributor.routes!.contribute({
      gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }, { id: 'reasoner', name: 'Reasoner' }]),
    })

    expect(updated).toHaveBeenCalled()
    expect((await ctx.llm.listModels('gateway')).map(model => model.id)).toEqual(['chat', 'reasoner'])
    const result = await assemble(ctx, { provider: 'gateway', model: 'reasoner', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('keeps a contributed route across user settings writes, and keeps it out of the settings document', async () => {
    vi.stubEnv('GATEWAY_KEY', '')
    vi.stubEnv('ACME_KEY', 'acme-key')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, patchPath } = await loadComposition()
    contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })

    await ctx.settings.update('llm-pi-ai', {
      providers: { acme: { apiKeyEnv: 'ACME_KEY', api: 'openai-completions', baseURL: server.url, models: [{ id: 'acme-1' }] } },
    })
    await vi.waitFor(() => { expect(providerIds(ctx).sort()).toEqual(['acme', 'gateway']) }, { timeout: 5000 })
    expect(await readPatch(patchPath)).not.toContain('gateway')

    await ctx.settings.replace('llm-pi-ai', { providers: {} })
    await vi.waitFor(() => { expect(providerIds(ctx)).toEqual(['gateway']) }, { timeout: 5000 })
    const result = await assemble(ctx, { provider: 'gateway', model: 'chat', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('refuses a key a configured route or another contribution already serves, keeping the current routes', async () => {
    vi.stubEnv('ACME_KEY', 'acme-key')
    const server = await mockServer([])
    const { ctx } = await loadComposition()
    await ctx.settings.update('llm-pi-ai', {
      providers: { acme: { apiKeyEnv: 'ACME_KEY', api: 'openai-completions', baseURL: server.url, models: [{ id: 'acme-1' }] } },
    })
    await vi.waitFor(() => { expect(providerIds(ctx)).toEqual(['acme']) }, { timeout: 5000 })
    contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })

    expect(() => contributor.routes!.contribute({ acme: gatewayRoute(server.url, [{ id: 'x', name: 'X' }]) }))
      .toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'DUPLICATE_ROUTE' }) }))
    expect(() => contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'x', name: 'X' }]) }))
      .toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'DUPLICATE_ROUTE' }) }))
    expect(providerIds(ctx).sort()).toEqual(['acme', 'gateway'])
    expect((await ctx.llm.listModels('gateway')).map(model => model.id)).toEqual(['chat'])
  })

  it('keeps the current routes when the registry refuses a key another adapter serves', async () => {
    const server = await mockServer([])
    const { ctx } = await loadComposition()
    ctx.llm.registerAdapter(['taken'], new StubAdapter())
    contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })

    expect(() => contributor.routes!.contribute({
      second: gatewayRoute(server.url, [{ id: 'second-1', name: 'Second' }]),
      taken: gatewayRoute(server.url, [{ id: 'x', name: 'X' }]),
    })).toThrow()
    expect(providerIds(ctx).sort()).toEqual(['gateway', 'taken'])

    contributor.routes!.contribute({ second: gatewayRoute(server.url, [{ id: 'second-1', name: 'Second' }]) })
    expect(providerIds(ctx).sort()).toEqual(['gateway', 'second', 'taken'])
  })

  it('refuses an invalid profile', async () => {
    await loadComposition()
    expect(() => contributor.routes!.contribute({ gateway: { api: 'openai-completions', baseURL: '' } }))
      .toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'INVALID_ROUTE' }) }))
  })

  it('withdraws on the returned function, idempotently', async () => {
    const server = await mockServer([])
    const { ctx } = await loadComposition()
    const withdraw = contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })
    withdraw()
    withdraw()
    expect(providerIds(ctx)).toEqual([])
  })

  it('withdraws when the contributing plugin unloads', async () => {
    const server = await mockServer([])
    const { ctx } = await loadComposition()
    contributor.routes!.contribute({ gateway: gatewayRoute(server.url, [{ id: 'chat', name: 'Chat' }]) })
    expect(providerIds(ctx)).toEqual(['gateway'])

    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'route-contributor')
    await entry!.update({ disabled: true })

    await vi.waitFor(() => { expect(providerIds(ctx)).toEqual([]) }, { timeout: 5000 })
    expect(contributor.routes).toBeUndefined()
  })
})
