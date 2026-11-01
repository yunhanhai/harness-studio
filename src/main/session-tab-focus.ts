import type { BrowserWindow, WebContents } from 'electron'
import type { ActiveGuestOptions } from '@shared/types'

/** Native guest focus is distinct from the renderer's webview DOM focus. */
export class SessionTabFocus {
  private pendingGuestId: number | null = null
  private focusedGuest: WebContents | null = null

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly activeGuest: () => WebContents | null
  ) {}

  update(options?: unknown): void {
    const guest = this.activeGuest()
    if (this.pendingGuestId !== guest?.id) this.pendingGuestId = null
    // Plugin navigation only reports the active identity; it never requests focus.
    if (options === undefined) return
    const request = options as Partial<ActiveGuestOptions> | null
    if (request?.visible !== true || request?.focus !== true || !guest) {
      this.pendingGuestId = null
      if (request?.visible === false || !guest) this.release()
      return
    }
    this.pendingGuestId = guest.id
    this.restore()
  }

  /** Re-read the active guest when the user brings the main window forward. */
  restore(): void {
    const guest = this.activeGuest()
    if (!guest || guest.isDestroyed() || guest.id !== this.pendingGuestId) {
      this.pendingGuestId = null
      return
    }
    const window = this.focusedWindow()
    if (!window) return
    this.pendingGuestId = null
    try {
      guest.focus()
      this.focusedGuest = guest
    } catch {
      /* The guest can disappear as its tab closes. */
    }
  }

  forget(id: number): void {
    if (this.pendingGuestId === id) this.pendingGuestId = null
    if (this.focusedGuest?.id === id) this.focusedGuest = null
  }

  private focusedWindow(): BrowserWindow | null {
    const window = this.window()
    return window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
      && window.isFocused() && window.isEnabled() ? window : null
  }

  private release(): void {
    const guest = this.focusedGuest
    this.focusedGuest = null
    const window = this.focusedWindow()
    // Transfer native input back to the shell only if this guest still owns it.
    // A Home/Settings input that already has focus is left alone.
    if (!window || !guest || guest.isDestroyed() || !guest.isFocused()) return
    window.webContents.focus()
  }
}
