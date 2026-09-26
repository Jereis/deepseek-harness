/** Read a distribution's product identity for the build (tsdown define, electron-builder). */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

/** Upstream's identity; the same values as `DEFAULT_DESKTOP_BRAND` in `src/brand.ts`. */
export const DEFAULT_DESKTOP_BRAND = Object.freeze({
  productName: 'DeepSeek Harness',
  displayName: Object.freeze({ en: 'DeepSeek Harness', zh: 'DeepSeek Harness' }),
  protocolScheme: 'dsh',
  homeDirName: '.dsh',
  artifactPrefix: 'deepseek-harness',
})

const PATTERNS = {
  productName: /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u,
  protocolScheme: /^[a-z][a-z0-9+.-]{1,31}$/u,
  homeDirName: /^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u,
  artifactPrefix: /^[a-z0-9][a-z0-9._-]{0,63}$/u,
}

/**
 * The brand this build uses: DSH_DESKTOP_BRAND_FILE when set, upstream's otherwise.
 * The file is JSON with every `DesktopBrand` field, plus optional `icons.windows` /
 * `icons.macos` (PNG paths relative to the file) and `shortcutName`.
 * @param {NodeJS.ProcessEnv} env - build environment.
 * @returns {{ brand: import('../src/brand.ts').DesktopBrand, icons: { windows?: string, macos?: string }, shortcutName?: string }}
 */
export function readDesktopBrand(env = process.env) {
  const file = env.DSH_DESKTOP_BRAND_FILE?.trim()
  if (!file) return { brand: DEFAULT_DESKTOP_BRAND, icons: {} }
  const path = resolve(file)
  const value = JSON.parse(readFileSync(path, 'utf8'))
  const fail = reason => new Error(`desktop brand: ${path}: ${reason}`)
  for (const [field, pattern] of Object.entries(PATTERNS)) {
    if (typeof value?.[field] !== 'string' || !pattern.test(value[field])) throw fail(`${field} must match ${pattern}`)
  }
  for (const locale of ['en', 'zh']) {
    if (typeof value.displayName?.[locale] !== 'string' || value.displayName[locale].trim() === '') {
      throw fail(`displayName.${locale} must be a non-empty string`)
    }
  }
  if (value.shortcutName !== undefined && (typeof value.shortcutName !== 'string' || value.shortcutName.trim() === '')) {
    throw fail('shortcutName must be a non-empty string')
  }
  const icons = {}
  for (const platform of ['windows', 'macos']) {
    const icon = value.icons?.[platform]
    if (icon === undefined) continue
    if (typeof icon !== 'string' || !icon.endsWith('.png')) throw fail(`icons.${platform} must be a PNG path`)
    icons[platform] = isAbsolute(icon) ? icon : resolve(dirname(path), icon)
  }
  const brand = Object.freeze({
    productName: value.productName,
    displayName: Object.freeze({ en: value.displayName.en, zh: value.displayName.zh }),
    protocolScheme: value.protocolScheme,
    homeDirName: value.homeDirName,
    artifactPrefix: value.artifactPrefix,
  })
  return { brand, icons, ...(value.shortcutName === undefined ? {} : { shortcutName: value.shortcutName }) }
}
