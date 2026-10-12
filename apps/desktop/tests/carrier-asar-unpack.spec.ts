import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { carrierAsarUnpackPatterns } from '../scripts/carrier-asar-unpack.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function stage(carriers: Record<string, unknown>): Promise<string> {
  const dsh = await mkdtemp(join(tmpdir(), 'dsh-carrier-unpack-'))
  roots.push(dsh)
  await writeFile(join(dsh, 'package.json'), JSON.stringify({ dsh: { carrier: { bundles: Object.keys(carriers) } } }))
  for (const [name, desktop] of Object.entries(carriers)) {
    await mkdir(join(dsh, 'node_modules', name), { recursive: true })
    await writeFile(join(dsh, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, dsh: { bundle: {}, ...desktop === undefined ? {} : { desktop } } }))
  }
  return dsh
}

it('turns each carrier bundle s declared globs into patterns over its installed directory', async () => {
  const dsh = await stage({ '@acme/models': { asarUnpack: ['vendor/**/*', 'presets/**/*'] }, plain: undefined })
  await expect(carrierAsarUnpackPatterns(dsh)).resolves.toEqual([
    '**/node_modules/@acme/models/vendor/**/*',
    '**/node_modules/@acme/models/presets/**/*',
  ])
})

it('returns nothing for a prepared directory without carrier bundles', async () => {
  await expect(carrierAsarUnpackPatterns(await stage({}))).resolves.toEqual([])
})

it('rejects a glob that leaves the bundle', async () => {
  const dsh = await stage({ escape: { asarUnpack: ['../other/**/*'] } })
  await expect(carrierAsarUnpackPatterns(dsh)).rejects.toThrow('escape dsh.desktop.asarUnpack must list package-relative globs')
})
