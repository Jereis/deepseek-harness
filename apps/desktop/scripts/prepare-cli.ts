/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_DESKTOP_BRAND, readDesktopBrand } from './desktop-brand.mjs'

/**
 * Copy the platform launcher into the application's public command directory.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 * @param productName - executable name the launcher runs; defaults to the build's brand (`DSH_DESKTOP_BRAND_FILE`).
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32', productName = readDesktopBrand().brand.productName): void {
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  const launcher = readFileSync(join(import.meta.dirname, '..', 'cli', name), 'utf8')
  writeFileSync(command, launcher.replaceAll(DEFAULT_DESKTOP_BRAND.productName, productName))
  if (platform === 'darwin') chmodSync(command, 0o755)
}
