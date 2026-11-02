import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import vm from 'node:vm'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Execute the real navigation code and its guest script. This test never starts
// a Host, reads an account/profile, writes credentials, or requests a model.
const load = createTypeScriptLoader()
const { openModelPanel } = load(new URL('../src/main/model-navigation.ts', import.meta.url))
const { setMainLanguage } = load(new URL('../src/main/i18n.ts', import.meta.url))

function parts(selector) {
  return selector.match(/(?:[^\s"'\[]|"[^"]*"|'[^']*'|\[[^\]]*\])+/g) ?? []
}
function matches(element, selector) {
  const tokens = parts(selector)
  const matchesToken = (node, token) => {
    const tag = token.match(/^[a-z][a-z0-9]*/i)?.[0]
    if (tag && node.tag !== tag) return false
    for (const match of token.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual = node.getAttribute(match[1])
      if (match[2] === undefined ? actual === null : actual !== match[2]) return false
    }
    return true
  }
  if (!matchesToken(element, tokens.at(-1))) return false
  let parent = element.parent
  for (let i = tokens.length - 2; i >= 0; i--) {
    while (parent && !matchesToken(parent, tokens[i])) parent = parent.parent
    if (!parent) return false
    parent = parent.parent
  }
  return true
}

class Element {
  constructor(tag = 'div', attrs = {}, text = '') {
    this.tag = tag; this.attrs = { ...attrs }; this.text = text; this.children = []; this.dataset = {}
    this.visible = true; this.disabled = false; this.readOnly = false
    this.style = { display: 'block', visibility: 'visible' }; this.clicks = 0
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join('') }
  get parentElement() { return this.parent ?? null }
  get tagName() { return this.tag.toUpperCase() }
  contains(element) { let current=element;while(current){if(current===this)return true;current=current.parent}return false }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child) } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
  getAttribute(key) { return Object.hasOwn(this.attrs, key) ? String(this.attrs[key]) : null }
  getBoundingClientRect() { return { width: this.visible ? 50 : 0, height: this.visible ? 24 : 0 } }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim())
    const result = []
    const visit = parent => { for (const child of parent.children) { if (selectors.some(selector => matches(child, selector))) result.push(child); visit(child) } }
    visit(this)
    return result
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  closest(selector) { let current = this; while (current) { if (matches(current, selector)) return current; current = current.parent } return null }
  click() { this.clicks++; this.onClick?.() }
}
const el = (tag, attrs, text) => new Element(tag, attrs, text)
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }
const flush = () => new Promise(resolve => setImmediate(resolve))

