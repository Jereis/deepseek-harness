import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readCarrierBundles } from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function runtimeWith(manifest: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-carrier-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  return root
}

it('reads the carrier bundles the runtime project names, in order', () => {
  expect(readCarrierBundles(runtimeWith({ dsh: { carrier: { bundles: ['@acme/a', '@acme/b'] } } }))).toEqual(['@acme/a', '@acme/b'])
})

it('carries nothing for a plain Desktop runtime', () => {
  expect(readCarrierBundles(runtimeWith({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }))).toEqual([])
})

it('rejects a malformed list instead of silently loading less', () => {
  expect(() => readCarrierBundles(runtimeWith({ dsh: { carrier: { bundles: '@acme/a' } } }))).toThrow('dsh.carrier.bundles')
  expect(() => readCarrierBundles(runtimeWith({ dsh: { carrier: { bundles: [''] } } }))).toThrow('dsh.carrier.bundles')
})
