import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveDesktopCarrierPackages,
  stageDesktopCarrierPackages,
  verifyDesktopCarrierPackages,
} from '../scripts/desktop-carrier-packages.ts'

const directories: string[] = []

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-carrier-'))
  directories.push(directory)
  return directory
}

function pack(root: string, file: string, manifest: object): string {
  const source = join(root, `${file}-source`)
  mkdirSync(join(source, 'package'), { recursive: true })
  writeFileSync(join(source, 'package', 'package.json'), JSON.stringify(manifest))
  execFileSync('tar', ['-czf', join('..', file), 'package'], { cwd: source })
  return join(root, file)
}

function project(): string {
  const directory = temporary()
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name: 'runtime', dependencies: { '@deepseek-ai/dsh': 'file:./packages/dsh.tgz' } })}\n`)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop carrier packages', () => {
  it('reads no carriers when the variable is unset or blank', () => {
    expect(resolveDesktopCarrierPackages({})).toEqual([])
    expect(resolveDesktopCarrierPackages({ DSH_DESKTOP_CARRIER_PACKAGES: ` ${delimiter} ` })).toEqual([])
  })

  it('keeps the listed load order and rejects missing, non-tarball, or repeated entries', () => {
    const root = temporary()
    const first = pack(root, 'b-1.0.0.tgz', { name: 'b', version: '1.0.0', dsh: { bundle: {} } })
    const second = pack(root, 'a-1.0.0.tgz', { name: 'a', version: '1.0.0', dsh: { bundle: {} } })
    expect(resolveDesktopCarrierPackages({ DSH_DESKTOP_CARRIER_PACKAGES: [first, second].join(delimiter) })).toEqual([first, second])
    expect(() => resolveDesktopCarrierPackages({ DSH_DESKTOP_CARRIER_PACKAGES: join(root, 'missing.tgz') })).toThrow(/not a file/u)
    expect(() => resolveDesktopCarrierPackages({ DSH_DESKTOP_CARRIER_PACKAGES: join(root, 'b-1.0.0.tgz-source') })).toThrow(/not a packed \.tgz/u)
    expect(() => resolveDesktopCarrierPackages({ DSH_DESKTOP_CARRIER_PACKAGES: [first, first].join(delimiter) })).toThrow(/twice/u)
  })

  it('stages bundle tarballs as runtime dependencies in load order', () => {
    const root = temporary()
    const auth = pack(root, 'example-auth-0.1.0.tgz', { name: '@example/auth', version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })
    const ui = pack(root, 'example-ui-0.1.0.tgz', { name: '@example/ui', version: '0.1.0', dsh: { bundle: {} } })
    const directory = project()
    expect(stageDesktopCarrierPackages(directory, [auth, ui], new Set(['@deepseek-ai/dsh']))).toEqual([
      { name: '@example/auth', version: '0.1.0', file: 'example-auth-0.1.0.tgz' },
      { name: '@example/ui', version: '0.1.0', file: 'example-ui-0.1.0.tgz' },
    ])
    expect(readdirSync(join(directory, 'carrier-packages')).sort()).toEqual(['example-auth-0.1.0.tgz', 'example-ui-0.1.0.tgz'])
    expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).dependencies).toEqual({
      '@deepseek-ai/dsh': 'file:./packages/dsh.tgz',
      '@example/auth': 'file:./carrier-packages/example-auth-0.1.0.tgz',
      '@example/ui': 'file:./carrier-packages/example-ui-0.1.0.tgz',
    })
  })

  it('leaves the runtime project untouched without carriers', () => {
    const directory = project()
    const before = readFileSync(join(directory, 'package.json'), 'utf8')
    expect(stageDesktopCarrierPackages(directory, [], new Set())).toEqual([])
    expect(readFileSync(join(directory, 'package.json'), 'utf8')).toBe(before)
    expect(readdirSync(directory)).toEqual(['package.json'])
  })

  it.each([
    [{ name: '@example/plain', version: '1.0.0' }, /declares no dsh\.bundle/u],
    [{ name: '@deepseek-ai/dsh', version: '1.0.0', dsh: { bundle: {} } }, /core Desktop package/u],
    [{ version: '1.0.0', dsh: { bundle: {} } }, /lacks name\/version/u],
  ])('rejects carrier manifest %j', (manifest, message) => {
    const root = temporary()
    const tarball = pack(root, 'carrier-1.0.0.tgz', manifest)
    expect(() => stageDesktopCarrierPackages(project(), [tarball], new Set(['@deepseek-ai/dsh']))).toThrow(message)
  })

  it('rejects two tarballs of one package', () => {
    const root = temporary()
    const manifest = { name: '@example/auth', version: '0.1.0', dsh: { bundle: {} } }
    expect(() => stageDesktopCarrierPackages(project(), [pack(root, 'one.tgz', manifest), pack(root, 'two.tgz', manifest)], new Set()))
      .toThrow(/listed twice/u)
  })

  it('requires each carrier at the runtime top level with its packed version', () => {
    const runtime = temporary()
    const carrier = { name: '@example/auth', version: '0.1.0', file: 'example-auth-0.1.0.tgz' }
    expect(() => verifyDesktopCarrierPackages(runtime, [carrier])).toThrow(/not installed/u)
    mkdirSync(join(runtime, 'node_modules', '@example', 'auth'), { recursive: true })
    writeFileSync(join(runtime, 'node_modules', '@example', 'auth', 'package.json'), '{"version":"0.0.9"}')
    expect(() => verifyDesktopCarrierPackages(runtime, [carrier])).toThrow(/expected 0\.1\.0/u)
    writeFileSync(join(runtime, 'node_modules', '@example', 'auth', 'package.json'), '{"version":"0.1.0"}')
    expect(() => verifyDesktopCarrierPackages(runtime, [carrier])).not.toThrow()
  })
})