class Guest extends EventEmitter {
  constructor(language = 'en') {
    super(); this.language = language; this.root = el('html'); this.grants = new Map()
    this.destroyed = false; this.evaluations = 0; this.beforeEvaluate = null; this.beforeAuthorize = null
    this.history = []; this.queued = null; this.entered = null; this.failure = null
  }
  isDestroyed() { return this.destroyed }
  close() { this.destroyed = true; this.emit('destroyed') }
  reload() { this.emit('did-start-navigation', {}, 'http://localhost/new', false, true) }
  label(zh, en) { return this.language === 'zh' ? zh : en }
  track(button, action, effect = () => {}) {
    button.onClick = () => { this.history.push(action); effect() }
    return button
  }
  launcher(account = false) {
    const slot = el('div', { 'data-slot': 'settings.launcher' })
    const button = el('button', { 'aria-label': account ? this.label('账号菜单', 'Account menu') : this.label('设置', 'Settings'), 'aria-haspopup': account ? 'menu' : 'dialog', 'aria-expanded': 'false', ...account ? { 'data-signed-out': 'true' } : {} })
    this.track(button, account ? 'account-menu' : 'settings', () => account ? this.menu(button) : this.settings())
    slot.append(button); this.root.append(slot)
    return button
  }
  menu(anchor, settingsOnly = false) {
    anchor.attrs['aria-expanded'] = 'true'
    const menu = el('div', { role: 'menu' })
    const settings = this.track(el('button', { role: 'menuitem' }), 'menu-settings', () => { menu.remove(); anchor.attrs['aria-expanded'] = 'false'; this.settings() })
    settings.append(el('span', {}, this.label('设置', 'Settings')), el('span', { 'aria-hidden': 'true' }, 'Ctrl+,'))
    menu.append(settings)
    if (!settingsOnly) menu.append(this.track(el('button', { role: 'menuitem' }, this.label('登录', 'Sign in')), 'sign-in', () => { menu.remove(); this.loginWaiting() }))
    this.root.append(menu)
    return menu
  }
  settings(selected = false, options = {}) {
    const panel = el('div', { role: 'dialog', 'aria-modal': 'true', 'data-shortcut-modal': 'settings' })
    const nav = el('nav')
    const model = this.track(el('button', { 'aria-current': selected ? 'true' : 'false' }, this.label('模型', 'Models')), 'models', () => {
      model.attrs['aria-current'] = 'true'; section.children = []; section.append(el('h2', {}, this.label('模型', 'Models'))); this.addButton(section)
    })
    nav.append(model)
    const section = el('div', { 'data-slot': 'settings.section' })
    section.append(el('h2', {}, selected ? this.label('模型', 'Models') : this.label('通用设置', 'General')))
    if (selected) this.addButton(section)
    if (options.filled) { const input = el('input', { type: options.credential ? 'password' : 'text' }); input.value = 'keep this draft'; section.append(input) }
    const close = this.track(el('button'), 'close-settings', () => panel.remove())
    close.append(el('span', { 'data-slot': 'settings.close' }, this.label('关闭', 'Close')))
    panel.append(nav, section, close); this.root.append(panel)
    return { panel, model, section, close }
  }
  addButton(section) {
    const button = this.track(el('button', {}, this.label('添加模型提供商', 'Add model provider')), 'add-provider', () => {
      button.remove()
      section.append(this.track(el('button', { role: 'tab', 'aria-selected': 'false' }, this.label('自定义模型 API', 'Custom model API')), 'custom', () => {
        const input = el('input', { 'aria-label': 'Provider ID' }); input.value = ''; section.append(input)
      }))
    })
    section.append(button)
    return button
  }
  accountIntro(options = {}) {
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' })
    dialog.append(el('h2', {}, this.label('开始使用', 'Get started')), el('p', {}, this.label('登录 DeepSeek 账号，或添加 API Key，即可开始使用。你的项目和文件保存在本地。', 'Sign in to your DeepSeek account or add an API Key to get started. Your projects and files are stored locally.')))
    const close = this.track(el('button', { 'aria-label': this.label('关闭', 'Close') }), 'skip-account', () => { dialog.remove(); options.afterClose?.() })
    dialog.append(close, el('button', {}, this.label('添加 API Key', 'Add API Key')), el('button', {}, this.label('登录', 'Sign in')))
    if (options.input) { const input = el('input', { type: 'password' }); input.value = options.input; dialog.append(input) }
    this.root.append(dialog)
    return dialog
  }
  keyIntro(value = '') {
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' })
    const input = el('input', { type: 'password' }); input.value = value
    dialog.append(el('h2', {}, this.label('添加一个 API Key 开始使用', 'Add an API key to get started')), el('p', {}, this.label('配置 DeepSeek 官方模型，即可开始使用。', 'Configure the official DeepSeek provider to start building.')), input,
      this.track(el('button', {}, this.label('稍后配置', 'Configure later')), 'skip-key', () => dialog.remove()))
    this.root.append(dialog)
    return dialog
  }
  loginWaiting() {
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' })
    dialog.append(el('h2', {}, this.label('等待登录', 'Waiting for sign in')))
    this.root.append(dialog)
  }
  async executeJavaScript(code) {
    this.evaluations++; this.beforeEvaluate?.(this.evaluations, code)
    if (this.failure) throw this.failure
    if (this.queued) { const queued = this.queued; this.queued = null; this.entered?.resolve(); await queued.promise }
    const document = {
      documentElement: this.root,
      querySelectorAll: selector => this.root.querySelectorAll(selector),
      createElement: () => {
        const element = el('span')
        element.dispatchEvent = event => { assert.equal(event.type, 'hs-workspace-check'); this.beforeAuthorize?.(); element.dataset.hsAllowed = this.grants.get(element.dataset.hsRequest)?.() ? 'true' : 'false' }
        return element
      }
    }
    return vm.runInNewContext(code, { document, getComputedStyle: element => element.style, Event })
  }
}

