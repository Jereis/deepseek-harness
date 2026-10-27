import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandMessages, DEFAULT_DESKTOP_BRAND, DESKTOP_BRAND } from '../src/brand.ts'
import { en, zh } from '../src/locale.ts'
import { DEFAULT_DESKTOP_BRAND as BUILD_DEFAULT, developmentIconEnvironment, INSTALLER_ASSETS, readDesktopBrand } from '../scripts/desktop-brand.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const LANGTU = {
  productName: 'LangtuAssistant',
  displayName: { en: 'Langtu Assistant', zh: '廊图网小助手' },
  protocolScheme: 'langtu',
  homeDirName: '.langtu',
  artifactPrefix: 'langtu-assistant',
}

function brandFile(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-brand-'))
  roots.push(root)
  const path = join(root, 'brand.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

function packageConfig(brand: unknown) {
  return createElectronBuilderConfig({
    DSH_DESKTOP_BRAND_FILE: brandFile(brand),
    DSH_DESKTOP_APP_ID: 'cn.hxltw.langtu.assistant',
    DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
    DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
    DSH_DESKTOP_TARGET_PLATFORM: 'win32',
    DSH_DESKTOP_TARGET_ARCH: 'x64',
    DSH_DESKTOP_UNSIGNED: '1',
  }, 'win32', 'x64')
}

describe('desktop brand', () => {
  it('keeps upstream identity when no brand is compiled in, and the build default in step with it', () => {
    expect(DESKTOP_BRAND).toEqual(DEFAULT_DESKTOP_BRAND)
    expect(BUILD_DEFAULT).toEqual(DEFAULT_DESKTOP_BRAND)
    expect(readDesktopBrand({}).brand).toEqual(DEFAULT_DESKTOP_BRAND)
  })

  it('renames every product mention in both dictionaries and nothing else', () => {
    const branded = brandMessages(zh, '廊图网小助手')
    expect(branded.quitApplication).toBe('退出 廊图网小助手')
    expect(branded.quitTitle).toBe('退出 廊图网小助手？')
    expect(Object.values(branded).join('\n')).not.toContain('DeepSeek Harness')
    expect(branded.application).toBe(zh.application)
    expect(brandMessages(en, DEFAULT_DESKTOP_BRAND.displayName.en)).toBe(en)
  })

  it('reads a brand file and resolves its icons beside it', () => {
    const file = brandFile({ ...LANGTU, icons: { windows: 'icons/app.png' }, shortcutName: '廊图网小助手' })
    const read = readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file })
    expect(read.brand).toEqual(LANGTU)
    expect(read.icons).toEqual({ windows: join(file, '..', 'icons', 'app.png') })
    expect(read.shortcutName).toBe('廊图网小助手')
  })

  it('reads a tray icon and an installer artwork directory beside the brand file, and neither by default', () => {
    const file = brandFile({ ...LANGTU, icons: { windowsTray: 'icons/tray.ico' }, installerAssets: 'installer' })
    mkdirSync(join(file, '..', 'installer'))
    for (const asset of INSTALLER_ASSETS) writeFileSync(join(file, '..', 'installer', `${asset}.png`), '')
    const read = readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file })
    expect(read.icons).toEqual({ windowsTray: join(file, '..', 'icons', 'tray.ico') })
    expect(read.installerAssets).toBe(join(file, '..', 'installer'))
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile(LANGTU) })).not.toHaveProperty('installerAssets')
  })

  it('points unpackaged runs at the brand Windows icons, and at nothing without a brand', () => {
    const file = brandFile({ ...LANGTU, icons: { windows: 'icons/app.png', windowsTray: 'icons/tray.ico', macos: 'icons/mac.png' } })
    expect(developmentIconEnvironment({ DSH_DESKTOP_BRAND_FILE: file })).toEqual({
      DSH_DESKTOP_DEV_ICON: join(file, '..', 'icons', 'app.png'),
      DSH_DESKTOP_DEV_TRAY_ICON: join(file, '..', 'icons', 'tray.ico'),
    })
    expect(developmentIconEnvironment({})).toEqual({})
  })

  it('rejects an installer artwork directory missing any converted asset', () => {
    const file = brandFile({ ...LANGTU, installerAssets: 'installer' })
    mkdirSync(join(file, '..', 'installer'))
    writeFileSync(join(file, '..', 'installer', 'brand.png'), '')
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file }))
      .toThrow('installerAssets lacks brand-2x.png, brand-dark.png, brand-dark-2x.png, uninstaller-sidebar.png')
  })

  it('reads the optional menu and displayed-version members, and neither by default', () => {
    const file = brandFile({ ...LANGTU, cliCommandMenu: false })
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file }).brand).toEqual({ ...LANGTU, cliCommandMenu: false })
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file, DSH_DESKTOP_DISPLAY_VERSION: ' 1.0.0 ' }).brand)
      .toEqual({ ...LANGTU, cliCommandMenu: false, version: '1.0.0' })
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile(LANGTU) }).brand).toEqual(LANGTU)
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: file, DSH_DESKTOP_DISPLAY_VERSION: 'V1.0.0' })).toThrow('DSH_DESKTOP_DISPLAY_VERSION')
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, cliCommandMenu: 'no' }) })).toThrow('cliCommandMenu')
  })

  it('reads an optional userData directory, and none by default', () => {
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, userDataDir: 'LangtuAssistant/desktop' }) }).brand)
      .toEqual({ ...LANGTU, userDataDir: 'LangtuAssistant/desktop' })
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, userDataDir: 'Langtu Assistant' }) }).brand.userDataDir).toBe('Langtu Assistant')
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile(LANGTU) }).brand).not.toHaveProperty('userDataDir')
  })

  it.each(['', '../escape', 'a/../b', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'a/', 'a/b/c/d/e', 'a "b"', '$APPDATA', 'trailing.', 'trailing /b', 7])(
    'rejects the userData directory %j', (userDataDir) => {
      expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, userDataDir }) })).toThrow('userDataDir')
    })

  it('reads an optional welcome delegate, and none without the member', () => {
    const welcome = { page: '/api/example/welcome', gate: 'example/welcome-gate' }
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, welcome }) }).welcome).toEqual(welcome)
    expect(readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile(LANGTU) })).not.toHaveProperty('welcome')
    expect(readDesktopBrand({})).not.toHaveProperty('welcome')
  })

  it.each([
    ['a welcome page outside the application origin', { welcome: { page: 'https://example.com/welcome', gate: 'example/gate' } }, 'welcome.page'],
    ['a welcome page with a dot segment', { welcome: { page: '/api/../welcome', gate: 'example/gate' } }, 'welcome.page'],
    ['a welcome page with a query', { welcome: { page: '/welcome?next=/', gate: 'example/gate' } }, 'welcome.page'],
    ['a welcome gate without a namespace', { welcome: { page: '/welcome', gate: 'gate' } }, 'welcome.gate'],
    ['a welcome member that is not an object', { welcome: true }, 'welcome.page'],
  ])('rejects %s', (_label, override, field) => {
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, ...override }) })).toThrow(field)
  })

  it.each([
    ['a non-ASCII product name, which would name the executable and userData', { productName: '廊图网小助手' }, 'productName'],
    ['a scheme with a colon', { protocolScheme: 'langtu:' }, 'protocolScheme'],
    ['a home directory that is a path', { homeDirName: '../escape' }, 'homeDirName'],
    ['an empty display name', { displayName: { en: 'Langtu', zh: ' ' } }, 'displayName.zh'],
    ['a non-PNG icon', { icons: { windows: 'app.ico' } }, 'icons.windows'],
    ['a non-ICO tray icon', { icons: { windowsTray: 'tray.png' } }, 'icons.windowsTray'],
    ['an empty installer artwork directory path', { installerAssets: ' ' }, 'installerAssets'],
  ])('rejects %s', (_label, override, field) => {
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, ...override }) })).toThrow(field)
  })

  it('names the package, protocol, artifacts and shortcut from the brand', () => {
    const config = packageConfig({ ...LANGTU, shortcutName: '廊图网小助手' })
    expect(config.productName).toBe('LangtuAssistant')
    expect(config.protocols).toEqual([{ name: 'Langtu Assistant', schemes: ['langtu'] }])
    expect(config.artifactName.startsWith('langtu-assistant-')).toBe(true)
    expect(config.nsis.shortcutName).toBe('廊图网小助手')
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopUserDataDir')
  })

  it('packages the brand tray icon, and the upstream one without it', () => {
    const tray = (brand: object) => packageConfig({ ...LANGTU, ...brand }).extraResources[2]?.from
    expect(tray({ icons: { windowsTray: '/brand/tray.ico' } })).toBe('/brand/tray.ico')
    expect(tray({})).toMatch(/resources[\\/]tray-windows\.ico$/u)
  })

  it('names the packaged manifest from the brand, and keeps the upstream name without it', () => {
    expect(packageConfig({ ...LANGTU, packageName: 'langtu-assistant' }).extraMetadata.name).toBe('langtu-assistant')
    expect(packageConfig(LANGTU).extraMetadata).not.toHaveProperty('name')
  })

  it.each(['@langtu/assistant', 'Langtu', ' ', 7])('rejects the package name %j', (packageName) => {
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, packageName }) })).toThrow('packageName')
  })

  it('hands the brand display names to the installer through the packaged manifest', () => {
    expect(packageConfig(LANGTU).extraMetadata.dshDesktopDisplayName).toEqual(LANGTU.displayName)
  })

  it('hands the brand userData directory to the uninstaller through the packaged manifest', () => {
    expect(packageConfig({ ...LANGTU, userDataDir: 'LangtuAssistant/desktop' }).extraMetadata.dshDesktopUserDataDir)
      .toBe('LangtuAssistant/desktop')
  })
})
