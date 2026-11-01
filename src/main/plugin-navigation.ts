import type { WebContents } from 'electron'
import type { OpenPluginPanelResult } from '@shared/types'
import { t } from './i18n'

interface PluginPanelAuthorization {
  key: string
  valid: () => boolean
  release: () => void
}

interface PluginPanelOptions {
  signal?: AbortSignal
  timeoutMs?: number
  pollMs?: number
}

type ProbeResult = 'opened' | 'missing' | 'waiting' | 'clicked' | 'cancelled'

function panelProbe(authorizationKey?: string): string {
  return `(() => {
    const buttons = Array.from(document.querySelectorAll('nav button[aria-label="插件"], nav button[aria-label="Plugins"]')).filter(button => {
      const rect = button.getBoundingClientRect()
      const style = getComputedStyle(button)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.visibility !== 'collapse'
        && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        && !button.closest('[inert]') && Boolean(button.querySelector('[data-slot="sidebar.panellist"]'))
    })
    if (buttons.length !== 1) return 'missing'
    const button = buttons[0]
    if (button.getAttribute('aria-current') === 'page') return 'opened'
    ${authorizationKey === undefined ? "return 'waiting'" : `
    // Recheck permission synchronously when this script actually runs. A script
    // queued before a tab switch or timeout must never click later.
    const gate = document.createElement('span')
    gate.dataset.hsRequest = ${JSON.stringify(authorizationKey)}
    document.documentElement.append(gate)
    gate.dispatchEvent(new Event('hs-workspace-check', { bubbles: true }))
    const allowed = gate.dataset.hsAllowed === 'true'
    gate.remove()
    if (!allowed) return 'cancelled'
    button.click()
    return button.getAttribute('aria-current') === 'page' ? 'opened' : 'clicked'
    `}
  })()`
}

/** Electron may leave guest evaluation pending after destruction or a reload. */
function evaluate(contents: WebContents, code: string, signal: AbortSignal): Promise<ProbeResult | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value: ProbeResult | null, error?: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const abort = (): void => finish(null)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    try {
      Promise.resolve(contents.executeJavaScript(code, true)).then(
        (value: ProbeResult) => finish(value),
        (error: unknown) => finish(null, error)
      )
    } catch (error) {
      finish(null, error)
    }
  })
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    if (signal.aborted) { finish(); return }
    signal.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, ms)
  })
}

/** Open only the existing, uniquely identified Harness sidebar Plugins panel. */
export async function openPluginPanel(
  contents: WebContents,
  authorization: PluginPanelAuthorization,
  options: PluginPanelOptions = {}
): Promise<OpenPluginPanelResult> {
  const cancellation = new AbortController()
  let timedOut = false
  let clicked = false
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    authorization.release()
  }
  const abort = (): void => { cancellation.abort() }
  const deadline = setTimeout(() => {
    timedOut = true
    cancellation.abort()
  }, options.timeoutMs ?? 8_000)
  contents.once('destroyed', abort)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (contents.isDestroyed() || options.signal?.aborted) abort()
  const interrupted = (): OpenPluginPanelResult => {
    if (!timedOut || contents.isDestroyed() || options.signal?.aborted) return { status: 'cancelled' }
    return clicked
      ? { status: 'failed', message: t('main.pluginsFailed') }
      : { status: 'missing', message: t('main.pluginsUnavailable') }
  }

  try {
    while (!cancellation.signal.aborted) {
      const result = await evaluate(contents, panelProbe(clicked ? undefined : authorization.key), cancellation.signal)
      if (cancellation.signal.aborted) return interrupted()
      // Selecting Plugins can hide the conversation and invalidate the input
      // guard. Confirmation is read-only, so that change must not undo success.
      if (result === 'opened') return { status: 'opened' }
      if (result === 'cancelled') return { status: 'cancelled' }
      if (result === 'clicked') { clicked = true; release() }
      if (!clicked && !authorization.valid()) return { status: 'cancelled' }
      await pause(options.pollMs ?? 100, cancellation.signal)
    }
    return interrupted()
  } catch {
    return cancellation.signal.aborted
      ? interrupted()
      : { status: 'failed', message: t('main.pluginsFailed') }
  } finally {
    clearTimeout(deadline)
    contents.removeListener('destroyed', abort)
    options.signal?.removeEventListener('abort', abort)
    release()
  }
}