let sequence = 0
function authorize(guest, guard = () => true) {
  const key = `models-${++sequence}`
  const authorization = { key, releases: 0, valid: () => guest.grants.has(key) && !guest.destroyed && guard(), release: () => { authorization.releases++; guest.grants.delete(key) } }
  guest.grants.set(key, authorization.valid)
  return authorization
}
async function open(guest, choice = 'models', options = {}, guard) {
  const authorization = authorize(guest, guard)
  const result = await openModelPanel(guest, authorization, choice, { timeoutMs: 90, pollMs: 2, settleMs: 5, ...options })
  assert.equal(authorization.releases, 1, 'revoke the grant exactly once')
  assert.equal(guest.listenerCount('destroyed'), 0)
  assert.equal(guest.listenerCount('did-start-navigation'), 0)
  if (options.signal) assert.equal(getEventListeners(options.signal, 'abort').length, 0)
  return result
}
async function bounded(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('operation did not settle')), 250) })]) }
  finally { clearTimeout(timer) }
}
let cases = 0
async function test(name, run) { await run(); cases++; console.log(`PASS ${name}`) }

for (const language of ['zh', 'en']) {
  await test(`${language}: direct settings launcher opens Models`, async () => {
    const guest = new Guest(language); guest.launcher()
    assert.equal((await open(guest)).status, 'opened')
    assert.deepEqual(guest.history, ['settings', 'models'])
  })
  await test(`${language}: account launcher and shortcut-bearing menu open custom form`, async () => {
    const guest = new Guest(language); guest.launcher(true)
    assert.equal((await open(guest, 'custom')).status, 'opened')
    assert.deepEqual(guest.history, ['account-menu', 'menu-settings', 'models', 'add-provider', 'custom'])
  })
  await test(`${language}: explicit custom skips only the blank official credential introduction`, async () => {
    const guest = new Guest(language); guest.launcher(); guest.accountIntro({ afterClose: () => guest.keyIntro() })
    assert.equal((await open(guest, 'custom')).status, 'opened')
    assert.deepEqual(guest.history, ['skip-account', 'skip-key', 'settings', 'models', 'add-provider', 'custom'])
  })
  await test(`${language}: Later dismisses the exact official introductions without model configuration`, async () => {
    const guest = new Guest(language); guest.launcher(); guest.accountIntro({ afterClose: () => guest.keyIntro() })
    assert.equal((await open(guest, 'later')).status, 'opened')
    assert.deepEqual(guest.history, ['skip-account', 'skip-key'])
  })
  await test(`${language}: Account keeps an existing official login choice available`, async () => {
    const guest = new Guest(language); guest.launcher(true); guest.accountIntro()
    assert.equal((await open(guest, 'account')).status, 'opened')
    assert.deepEqual(guest.history, [])
  })
  await test(`${language}: explicit Account opens only its official sign-in menu action`, async () => {
    const guest = new Guest(language); guest.launcher(true)
    assert.equal((await open(guest, 'account')).status, 'opened')
    assert.deepEqual(guest.history, ['account-menu', 'sign-in'])
  })
  await test(`${language}: a typed credential remains intact`, async () => {
    const guest = new Guest(language); guest.launcher(); const dialog = guest.keyIntro('test-secret-do-not-discard')
    assert.equal((await open(guest, 'custom')).status, 'blocked')
    assert.equal(dialog.querySelector('input').value, 'test-secret-do-not-discard')
    assert.deepEqual(guest.history, [])
  })
}
await test('Models selected is idempotent and does not click provider actions', async () => {
  const guest = new Guest(); guest.launcher(); guest.settings(true)
  assert.equal((await open(guest)).status, 'opened'); assert.deepEqual(guest.history, [])
})
await test('an already open custom form and its text are preserved', async () => {
  const guest = new Guest(); guest.launcher(); const { section } = guest.settings(true)
  const input = el('input', { 'aria-label': 'Provider ID' }); input.value = 'draft-provider'; section.append(input)
  assert.equal((await open(guest, 'custom')).status, 'opened'); assert.deepEqual(guest.history, [])
  assert.equal(input.value, 'draft-provider')
})
await test('navigating away from a filled credential cannot discard the form', async () => {
  for (const choice of ['models', 'custom', 'account']) {
    const guest = new Guest(); guest.launcher(); guest.settings(false, { filled: true, credential: true })
    assert.equal((await open(guest, choice)).status, 'blocked'); assert.deepEqual(guest.history, [])
  }
})
await test('persisted General text settings do not block deliberate model navigation', async () => {
  const guest = new Guest(); guest.launcher(); guest.settings(false, { filled: true })
  assert.equal((await open(guest)).status, 'opened'); assert.deepEqual(guest.history, ['models'])
})
await test('a filled model provider form blocks switching to a different editor', async () => {
  for (const choice of ['custom', 'account']) {
    const guest = new Guest(); guest.launcher(true); guest.settings(true, { filled: true })
    assert.equal((await open(guest, choice)).status, 'blocked'); assert.deepEqual(guest.history, [])
  }
})
await test('collapsed official advanced settings with cached geometry do not look like visible drafts',async()=>{
  const guest=new Guest();guest.launcher();const {section}=guest.settings(true)
  const details=el('details');details.open=false
  const defaults=el('input',{'aria-label':'Model ID 1'});defaults.value='deepseek-default'
  details.append(el('summary',{},'Custom settings'),defaults);section.append(details)
  assert.equal((await open(guest,'custom')).status,'opened');assert.deepEqual(guest.history,['add-provider','custom']);assert.equal(defaults.value,'deepseek-default')
})
await test('Later does not close an existing settings form', async () => {
  const guest = new Guest(); guest.launcher(); const { panel } = guest.settings(false, { filled: true })
  assert.equal((await open(guest, 'later')).status, 'opened'); assert.deepEqual(guest.history, []); assert.ok(panel.parent)
})
await test('preview release notices are not acknowledged by model navigation', async () => {
  const guest = new Guest(); guest.launcher()
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' }); dialog.append(el('h2', {}, 'Preview release'), guest.track(el('button', {}, 'Continue'), 'ack-release')); guest.root.append(dialog)
  assert.equal((await open(guest, 'custom')).status, 'blocked'); assert.deepEqual(guest.history, [])
})
await test('a familiar heading without exact official description is not dismissed', async () => {
  const guest = new Guest(); guest.launcher(); const dialog = guest.accountIntro(); dialog.querySelector('p').text = 'Some unrelated third-party login flow'
  assert.equal((await open(guest, 'custom')).status, 'blocked'); assert.deepEqual(guest.history, [])
})
await test('an unexpected input in an introduction remains untouched', async () => {
  const guest = new Guest(); guest.launcher(); guest.accountIntro({ input: 'test-only' })
  assert.equal((await open(guest, 'later')).status, 'blocked'); assert.deepEqual(guest.history, [])
})
await test('ambiguous official launcher buttons cannot be clicked', async () => {
  const guest = new Guest(); guest.launcher(); guest.launcher()
  assert.equal((await open(guest)).status, 'missing'); assert.deepEqual(guest.history, [])
})
for (const change of [button => { button.visible = false }, button => { button.disabled = true }, button => { button.attrs['aria-disabled'] = 'true' }, button => { button.style.visibility = 'hidden' }, button => { button.parent.attrs.inert = '' }]) {
  await test('unavailable settings launcher cannot be clicked', async () => {
    const guest = new Guest(); change(guest.launcher())
    assert.equal((await open(guest)).status, 'missing'); assert.deepEqual(guest.history, [])
  })
}
await test('an unsupported interface reports missing without unrelated clicks', async () => {
  const guest = new Guest(); guest.root.append(guest.track(el('button', { 'aria-label': 'Settings', 'aria-haspopup': 'dialog' }), 'unrelated'))
  assert.equal((await open(guest)).status, 'missing'); assert.deepEqual(guest.history, [])
})
await test('Later waits for the interface instead of finishing on a blank document', async () => {
  const guest = new Guest(); guest.beforeEvaluate = count => { if (count === 3) { guest.launcher(); guest.keyIntro() } }
  assert.equal((await open(guest, 'later')).status, 'opened'); assert.deepEqual(guest.history, ['skip-key'])
})
await test('multi-step settings clicks are performed at most once', async () => {
  const guest = new Guest(); const launcher = guest.launcher(); launcher.onClick = () => { guest.history.push('settings') }
  assert.equal((await open(guest)).status, 'failed'); assert.deepEqual(guest.history, ['settings'])
})
await test('each step rechecks the current foreground permission synchronously', async () => {
  const guest = new Guest(); guest.launcher(); let allowed = true
  guest.beforeAuthorize = () => { if (guest.history.length === 1) allowed = false }
  assert.equal((await open(guest, 'custom', {}, () => allowed)).status, 'cancelled'); assert.deepEqual(guest.history, ['settings'])
})
await test('a pending request cancels promptly and revokes delayed guest clicks', async () => {
  const guest = new Guest(); guest.launcher(); guest.queued = deferred(); guest.entered = deferred()
  const queued = guest.queued; const controller = new AbortController()
  const pending = open(guest, 'custom', { timeoutMs: 1000, signal: controller.signal }, () => !controller.signal.aborted)
  await guest.entered.promise; controller.abort(); assert.equal((await bounded(pending)).status, 'cancelled')
  queued.resolve(); await flush(); assert.deepEqual(guest.history, [])
})
await test('timeout revokes a queued script before it can click after completion', async () => {
  const guest = new Guest(); guest.launcher(); guest.queued = deferred(); const queued = guest.queued
  assert.equal((await bounded(open(guest))).status, 'missing'); queued.resolve(); await flush(); assert.deepEqual(guest.history, [])
})
for (const stop of ['close', 'reload']) {
  await test(`${stop} settles an evaluation that never resolves`, async () => {
    const guest = new Guest(); guest.launcher(); guest.queued = deferred(); guest.entered = deferred()
    const pending = open(guest, 'custom', { timeoutMs: 1000 }); await guest.entered.promise; guest[stop]()
    assert.equal((await bounded(pending)).status, 'cancelled'); assert.deepEqual(guest.history, [])
  })
}
await test('an already aborted request never evaluates', async () => {
  const guest = new Guest(); guest.launcher(); const controller = new AbortController(); controller.abort()
  assert.equal((await open(guest, 'custom', { signal: controller.signal })).status, 'cancelled'); assert.equal(guest.evaluations, 0)
})
await test('a failed evaluation removes listeners and reports a localized error', async () => {
  for (const language of ['zh-CN', 'en-US']) {
    setMainLanguage(language, language)
    const guest = new Guest(); guest.failure = new Error('synthetic guest failure')
    const result = await open(guest)
    assert.equal(result.status, 'failed'); assert.ok(language === 'zh-CN' ? result.message.includes('模型') : result.message.includes('model'))
  }
})
await test('only the four defined choices can reach the guest', async () => {
  const guest = new Guest(); guest.launcher()
  assert.equal((await open(guest, 'delete-provider')).status, 'failed'); assert.equal(guest.evaluations, 0)
})

console.log(`model navigation: ${cases} cases passed`)
