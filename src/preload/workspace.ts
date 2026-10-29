import { ipcRenderer } from 'electron'
import type { GuestNotice, TabCommand } from '@shared/types'

/**
 * Channel names are duplicated here on purpose: this preload runs with
 * `sandbox: true`, where `require` only resolves Electron's own modules. Any
 * import from `@shared/*` makes Rollup emit a shared chunk that the sandboxed
 * preload cannot load, which silently kills the whole preload. `channels.ts`
 * remains the source of truth; the main process asserts the values below.
 */
const GUEST_NOTICE_CHANNEL = 'guest:notice'
const GUEST_THEME_CHANNEL = 'guest:theme'
const GUEST_CONFIRM_CHANNEL = 'guest:confirm-send'
const GUEST_SHORTCUT_CHANNEL = 'guest:shortcut'

interface ComposerGuard {
  confirmSend: boolean
  confirmQueued: boolean
}

let guard: ComposerGuard = { confirmSend: false, confirmQueued: true }

interface ThemePayload {
  theme: 'system' | 'light' | 'dark'
  accent: string
  reduceMotion: boolean
}

function resolvedTheme(theme: ThemePayload['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

let styleElement: HTMLStyleElement | null = null

function apply(payload: ThemePayload): void {
  const theme = resolvedTheme(payload.theme)
  const root = document.documentElement
  root.style.colorScheme = theme
  root.dataset.hsTheme = theme
  root.style.setProperty('--hs-accent', payload.accent)
  root.dataset.hsMotion = payload.reduceMotion ? 'reduce' : 'full'

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.dataset.hsInjected = 'theme'
    styleElement.textContent = `
      :root { --hs-accent: ${payload.accent}; }
      ::selection { background: color-mix(in srgb, var(--hs-accent) 38%, transparent); }
      * { scrollbar-color: color-mix(in srgb, currentColor 22%, transparent) transparent; }
      *::-webkit-scrollbar { width: 10px; height: 10px; }
      *::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, currentColor 18%, transparent);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, currentColor 30%, transparent);
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-track { background: transparent; }
      html[data-hs-motion="reduce"] *, html[data-hs-motion="reduce"] *::before, html[data-hs-motion="reduce"] *::after {
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
      }
      /* The official transient toast is the one surface that cannot be selected
         or closed: it sets pointer-events: none and fades after three seconds.
         Studio re-renders it as its own toast, so hide the original copy. */
      [data-hs-mirrored="true"] {
        display: none !important;
      }
    `
    document.head.append(styleElement)
  }
}

ipcRenderer.on('guest:theme', (_event, payload: ThemePayload) => apply(payload))

/**
 * Mirror Harness' transient toast into Studio.
 *
 * The official toast is a portal `[role="alert"]` fixed at the top of the page
 * with `pointer-events: none`, no close control, and a three-second lifetime.
 * That makes the one message a user needs to read — "会话已被占用", a failed
 * model switch, an invalid attachment — impossible to select, copy, or dismiss
 * on purpose. We read the text, hand it to Studio's own toast (selectable, with
 * a close button and a longer lifetime), and hide the original so the user does
 * not see it twice.
 */
function isTransientToast(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.getAttribute('role') !== 'alert') return false
  const style = getComputedStyle(element)
  return style.position === 'fixed' && style.pointerEvents === 'none'
}

function readToast(element: HTMLElement): GuestNotice | null {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return { text, code: classify(text) }
}

/**
 * Map a toast's wording back to the failure that produced it. Harness shows the
 * localized string, not the error code, so we match the two cases that have a
 * concrete recovery in Studio: a session held by another DSH, and a profile that
 * another DSH has locked.
 */
function classify(text: string): string | undefined {
  if (/已被占用|already in use|writer-held/i.test(text)) return 'session/writer-held'
  if (/EPERM|cordis\.yml|配置档案|profile/i.test(text)) return 'profile/locked'
  return undefined
}

