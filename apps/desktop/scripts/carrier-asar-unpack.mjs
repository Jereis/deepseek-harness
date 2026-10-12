/** ASAR unpack patterns that carrier bundles declare for files other processes open. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Collect each carrier bundle's `dsh.desktop.asarUnpack` globs as patterns over the prepared dsh directory.
 * A child process such as a Python interpreter cannot read inside `app.asar`, so a bundle that hands
 * its own files to one lists them here and resolves them under `app.asar.unpacked` at run time.
 * @param {string} dshDir - Prepared dsh directory whose `package.json` lists `dsh.carrier.bundles`.
 * @returns {Promise<string[]>} electron-builder `asarUnpack` patterns; rejects a malformed declaration.
 */
export async function carrierAsarUnpackPatterns(dshDir) {
  const project = JSON.parse(await readFile(join(dshDir, 'package.json'), 'utf8'))
  const bundles = project.dsh?.carrier?.bundles ?? []
  const patterns = []
  for (const name of bundles) {
    const manifest = JSON.parse(await readFile(join(dshDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
    const globs = manifest.dsh?.desktop?.asarUnpack ?? []
    if (!Array.isArray(globs) || globs.some(glob => typeof glob !== 'string' || glob === '' || glob.startsWith('/') || glob.includes('..'))) {
      throw new Error(`desktop carrier: ${name} dsh.desktop.asarUnpack must list package-relative globs`)
    }
    patterns.push(...globs.map(glob => `**/node_modules/${name}/${glob}`))
  }
  return patterns
}
