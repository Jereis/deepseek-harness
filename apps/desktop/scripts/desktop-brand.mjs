/** Read a distribution's product identity for the build (tsdown define, electron-builder). */

import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { valid } from 'semver'

/** Upstream's identity; the same values as `DEFAULT_DESKTOP_BRAND` in `src/brand.ts`. */
export const DEFAULT_DESKTOP_BRAND = Object.freeze({
  productName: 'DeepSeek Harness',
  displayName: Object.freeze({ en: 'DeepSeek Harness', zh: 'DeepSeek Harness' }),
  protocolScheme: 'dsh',
  homeDirName: '.dsh',
  artifactPrefix: 'deepseek-harness',
})

/** Application-origin path of a delegated welcome page: absolute, no segment starting with a dot, no query. */
const WELCOME_PAGE = /^\/(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/?)*$/u
/** Host `/api` RPC method of a delegated welcome gate, in Connection's `segment/segment` grammar. */
const WELCOME_GATE = /^[A-Za-z0-9_$.-]+(?:\/[A-Za-z0-9_$.-]+)+$/u

const PATTERNS = {
  productName: /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u,
  protocolScheme: /^[a-z][a-z0-9+.-]{1,31}$/u,
  homeDirName: /^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u,
  artifactPrefix: /^[a-z0-9][a-z0-9._-]{0,63}$/u,
}

/**
 * The brand this build uses: DSH_DESKTOP_BRAND_FILE when set, upstream's otherwise.
 * The file is JSON with every `DesktopBrand` field, plus optional `icons.windows` /
 * `icons.macos` (PNG paths relative to the file), `shortcutName`, and `welcome`
 * (`page`: application-origin path the welcome window loads; `gate`: Host `/api` RPC
 * method answering whether the welcome entry is required; see `src/welcome-delegate.ts`),
 * and `cliCommandMenu` (`false` keeps the command-line manager out of installed builds' menu).
 * DSH_DESKTOP_DISPLAY_VERSION, a semantic version, becomes the brand's displayed `version`.
 * @param {NodeJS.ProcessEnv} env - build environment.
 * @returns {{ brand: import('../src/brand.ts').DesktopBrand, icons: { windows?: string, macos?: string }, shortcutName?: string, welcome?: import('../src/welcome-delegate.ts').DesktopWelcomeDelegate }}
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
  let welcome
  if (value.welcome !== undefined) {
    const { page, gate } = value.welcome ?? {}
    if (typeof page !== 'string' || !WELCOME_PAGE.test(page)) throw fail(`welcome.page must be an absolute application path matching ${WELCOME_PAGE}`)
    if (typeof gate !== 'string' || !WELCOME_GATE.test(gate)) throw fail(`welcome.gate must be an /api RPC method matching ${WELCOME_GATE}`)
    welcome = Object.freeze({ page, gate })
  }
  if (value.cliCommandMenu !== undefined && typeof value.cliCommandMenu !== 'boolean') throw fail('cliCommandMenu must be a boolean')
  const version = env.DSH_DESKTOP_DISPLAY_VERSION?.trim()
  if (version && valid(version) === null) throw new Error('desktop brand: DSH_DESKTOP_DISPLAY_VERSION must be a semantic version')
  const brand = Object.freeze({
    productName: value.productName,
    displayName: Object.freeze({ en: value.displayName.en, zh: value.displayName.zh }),
    protocolScheme: value.protocolScheme,
    homeDirName: value.homeDirName,
    artifactPrefix: value.artifactPrefix,
    ...(version ? { version } : {}),
    ...(value.cliCommandMenu === undefined ? {} : { cliCommandMenu: value.cliCommandMenu }),
  })
  return {
    brand,
    icons,
    ...(value.shortcutName === undefined ? {} : { shortcutName: value.shortcutName }),
    ...(welcome === undefined ? {} : { welcome }),
  }
}
