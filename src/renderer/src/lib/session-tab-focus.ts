import type { ActiveGuestOptions } from '@shared/types'

interface FocusFrame {
  focus(options?: FocusOptions): void
  blur(): void
  getWebContentsId?: () => number
}

/** One owner performs the old/new DOM handoff before requesting native focus. */
export function syncSessionTabFocus(
  previous: FocusFrame | null,
  frame: FocusFrame | null,
  guestId: number | null,
  visible: boolean,
  report: (id: number | null, options: ActiveGuestOptions) => void,
  allowFocus = true
): FocusFrame | null {
  let id: number | null = null
  try {
    if (guestId !== null && frame?.getWebContentsId?.() === guestId) id = guestId
  } catch {
    /* A cold or replaced guest has not attached to this frame yet. */
  }
  const next = visible && allowFocus && id !== null ? frame : null
  if (previous && previous !== next) previous.blur()
  if (next) next.focus({ preventScroll: true })
  // DOM hasFocus() is false in Electron while a guest receives native input;
  // the main process checks the actual BrowserWindow before granting focus.
  report(id, { visible, focus: next !== null })
  return next
}