function watchToasts(): void {
  const seen = new WeakSet<Element>()

  const inspect = (node: Element): void => {
    if (!isTransientToast(node) || seen.has(node)) return
    seen.add(node)
    const notice = readToast(node as HTMLElement)
    if (!notice) return
    // Hide the original only after its text is safely in Studio's toast, so a
    // mirror that fails to send never swallows the message.
    node.setAttribute('data-hs-mirrored', 'true')
    ipcRenderer.send(GUEST_NOTICE_CHANNEL, notice)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      Array.from(record.addedNodes).forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const element = node as Element
        inspect(element)
        Array.from(element.querySelectorAll('[role="alert"]')).forEach(inspect)
      })
    }
  })

  const start = (): void => {
    observer.observe(document.body, { childList: true, subtree: true })
    Array.from(document.querySelectorAll('[role="alert"]')).forEach(inspect)
  }

  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })
}

/* ------------------------------------------------------------------ *
 * Send confirmation
 *
 * The composer submits on the spot, so a stray Enter — or a queued
 * message riding along with an unrelated send — cannot be taken back.
 * Both paths funnel through the same triggers: Enter (without Shift,
 * which inserts a newline) inside the editor, and a click on the send
 * button. We intercept those, ask the main process, and let the event
 * continue only when the user confirms.
 *
 * Interception is capture-phase and synchronous, which is why the
 * decision is a blocking IPC call rather than a round trip through the
 * renderer.
 * ------------------------------------------------------------------ */

/**
 * The composer is a Lexical editor. It renders as
 * `<div role="textbox" contenteditable="false" class="…_input">` — Lexical owns
 * the attribute and keeps it "false" on the host element while managing a nested
 * editable region, so matching on `contenteditable="true"` finds nothing.
 * Query the textbox role and fall back to a real contenteditable host.
 */
const EDITOR_SELECTOR = '[role="textbox"], [contenteditable="true"], [data-composer-card] [contenteditable]'
const SEND_LABEL = /发送|send/i

