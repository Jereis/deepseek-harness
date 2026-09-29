import type { DesktopBrand } from '../src/brand.ts'
import type { DesktopWelcomeDelegate } from '../src/welcome-delegate.ts'

export declare const DEFAULT_DESKTOP_BRAND: DesktopBrand

export declare function readDesktopBrand(env?: NodeJS.ProcessEnv): {
  brand: DesktopBrand
  icons: { windows?: string; macos?: string }
  shortcutName?: string
  welcome?: DesktopWelcomeDelegate
}
