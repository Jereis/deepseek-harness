/** Type-only Electron bridge declarations shared by the desktop shell and browser provider. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Main-issued identity of one guest reservation. */
export type DesktopBrowserLeaseId = Branded<'DesktopBrowserLeaseId'>

/** A guest's approved, process-local storage partition. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** What a guest's partition does with a download the page starts. */
export type DesktopBrowserDownloadPolicy = 'cancel' | 'save-dialog'

/** Optional partition policy, fixed by the first reservation of a workspace. */
export interface DesktopBrowserAcquireOptions {
  /**
   * `cancel` (default) drops every download; `save-dialog` asks where to save
   * it, starting in the system Downloads folder. A later reservation of the
   * same workspace must ask for the same policy.
   */
  readonly downloads?: DesktopBrowserDownloadPolicy
}

/** Origin-scoped operations; no Electron objects or arbitrary IPC cross this interface. */
export interface DesktopBrowserBridge {
  /**
   * @param workspace - resolved storage account.
   * @param options - partition policy; omitted means downloads are cancelled.
   * @returns one approved guest reservation.
   */
  acquire(workspace: string, options?: DesktopBrowserAcquireOptions): Promise<DesktopBrowserReservation>
  /** @param lease - the caller's reservation. @returns after its guest has been destroyed. */
  release(lease: DesktopBrowserLeaseId): Promise<void>
  /** @param lease - originating guest. @param listener - approved URL consumer. @returns unsubscribe callback. */
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
}
