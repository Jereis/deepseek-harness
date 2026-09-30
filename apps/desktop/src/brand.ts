/** Product identity a distribution can replace at build time without editing Desktop sources. */

/** Names and locations that identify the Desktop product to people and the operating system. */
export interface DesktopBrand {
  /** ASCII product name: executable, Electron userData directory and installer identity. */
  readonly productName: string
  /** Name shown to people, per Desktop locale. */
  readonly displayName: { readonly en: string; readonly zh: string }
  /** URL scheme that reopens the application (`<scheme>://open`). */
  readonly protocolScheme: string
  /** Harness home directory name under the user's home when DSH_HOME is unset. */
  readonly homeDirName: string
  /** Lower-case prefix of release artifact file names. */
  readonly artifactPrefix: string
  /**
   * Version shown to people in place of the application's own, for a distribution
   * that numbers its releases itself. Display only: updates still compare `app.getVersion()`.
   */
  readonly version?: string
  /**
   * Whether the application menu offers the command-line manager to people who
   * installed the product. `false` keeps it to development builds.
   */
  readonly cliCommandMenu?: boolean
}

/** Upstream's identity; `scripts/desktop-brand.mjs` restates it for the build configuration. */
export const DEFAULT_DESKTOP_BRAND: DesktopBrand = Object.freeze({
  productName: 'DeepSeek Harness',
  displayName: Object.freeze({ en: 'DeepSeek Harness', zh: 'DeepSeek Harness' }),
  protocolScheme: 'dsh',
  homeDirName: '.dsh',
  artifactPrefix: 'deepseek-harness',
})

// Replaced at bundle time from DSH_DESKTOP_BRAND_FILE (tsdown.config.ts); absent when sources run directly.
declare const __DSH_DESKTOP_BRAND__: DesktopBrand | undefined

/** The identity this build was made with. */
export const DESKTOP_BRAND: DesktopBrand = typeof __DSH_DESKTOP_BRAND__ === 'undefined'
  ? DEFAULT_DESKTOP_BRAND
  : __DSH_DESKTOP_BRAND__

/**
 * Put the brand's display name wherever a Desktop message names the product.
 * @param messages - one locale dictionary written with the upstream name.
 * @param displayName - the name to show in that locale.
 * @returns the dictionary with every product mention replaced; the input itself when nothing changes.
 */
export function brandMessages<T extends Readonly<Record<string, string>>>(messages: T, displayName: string): T {
  const upstream = DEFAULT_DESKTOP_BRAND.displayName.en
  if (displayName === upstream) return messages
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, value.replaceAll(upstream, displayName)])) as T
}
