import type { WebContents } from 'electron'
import type { QuickAskResult } from '@shared/types'
import { log, logError } from './logger'

const COMPOSER_SELECTOR = '[contenteditable="true"]'
const SEND_BUTTON_PATTERN = '发送|send|Send'

/**
 * The Harness composer is a React-controlled contenteditable. `execCommand` and
 * direct DOM writes are ignored, so we focus the editor and let Chromium deliver
 * real input events, exactly like typing.
 */
const FOCUS_COMPOSER = `(() => {
  const editors = Array.from(document.querySelectorAll('${COMPOSER_SELECTOR}')).filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  if (editors.length === 0) return { ok: false, reason: 'no-composer' }
  const editor = editors[editors.length - 1]
  editor.focus()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return {
    ok: document.activeElement === editor || editor.contains(document.activeElement),
    reason: 'focused'
  }
})()`

const READ_COMPOSER = `(() => {
  const editors = Array.from(document.querySelectorAll('${COMPOSER_SELECTOR}')).filter((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  const editor = editors[editors.length - 1]
  if (!editor) return { ok: false, text: '', focused: false }
  return {
    ok: true,
    text: editor.textContent || '',
    focused: document.activeElement === editor || editor.contains(document.activeElement)
  }
})()`

const PRESS_SEND = `(() => {
  const buttons = Array.from(document.querySelectorAll('button'))
  const send = buttons.find((button) => {
    const label = (button.getAttribute('aria-label') || button.textContent || '').trim()
    const matches = new RegExp('${SEND_BUTTON_PATTERN}').test(label)
    if (!matches) return false
    const rect = button.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  if (!send) return { ok: false, reason: 'no-send-button' }
  if (send.disabled) return { ok: false, reason: 'send-disabled' }
  send.click()
  return { ok: true, reason: 'clicked' }
})()`

const DISMISS_ONBOARDING = `(() => {
  // Buttons that only acknowledge information; safe to click for us.
  const ACK = /^(继续|知道了|我知道了|稍后配置|稍后再说|跳过|Continue|Got it|Dismiss|Skip|Later)$/
  const CLOSE = /关闭|close/i
  let dismissed = 0
  const candidates = Array.from(document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="Dialog"]'))
  for (const dialog of candidates) {
    const rect = dialog.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    // Never dismiss a dialog that is actively asking for credentials or a
    // destructive confirmation; the user must decide those.
    const text = dialog.textContent || ''
    if (/API Key|登录|授权|删除|卸载|重置/.test(text)) continue
    const buttons = Array.from(dialog.querySelectorAll('button'))
    const target =
      buttons.find((item) => ACK.test((item.textContent || '').trim())) ??
      buttons.find((item) => CLOSE.test(item.getAttribute('aria-label') || ''))
    if (target) {
      target.click()
      dismissed += 1
    }
  }
  return { ok: dismissed > 0, count: dismissed }
})()`

async function evaluate<T>(contents: WebContents, code: string): Promise<T | null> {
  try {
    return (await contents.executeJavaScript(code, true)) as T
  } catch (error) {
    logError('quick-ask', error)
    return null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface InjectOptions {
  autoSend: boolean
}

/**
 * Insert `text` into the embedded Harness composer and optionally submit it.
 * Returns a status the Quick Ask window can render.
 */
export async function injectIntoComposer(contents: WebContents, text: string, options: InjectOptions): Promise<QuickAskResult> {
  const trimmed = text.trim()
  if (!trimmed) return { status: 'failed', message: '内容为空' }
  if (contents.isDestroyed()) return { status: 'needs-host', message: '会话界面尚未就绪' }

  // First-run onboarding can hold focus; dismiss it before touching the composer.
  // Several onboarding dialogs can stack, so retry a few times.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dismissed = await evaluate<{ ok: boolean; count: number }>(contents, DISMISS_ONBOARDING)
    if (!dismissed?.ok) break
    await sleep(450)
  }

  // The SPA may still be mounting right after the webview attaches; poll briefly.
  let focus: { ok: boolean; reason: string } | null = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    focus = await evaluate<{ ok: boolean; reason: string }>(contents, FOCUS_COMPOSER)
    if (focus?.ok) break
    if (focus?.reason !== 'no-composer') break
    await sleep(500)
  }
  if (!focus?.ok) {
    return {
      status: 'needs-host',
      message: focus?.reason === 'no-composer' ? '找不到输入框，请先打开一个会话' : '无法聚焦输入框'
    }
  }

  // Real input events; this is what Electron's own insertText uses underneath.
  contents.insertText(trimmed)
  await sleep(250)

  const state = await evaluate<{ ok: boolean; text: string; focused: boolean }>(contents, READ_COMPOSER)
  if (!state?.ok || !state.text.includes(trimmed.slice(0, Math.min(12, trimmed.length)))) {
    return { status: 'failed', message: '内容没有进入输入框' }
  }

  if (!options.autoSend) {
    return { status: 'inserted' }
  }

  const sent = await evaluate<{ ok: boolean; reason: string }>(contents, PRESS_SEND)
  if (!sent?.ok) {
    // Text is in the composer; the user can press Enter themselves.
    log('quick-ask', `send failed: ${sent?.reason ?? 'unknown'}`)
    return { status: 'inserted', message: '已填入输入框，请手动发送' }
  }
  return { status: 'sent' }
}
