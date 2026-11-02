import type { WebContents } from 'electron'
import type { ModelNavigationChoice, OpenModelPanelResult } from '@shared/models'
import { modelMessages } from '@shared/locales/models'
import { getMainLocale } from './i18n'

export interface ModelPanelAuthorization {
  key: string
  /** Must remain valid when Settings hides the conversation DOM. */
  valid: () => boolean
  release: () => void
}

export interface ModelPanelOptions {
  signal?: AbortSignal
  timeoutMs?: number
  pollMs?: number
  /** Let already-loading official onboarding finish before declaring Later complete. */
  settleMs?: number
}

interface ProbeResult {
  status: 'opened' | 'missing' | 'waiting' | 'clicked' | 'blocked' | 'cancelled'
  action?: string
}

function copy(key: 'models.openFailed' | 'models.unavailable' | 'models.blocked'): string {
  return modelMessages[key][getMainLocale() === 'zh-CN' ? 0 : 1]
}

/**
 * Official rc.2 DOM contracts: settings.launcher, data-shortcut-modal=settings,
 * settings.section, and localized exact navigation labels. Never invoke private
 * React stores, mutate provider values, acknowledge release notices, or log keys.
 */
function modelProbe(choice: ModelNavigationChoice, authorizationKey: string, attempted: string[]): string {
  return `(() => {
    const choice = ${JSON.stringify(choice)}
    const attempted = new Set(${JSON.stringify(attempted)})
    const visible = (element) => {
      // Chromium can expose nonzero cached geometry below a collapsed details
      // element. Those persisted model defaults are not a visible edit draft.
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS' && !parent.open
          && !Array.from(parent.children).some(child => child.tagName === 'SUMMARY' && child.contains(element))) return false
      }
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0'
        && !element.closest('[inert]')
    }
    const usable = (element) => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
    const exact = (element, values) => values.includes((element.textContent || '').trim())
    // Settings menu items also render an aria-hidden keyboard shortcut.
    const menuExact = (element, values) => exact(element, values) || Array.from(element.querySelectorAll('span')).some(span =>
      !span.closest('[aria-hidden="true"]') && exact(span, values))
    const unique = (elements) => elements.length === 1 ? elements[0] : null
    const filled = (root) => Array.from(root.querySelectorAll('input, textarea, [contenteditable="true"]')).some(input =>
      visible(input) && !input.disabled && !input.readOnly && Boolean((input.value ?? input.textContent ?? '').trim()))
    const click = (element, action) => {
      if (!element || !usable(element)) return {status:'missing'}
      if (attempted.has(action)) return {status:'waiting'}
      const gate = document.createElement('span')
      gate.dataset.hsRequest = ${JSON.stringify(authorizationKey)}
      document.documentElement.append(gate)
      gate.dispatchEvent(new Event('hs-workspace-check', {bubbles:true}))
      const allowed = gate.dataset.hsAllowed === 'true'
      gate.remove()
      if (!allowed) return {status:'cancelled'}
      element.click()
      return {status:'clicked', action}
    }
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).filter(visible)
    const settings = dialogs.filter(dialog => dialog.getAttribute('data-shortcut-modal') === 'settings')
    const other = dialogs.filter(dialog => dialog.getAttribute('data-shortcut-modal') !== 'settings')
    if (other.length > 0) {
      if (other.length !== 1 || settings.length > 0) return {status:'blocked'}
      const dialog = other[0]
      const heading = (dialog.querySelector('h2')?.textContent || '').trim()
      const paragraphs = Array.from(dialog.querySelectorAll('p')).map(p => (p.textContent || '').trim())
      const accountIntro = ['开始使用', 'Get started'].includes(heading) && paragraphs.some(text => [
        '登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。',
        'Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally.'
      ].includes(text)) && dialog.querySelectorAll('input, textarea, [contenteditable="true"]').length === 0
      if (accountIntro) {
        const buttons = Array.from(dialog.querySelectorAll('button')).filter(usable)
        if (!unique(buttons.filter(button => exact(button, ['添加 API Key', 'Add API Key'])))
          || !unique(buttons.filter(button => exact(button, ['登录', 'Sign in'])))) return {status:'blocked'}
        if (choice === 'account') return {status:'opened'}
        return click(unique(buttons.filter(button => ['关闭', 'Close'].includes(button.getAttribute('aria-label')))), 'skip-account-intro')
      }
      const keyIntro = ['添加一个 API Key 开始使用', 'Add an API key to get started'].includes(heading)
        && paragraphs.some(text => ['配置 DeepSeek 官方模型，即可开始使用。', 'Configure the official DeepSeek provider to start building.'].includes(text))
      if (keyIntro && !filled(dialog)) {
        return click(unique(Array.from(dialog.querySelectorAll('button')).filter(button => usable(button) && exact(button, ['稍后配置', 'Configure later']))), 'skip-key-intro')
      }
      // Sign-in requests are user-selected. An existing pending login is already
      // the requested destination; no account action is clicked here.
      if (choice === 'account' && attempted.has('open-account') && [
        '等待登录', 'Waiting for sign in', '登录已超时', 'Sign in timed out', '登录失败', 'Could not sign in'
      ].includes(heading)) return {status:'opened'}
      return {status:'blocked'}
    }
    if (choice === 'later') return Array.from(document.querySelectorAll('[data-slot="settings.launcher"] button')).some(usable)
      ? {status:'opened'} : {status:'waiting'}
    if (settings.length > 1) return {status:'missing'}
    if (settings.length === 1) {
      const panel = settings[0]
      const section = panel.querySelector('[data-slot="settings.section"]')
      if (!section) return {status:'missing'}
      const modelHeading = Array.from(section.querySelectorAll('h2')).some(heading => visible(heading) && exact(heading, ['模型', 'Models']))
      // General settings contain persisted text values. Their nonempty values
      // do not prove an unfinished provider edit, so protect only model forms
      // and credential fields when leaving another section.
      const filledCredential = Array.from(section.querySelectorAll('input[type="password"], input[aria-label="API Key"], input[aria-label="API key"], input[aria-label="Provider ID"]')).some(input =>
        visible(input) && !input.disabled && !input.readOnly && Boolean((input.value || '').trim()))
      const providerDraft = filledCredential || (modelHeading && filled(section))
      if (choice === 'account') {
        if (providerDraft) return {status:'blocked'}
        const close = unique(Array.from(panel.querySelectorAll('button')).filter(button => usable(button) && button.querySelector('[data-slot="settings.close"]')))
        return click(close, 'close-settings-for-account')
      }
      const modelNav = unique(Array.from(panel.querySelectorAll('nav button')).filter(button => usable(button) && exact(button, ['模型', 'Models'])))
      if (!modelNav) return {status:'missing'}
      const selected = ['true', 'page'].includes(modelNav.getAttribute('aria-current'))
      if (!selected || !modelHeading) {
        if (providerDraft) return {status:'blocked'}
        return click(modelNav, 'select-models')
      }
      if (choice === 'models') return {status:'opened'}
      if (section.querySelector('input[aria-label="Provider ID"]') && visible(section.querySelector('input[aria-label="Provider ID"]'))) return {status:'opened'}
      if (filled(section)) return {status:'blocked'}
      const custom = unique(Array.from(section.querySelectorAll('button, [role="radio"], label')).filter(element => usable(element) && exact(element, ['自定义模型 API', 'Custom model API'])))
      if (custom) return click(custom, 'select-custom')
      const add = unique(Array.from(section.querySelectorAll('button')).filter(button => usable(button) && exact(button, ['添加模型提供商', 'Add model provider'])))
      return click(add, 'add-provider')
    }
    const launchers = Array.from(document.querySelectorAll('[data-slot="settings.launcher"] button')).filter(usable)
    const account = unique(launchers.filter(button => ['账号菜单', 'Account menu'].includes(button.getAttribute('aria-label')) && button.getAttribute('aria-haspopup') === 'menu'))
    if (account && account.getAttribute('aria-expanded') === 'true') {
      const menuItems = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).filter(usable)
      if (choice === 'account') {
        if (account.getAttribute('data-signed-out') === 'false') return {status:'opened'}
        return click(unique(menuItems.filter(item => menuExact(item, ['登录', 'Sign in']))), 'open-account')
      }
      return click(unique(menuItems.filter(item => menuExact(item, ['设置', 'Settings']))), 'open-settings-menu')
    }
    if (choice === 'account' && account) return click(account, 'open-account-menu')
    const direct = unique(launchers.filter(button => ['设置', 'Settings'].includes(button.getAttribute('aria-label')) && button.getAttribute('aria-haspopup') === 'dialog'))
    if (direct) return click(direct, 'open-settings')
    if (account) return click(account, 'open-account-menu')
    return {status:'missing'}
  })()`
}

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
      Promise.resolve(contents.executeJavaScript(code, true)).then((value: ProbeResult) => finish(value), (error: unknown) => finish(null, error))
    } catch (error) { finish(null, error) }
  })
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    if (signal.aborted) { finish(); return }
    signal.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, ms)
  })
}

