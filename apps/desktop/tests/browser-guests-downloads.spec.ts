/** Download policy of Sidebar webview partitions: cancel by default, Save As on request. */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

type DownloadHandler = (event: { preventDefault: () => void }, item: {
  getFilename: () => string
  setSaveDialogOptions: (options: { defaultPath?: string }) => void
}) => void

const sessions = new Map<string, { downloads?: DownloadHandler }>()
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: (name: string) => name === 'downloads' ? '/home/user/Downloads' : '/tmp' },
  session: {
    fromPartition: (partition: string) => {
      const record: { downloads?: DownloadHandler } = {}
      sessions.set(partition, record)
      return {
        setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
        setDisplayMediaRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() },
        on: (name: string, handler: DownloadHandler) => { if (name === 'will-download') record.downloads = handler },
      }
    },
  },
}))
const { DesktopBrowserGuests } = await import('../src/browser-guests.ts')
afterEach(() => { sessions.clear() })

const owner = {} as WebContents
function download(partition: string) {
  const event = { preventDefault: vi.fn() }
  const item = { getFilename: () => 'result.png', setSaveDialogOptions: vi.fn() }
  sessions.get(partition)?.downloads?.(event, item)
  return { event, item }
}

describe('DesktopBrowserGuests downloads', () => {
  it('cancels downloads unless a reservation asks otherwise', () => {
    const guests = new DesktopBrowserGuests(() => undefined)
    const { partition } = guests.acquire(owner, 'cwd:/project')
    const { event, item } = download(partition)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(item.setSaveDialogOptions).not.toHaveBeenCalled()
  })

  it('asks where to save, from the Downloads folder, for a save-dialog partition', () => {
    const guests = new DesktopBrowserGuests(() => undefined)
    const { partition } = guests.acquire(owner, 'langtu-webtools:0', { downloads: 'save-dialog' })
    const { event, item } = download(partition)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(item.setSaveDialogOptions).toHaveBeenCalledWith({ defaultPath: join('/home/user/Downloads', 'result.png') })
  })

  it('keeps the first policy of a workspace and refuses a different one', () => {
    const guests = new DesktopBrowserGuests(() => undefined)
    const first = guests.acquire(owner, 'langtu-webtools:0', { downloads: 'save-dialog' })
    expect(guests.acquire(owner, 'langtu-webtools:0', { downloads: 'save-dialog' }).partition).toBe(first.partition)
    expect(() => guests.acquire(owner, 'langtu-webtools:0')).toThrow(/download policy/)
    guests.acquire(owner, 'cwd:/project', { downloads: 'cancel' })
    expect(() => guests.acquire(owner, 'cwd:/project', { downloads: 'save-dialog' })).toThrow(/download policy/)
  })

  it('refuses malformed options from IPC', () => {
    const guests = new DesktopBrowserGuests(() => undefined)
    expect(() => guests.acquire(owner, 'a', 'save-dialog')).toThrow(/invalid guest options/)
    expect(() => guests.acquire(owner, 'b', { downloads: 'always' })).toThrow(/unknown download policy/)
    expect(guests.acquire(owner, 'c', null).partition).toMatch(/^dsh-sidebar-browser-/)
  })
})
