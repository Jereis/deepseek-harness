/** Stage the packed bundles a distribution carries into the packaged Desktop runtime. */

import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { capture } from '../../../scripts/release/process.ts'

/**
 * Environment variable listing packed bundle tarballs, separated like PATH, in load order.
 * Each package installs into the runtime with its dependencies and loads as a carrier bundle
 * (`dsh.carrier.bundles` in the runtime package.json), like `DSH_DESKTOP_CARRIER_BUNDLES` in development.
 */
export const DESKTOP_CARRIER_PACKAGES_ENV = 'DSH_DESKTOP_CARRIER_PACKAGES'

/** Runtime project directory, beside the core package set, that holds the carrier tarballs. */
export const DESKTOP_CARRIER_PACKAGES_DIR = 'carrier-packages'

/** One staged carrier tarball. */
export interface DesktopCarrierPackage {
  /** Package name from the packed manifest. */
  readonly name: string
  /** Package version from the packed manifest. */
  readonly version: string
  /** Tarball filename inside {@link DESKTOP_CARRIER_PACKAGES_DIR}. */
  readonly file: string
}

/**
 * Read the carrier tarball list.
 * @param env - Packaging environment.
 * @returns Absolute tarball paths in load order; empty when the variable is unset.
 * @throws {Error} When an entry is not an existing `.tgz` file or appears twice.
 */
export function resolveDesktopCarrierPackages(env: NodeJS.ProcessEnv): string[] {
  const paths = (env[DESKTOP_CARRIER_PACKAGES_ENV] ?? '').split(delimiter).map(path => path.trim()).filter(path => path !== '')
    .map(path => resolve(path))
  for (const path of paths) {
    if (!path.endsWith('.tgz')) throw new Error(`desktop carrier: ${path} is not a packed .tgz package`)
    if (statSync(path, { throwIfNoEntry: false })?.isFile() !== true) throw new Error(`desktop carrier: ${DESKTOP_CARRIER_PACKAGES_ENV} names ${path}, which is not a file`)
  }
  if (new Set(paths.map(path => basename(path))).size !== paths.length) {
    throw new Error(`desktop carrier: ${DESKTOP_CARRIER_PACKAGES_ENV} names one tarball filename twice`)
  }
  return paths
}

function packedManifest(tarball: string): Record<string, unknown> {
  // GNU tar reads the colon in a Windows drive path as a remote-host separator, so tar runs beside the tarball.
  const manifest: unknown = JSON.parse(capture('tar', ['-xOzf', basename(tarball), 'package/package.json'], { cwd: dirname(tarball) }))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`desktop carrier: ${tarball} has no package manifest`)
  }
  return manifest as Record<string, unknown>
}

/**
 * Copy carrier tarballs into the runtime project and add them as its dependencies.
 *
 * The runtime project installs with pnpm's hoisted linker and core-package overrides, so each
 * carrier lands at `node_modules/<name>`, its own dependencies install beside it, and its
 * `@deepseek-ai/*` peers resolve to the core packages instead of registry copies.
 * @param projectDir - Runtime project directory whose package.json lists the core packages.
 * @param tarballs - Tarballs from {@link resolveDesktopCarrierPackages}.
 * @param coreNames - Core package names a carrier must not replace.
 * @returns The staged carriers in load order.
 * @throws {Error} When a tarball is not a dsh bundle, repeats a package, or names a core package.
 */
export function stageDesktopCarrierPackages(
  projectDir: string,
  tarballs: readonly string[],
  coreNames: ReadonlySet<string>,
): DesktopCarrierPackage[] {
  if (tarballs.length === 0) return []
  const directory = join(projectDir, DESKTOP_CARRIER_PACKAGES_DIR)
  mkdirSync(directory, { recursive: true })
  const carriers: DesktopCarrierPackage[] = []
  for (const tarball of tarballs) {
    const manifest = packedManifest(tarball)
    const { name, version } = manifest
    if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') {
      throw new Error(`desktop carrier: ${tarball} manifest lacks name/version`)
    }
    const dsh = manifest.dsh as { bundle?: unknown } | undefined
    if (dsh?.bundle === undefined) throw new Error(`desktop carrier: ${name} declares no dsh.bundle`)
    if (coreNames.has(name)) throw new Error(`desktop carrier: ${name} is a core Desktop package`)
    if (carriers.some(carrier => carrier.name === name)) throw new Error(`desktop carrier: ${name} is listed twice`)
    const file = basename(tarball)
    copyFileSync(tarball, join(directory, file))
    carriers.push({ name, version, file })
  }
  const manifestPath = join(projectDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  manifest.dependencies = {
    ...manifest.dependencies,
    ...Object.fromEntries(carriers.map(carrier => [carrier.name, `file:./${DESKTOP_CARRIER_PACKAGES_DIR}/${carrier.file}`])),
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 })
  return carriers
}

/**
 * Check that every carrier was installed at the runtime's top level, where the Host resolves it.
 * @param runtimeRoot - Materialized runtime directory.
 * @param carriers - Staged carriers.
 * @throws {Error} When a carrier is missing or installed at another version.
 */
export function verifyDesktopCarrierPackages(runtimeRoot: string, carriers: readonly DesktopCarrierPackage[]): void {
  for (const carrier of carriers) {
    let version: unknown
    try {
      version = (JSON.parse(readFileSync(join(runtimeRoot, 'node_modules', carrier.name, 'package.json'), 'utf8')) as { version?: unknown }).version
    } catch (error) {
      throw new Error(`desktop carrier: ${carrier.name} is not installed in the runtime: ${String(error)}`)
    }
    if (version !== carrier.version) {
      throw new Error(`desktop carrier: runtime holds ${carrier.name}@${String(version)}, expected ${carrier.version}`)
    }
  }
}