/** Cancellable current-guest navigation, with a fresh synchronous grant for each click. */
export async function openModelPanel(
  contents: WebContents,
  authorization: ModelPanelAuthorization,
  choice: ModelNavigationChoice = 'models',
  options: ModelPanelOptions = {}
): Promise<OpenModelPanelResult> {
  if (!['models', 'custom', 'account', 'later'].includes(choice)) {
    authorization.release()
    return { status: 'failed', message: copy('models.openFailed') }
  }
  const cancellation = new AbortController()
  const attempted: string[] = []
  let laterQuietSince: number | undefined
  let timedOut = false
  const abort = (): void => { cancellation.abort() }
  const deadline = setTimeout(() => { timedOut = true; abort() }, options.timeoutMs ?? 10_000)
  const navigated = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean): void => { if (mainFrame && !inPlace) abort() }
  contents.once('destroyed', abort)
  contents.on('did-start-navigation', navigated)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (contents.isDestroyed() || options.signal?.aborted) abort()
  const interrupted = (): OpenModelPanelResult => !timedOut || contents.isDestroyed() || options.signal?.aborted
    ? { status: 'cancelled' }
    : { status: attempted.length ? 'failed' : 'missing', message: copy(attempted.length ? 'models.openFailed' : 'models.unavailable') }
  try {
    while (!cancellation.signal.aborted) {
      if (!authorization.valid()) return { status: 'cancelled' }
      const result = await evaluate(contents, modelProbe(choice, authorization.key, attempted), cancellation.signal)
      if (cancellation.signal.aborted) return interrupted()
      if (!authorization.valid() || result?.status === 'cancelled') return { status: 'cancelled' }
      if (result?.status === 'opened') {
        if (choice !== 'later') return { status: 'opened' }
        laterQuietSince ??= Date.now()
        if (Date.now() - laterQuietSince >= (options.settleMs ?? 350)) return { status: 'opened' }
      } else { laterQuietSince = undefined }
      if (result?.status === 'blocked') return { status: 'blocked', message: copy('models.blocked') }
      if (result?.status === 'clicked' && result.action) attempted.push(result.action)
      await pause(options.pollMs ?? 100, cancellation.signal)
    }
    return interrupted()
  } catch {
    return cancellation.signal.aborted ? interrupted() : { status: 'failed', message: copy('models.openFailed') }
  } finally {
    clearTimeout(deadline)
    contents.removeListener('destroyed', abort)
    contents.removeListener('did-start-navigation', navigated)
    options.signal?.removeEventListener('abort', abort)
    authorization.release()
  }
}
