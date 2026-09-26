import type { DesktopBrand } from '../src/brand.ts'

export declare const DEFAULT_DESKTOP_BRAND: DesktopBrand

export declare function readDesktopBrand(env?: NodeJS.ProcessEnv): {
  brand: DesktopBrand
  icons: { windows?: string; macos?: string }
  shortcutName?: string
}