function visibleEditors(): HTMLElement[] {
  return Array.from(document.querySelectorAll(EDITOR_SELECTOR)).filter((el) => {
    if (el.tagName === 'TEXTAREA') return true
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) as HTMLElement[]
}

/** The composer element, preferring the deepest editable inside the card. */
function composerEditor(): HTMLElement | undefined {
  const editors = visibleEditors()
  return editors[editors.length - 1]
}

function editorText(): string {
  const editor = composerEditor()
  if (!editor) return ''
  const value = (editor as HTMLTextAreaElement).value
  return (typeof value === 'string' && value ? value : (editor.textContent ?? '')).trim()
}

/** Visible send buttons currently in the composer. */
function sendButtons(): HTMLElement[] {
  return Array.from(document.querySelectorAll('button')).filter((button) => {
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim()
    if (!SEND_LABEL.test(label)) return false
    const rect = button.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) as HTMLElement[]
}

/** How many messages are waiting in the queue dock. */
function queuedCount(): number {
  const header = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) =>
    /条排队消息|queued message/i.test(node.textContent ?? '')
  )
  if (!header) return 0
  const match = (header.textContent ?? '').match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

/**
 * Ask the main process whether this send may proceed. Returns true when the
 * user confirmed, or when no confirmation is configured.
 *
 * A native modal is a blocking, user-facing action, so it cannot be exercised by
 * an automated check. The shell can install a test answer through
 * `__hsGuardTest` to inspect the interception path without opening a dialog.
 */
let testAnswer: boolean | null = null

function requestConfirmation(kind: 'send' | 'queued'): boolean {
  const needsSend = kind === 'send' && guard.confirmSend
  const needsQueued = kind === 'queued' && (guard.confirmQueued || guard.confirmSend)
  if (!needsSend && !needsQueued) return true
  if (testAnswer !== null) return testAnswer
  const preview = editorText().slice(0, 160)
  try {
    return ipcRenderer.sendSync(GUEST_CONFIRM_CHANNEL, {
      kind,
      preview,
      queued: queuedCount()
    }) === true
  } catch {
    // Never block sending because the shell could not answer.
    return true
  }
}

function guardComposer(): void {
  /** Whether an event target sits inside the composer. */
  const inComposer = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null
    if (!element?.closest) return false
    if (element.closest('[data-composer-card]')) return true
    const editor = composerEditor()
    return Boolean(editor && (editor === element || editor.contains(element)))
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.isComposing) return
    if (!inComposer(event.target)) return
    if (!editorText()) return

    // A queued send fires when the agent is idle; warn about it separately.
    const kind = queuedCount() > 0 ? 'queued' : 'send'
    if (requestConfirmation(kind)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null
    const button = target?.closest?.('button')
    if (!button) return
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim()
    if (!SEND_LABEL.test(label)) return
    if (!sendButtons().includes(button as HTMLElement)) return

    const kind = queuedCount() > 0 ? 'queued' : 'send'
    if (requestConfirmation(kind)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  // Capture phase, so the app's own handlers never see a declined send.
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
}

/** Theme payload carried alongside the composer guard. */
interface GuardPayload extends ThemePayload {
  confirmSend?: boolean
  confirmQueued?: boolean
}

function applyGuard(payload: GuardPayload): void {
  guard = {
    confirmSend: payload.confirmSend === true,
    confirmQueued: payload.confirmQueued !== false
  }
}

ipcRenderer.on(GUEST_THEME_CHANNEL, (_event, payload: GuardPayload) => {
  apply(payload)
  applyGuard(payload)
})

/* ------------------------------------------------------------------ *
 * Session tab shortcuts
 *
 * Studio's tabs live outside this page, so Ctrl+T, Ctrl+W and Ctrl+Tab
 * pressed in here have to be handed out. Chrome keeps these keys for
 * itself; Electron delivers every key to the page, and the embedded
 * terminal (xterm.js) depends on that: Ctrl+W erases a word in bash,
 * Ctrl+T swaps two characters. The main process cannot tell from
 * `before-input-event` whether the terminal has focus, so the decision
 * is made here. Inside `.xterm` these keys pass through untouched;
 * anywhere else they are taken from the page and sent to Studio over
 * `guest:shortcut`.
 * ------------------------------------------------------------------ */

function forwardTabShortcuts(): void {
  /** Whether a node sits inside the embedded terminal. */
  const inTerminal = (node: EventTarget | null): boolean =>
    node instanceof Element && node.closest('.xterm') !== null

  const commandFor = (event: KeyboardEvent): TabCommand | null => {
    const mod = event.ctrlKey || event.metaKey
    if (!mod || event.altKey || event.isComposing) return null
    if (inTerminal(event.target) || inTerminal(document.activeElement)) return null
    const key = event.key
    if ((key === 't' || key === 'T') && !event.shiftKey) return 'new-tab'
    if ((key === 'w' || key === 'W') && !event.shiftKey) return 'close-tab'
    // Ctrl only: Cmd+Tab is the macOS app switcher.
    if (key === 'Tab' && event.ctrlKey) return event.shiftKey ? 'prev-tab' : 'next-tab'
    return null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    try {
      const action = commandFor(event)
      if (!action) return
      // Send first: if forwarding fails, the key stays with the page.
      ipcRenderer.send(GUEST_SHORTCUT_CHANNEL, { action })
      event.preventDefault()
      event.stopImmediatePropagation()
    } catch {
      /* leave the key to the page */
    }
  }

  // Capture phase, so the page's own handlers never act on a key Studio took.
  document.addEventListener('keydown', onKeyDown, true)
}

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.hsSurface = 'harness'
  watchToasts()
  guardComposer()
  forwardTabShortcuts()
  // Ask for the current settings; the theme push only arrives on change.
  try {
    applyGuard(ipcRenderer.sendSync(GUEST_CONFIRM_CHANNEL, { kind: 'settings' }) ?? {})
  } catch {
    /* keep defaults */
  }

  /**
   * Test hook: answer send confirmations without opening a modal, so the
   * interception path can be verified automatically. Passing null restores the
   * real modal.
   *
   * `contextIsolation` keeps this off the page's own `window`, so the hook is
   * also reachable through a DOM event, which crosses worlds.
   */
  Object.defineProperty(window, '__hsGuardTest', {
    value: (answer: boolean | null, overrides?: Partial<ComposerGuard>) => {
      testAnswer = answer
      if (overrides) guard = { ...guard, ...overrides }
      return { ...guard, testAnswer }
    },
    writable: false,
    configurable: true
  })

  window.addEventListener('hs-guard-test', (event) => {
    const detail = (event as CustomEvent).detail as
      | { answer?: boolean | null; overrides?: Partial<ComposerGuard> }
      | undefined
    testAnswer = detail?.answer ?? null
    if (detail?.overrides) guard = { ...guard, ...detail.overrides }
  })
})
