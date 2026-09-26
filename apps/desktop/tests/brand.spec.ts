import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brandMessages, DEFAULT_DESKTOP_BRAND, DESKTOP_BRAND } from '../src/brand.ts'
import { en, zh } from '../src/locale.ts'
import { DEFAULT_DESKTOP_BRAND as BUILD_DEFAULT, readDesktopBrand } from '../scripts/desktop-brand.mjs'
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

describe('desktop brand', () => {
  it('keeps upstream identity when no brand is compiled in, and the build default in step with it', () => {
    expect(DESKTOP_BRAND).toEqual(DEFAULT_DESKTOP_BRAND)
    expect(BUILD_DEFAULT).toEqual(DEFAULT_DESKTOP_BRAND)
    expect(readDesktopBrand({}).brand).toEqual(DEFAULT_DESKTOP_BRAND)
  })

  it('renames every product mention in both dictionaries and nothing else', () => {
    const branded = brandMessages(zh, '廊图网小助手')
    expect(branded.quitApplication).toBe('退出 廊图网小助手')
    expect(branded.updateDetail).toBe('廊图网小助手 {version}\n\n廊图网小助手 将重启以完成更新。')
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

  it.each([
    ['a non-ASCII product name, which would name the executable and userData', { productName: '廊图网小助手' }, 'productName'],
    ['a scheme with a colon', { protocolScheme: 'langtu:' }, 'protocolScheme'],
    ['a home directory that is a path', { homeDirName: '../escape' }, 'homeDirName'],
    ['an empty display name', { displayName: { en: 'Langtu', zh: ' ' } }, 'displayName.zh'],
    ['a non-PNG icon', { icons: { windows: 'app.ico' } }, 'icons.windows'],
  ])('rejects %s', (_label, override, field) => {
    expect(() => readDesktopBrand({ DSH_DESKTOP_BRAND_FILE: brandFile({ ...LANGTU, ...override }) })).toThrow(field)
  })

  it('names the package, protocol, artifacts and shortcut from the brand', () => {
    const file = brandFile({ ...LANGTU, shortcutName: '廊图网小助手' })
    const config = createElectronBuilderConfig({
      DSH_DESKTOP_BRAND_FILE: file,
      DSH_DESKTOP_APP_ID: 'cn.hxltw.langtu.assistant',
      DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
      DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      DSH_DESKTOP_UNSIGNED: '1',
    }, 'win32', 'x64') as unknown as {
      productName: string, protocols: { name: string, schemes: string[] }[], artifactName: string, nsis: { shortcutName?: string }
    }
    expect(config.productName).toBe('LangtuAssistant')
    expect(config.protocols).toEqual([{ name: 'Langtu Assistant', schemes: ['langtu'] }])
    expect(config.artifactName.startsWith('langtu-assistant-')).toBe(true)
    expect(config.nsis.shortcutName).toBe('廊图网小助手')
  })
})
