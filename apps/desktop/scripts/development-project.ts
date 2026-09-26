/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'
import { DESKTOP_RUNTIME_FILE, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'
import { desktopTargetPlatform } from './desktop-build-paths.mjs'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
  /** Build target whose prepared payload the disposable project runs against. */
  readonly target: DesktopAutoUpdateTarget
  /**
   * Built bundle package directories the project carries and always loads, in load
   * order (`DSH_DESKTOP_CARRIER_BUNDLES`). Each is copied the way a packed tarball
   * would hold it, so it resolves its peers from this runtime and never from its
   * own development dependencies.
   */
  readonly carrierBundles?: readonly string[]
}

interface CarrierManifest extends PackageManifest {
  readonly files?: readonly string[]
  readonly dsh?: { readonly bundle?: { readonly patch?: string | readonly string[] } }
}

/**
 * Copy one built bundle package's publishable files into the project.
 * @param source - The package directory.
 * @param destinationModules - The project's node_modules.
 * @returns The package name.
 */
function copyCarrierBundle(source: string, destinationModules: string): string {
  const manifest = readManifest(join(source, 'package.json')) as CarrierManifest
  if (typeof manifest.name !== 'string' || manifest.dsh?.bundle === undefined) {
    throw new Error(`desktop development: carrier bundle ${source} must name a package declaring dsh.bundle`)
  }
  const destination = join(destinationModules, manifest.name)
  removeOwnedPath(destination)
  mkdirSync(destination, { recursive: true })
  const patches = [manifest.dsh.bundle.patch ?? []].flat().map(path => path.replace(/^\.\//u, ''))
  const shipped = new Set(['package.json', ...patches, ...(manifest.files ?? []).map(pattern => pattern.split('/')[0]!)])
  for (const entry of shipped) {
    if (existsSync(join(source, entry))) cpSync(join(source, entry), join(destination, entry), { recursive: true, dereference: true })
  }
  return manifest.name
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function mirrorDependencyLinks(sourceRoot: string, destinationRoot: string): string[] {
  const names: string[] = []
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      mkdirSync(join(destinationRoot, entry.name), { recursive: true })
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        linkDirectory(join(source, scoped.name), join(destinationRoot, entry.name, scoped.name))
        names.push(`${entry.name}/${scoped.name}`)
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      linkDirectory(source, join(destinationRoot, entry.name))
      names.push(entry.name)
    }
  }
  return names
}

/** Configured workspace plugins must resolve from the profile even when pnpm does not hoist them. */
function mirrorWorkspaceDependencies(roots: readonly string[], destinationRoot: string): string[] {
  const names: string[] = []
  const visited = new Set<string>()
  const visit = (directory: string): void => {
    const source = realpathSync(directory)
    if (visited.has(source)) return
    visited.add(source)
    const manifest = readManifest(join(source, 'package.json'))
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      if (!specifier.startsWith('workspace:')) continue
      const dependency = join(source, 'node_modules', ...name.split('/'))
      if (!existsSync(dependency)) {
        throw new Error(`desktop development: ${name} is missing from ${source}; run pnpm install`)
      }
      const destination = join(destinationRoot, ...name.split('/'))
      removeOwnedPath(destination)
      linkDirectory(dependency, destination)
      names.push(name)
      visit(dependency)
    }
  }
  for (const directory of roots) visit(directory)
  return names
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, release identity, and build target.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== '@deepseek-ai/dsh' || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be @deepseek-ai/dsh@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== '@deepseek-ai/dsh-desktop-host' || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be @deepseek-ai/dsh-desktop-host@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  const names = [
    ...mirrorDependencyLinks(options.dependencyDir, destinationModules),
    ...mirrorWorkspaceDependencies([options.cliDir, options.hostDir], destinationModules),
  ]
  const dshLink = join(destinationModules, '@deepseek-ai', 'dsh')
  removeOwnedPath(dshLink)
  linkDirectory(options.cliDir, dshLink)
  const hostLink = join(destinationModules, '@deepseek-ai', 'dsh-desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  const sharedPackages = [...new Set([...names, '@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'])].flatMap((name) => {
    const manifest = readManifest(join(destinationModules, name, 'package.json'))
    return typeof manifest.version === 'string' ? [{ name, version: manifest.version, path: `node_modules/${name}` }] : []
  })
  const carriers = (options.carrierBundles ?? []).map(source => copyCarrierBundle(source, destinationModules))
  if (carriers.length > 0) {
    const projectManifest = JSON.parse(readFileSync(join(options.projectDir, 'package.json'), 'utf8')) as Record<string, unknown> & { dsh?: Record<string, unknown> }
    projectManifest.dsh = { ...projectManifest.dsh, carrier: { bundles: carriers } }
    writeFileSync(join(options.projectDir, 'package.json'), `${JSON.stringify(projectManifest, undefined, 2)}\n`, { mode: 0o600 })
  }
  const runtime: DesktopRuntimeDescriptor = { schemaVersion: 1, release: options.release,
    ...desktopTargetPlatform(options.target), sharedPackages, files: [] }
  writeFileSync(join(options.projectDir, DESKTOP_RUNTIME_FILE), `${JSON.stringify(runtime, undefined, 2)}\n`)
  return options.projectDir
}
