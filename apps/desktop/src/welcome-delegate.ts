/** A distribution's replacement for the native welcome page and its startup decision. */

/**
 * Welcome entry supplied by a distribution through the brand file's `welcome` member
 * (`scripts/desktop-brand.mjs`). Absent, the welcome window renders the built-in page and
 * `needsWelcome` decides from the account and API-key facts.
 */
export interface DesktopWelcomeDelegate {
  /**
   * Application-origin path the welcome window loads instead of the built-in page, such as
   * `/api/example/welcome`. The protocol handler forwards it to the Host with the Web
   * authentication cookie, so the page reaches the Host `/api` routes same-origin.
   */
  readonly page: string
  /** Host `/api` RPC method (`segment/segment`) whose value is `{ needsWelcome: boolean }`. */
  readonly gate: string
}

// Replaced at bundle time from DSH_DESKTOP_BRAND_FILE (tsdown.config.ts); absent when sources run directly.
declare const __DSH_DESKTOP_WELCOME__: DesktopWelcomeDelegate | null | undefined

/** The delegate this build was made with, or undefined for the built-in welcome entry. */
export const DESKTOP_WELCOME_DELEGATE: DesktopWelcomeDelegate | undefined =
  typeof __DSH_DESKTOP_WELCOME__ === 'undefined' || __DSH_DESKTOP_WELCOME__ === null ? undefined : __DSH_DESKTOP_WELCOME__
