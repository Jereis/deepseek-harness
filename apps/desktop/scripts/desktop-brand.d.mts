import type { DesktopBrand } from '../src/brand.ts'
import type { DesktopWelcomeDelegate } from '../src/welcome-delegate.ts'

export declare const DEFAULT_DESKTOP_BRAND: DesktopBrand

export declare const INSTALLER_ASSETS: readonly ['brand', 'brand-2x', 'brand-dark', 'brand-dark-2x', 'uninstaller-sidebar']

export declare function readDesktopBrand(env?: NodeJS.ProcessEnv): {
  brand: DesktopBrand
  icons: { windows?: string; macos?: string; windowsTray?: string }
  installerAssets?: string
  shortcutName?: string
  welcome?: DesktopWelcomeDelegate
}

export declare function developmentIconEnvironment(env?: NodeJS.ProcessEnv): {
  DSH_DESKTOP_DEV_ICON?: string
  DSH_DESKTOP_DEV_TRAY_ICON?: string
}
