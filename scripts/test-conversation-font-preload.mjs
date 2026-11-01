import assert from 'node:assert/strict'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Execute the actual preload in separate guest contexts. This small DOM records
// stylesheet and listener lifecycles; it does not implement CSS layout, official
// Harness message rendering, or Electron/physical keyboard focus.
const preload = new URL('../src/preload/workspace.ts', import.meta.url)
const themeChannel = 'guest:theme'
let count = 0
function test(name, run) { run(); console.log(`PASS ${name}`); count++ }

class Events {
  listeners = new Map()
  addEventListener(type, listener, options) {
    const rows = this.listeners.get(type) ?? []
    rows.push({ listener, once: typeof options === 'object' && options.once === true })
    this.listeners.set(type, rows)
  }
  emit(type) {
    for (const row of [...(this.listeners.get(type) ?? [])]) {
      if (row.once) this.listeners.set(type, this.listeners.get(type).filter(item => item !== row))
      row.listener({ type })
    }
  }
  counts() { return [...this.listeners].map(([type, rows]) => [type, rows.length]) }
}

class Element extends Events {
  dataset = {}
  children = []
  parentNode = null
  textContent = ''
  style = {
    fontSize: '13px',
    properties: new Map(),
    setProperty(name, value) { this.properties.set(name, value) }
  }
  constructor(tagName) { super(); this.tagName = tagName.toUpperCase() }
  append(child) {
    if (child.parentNode) child.remove()
    this.children.push(child)
    child.parentNode = this
  }
  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter(child => child !== this)
    this.parentNode = null
  }
  querySelectorAll() { return [] }
  focus() { throw new Error('Typography update must not focus an editor') }
  blur() { throw new Error('Typography update must not blur an editor') }
}

function createGuest({ ready = true, systemDark = false } = {}) {
  const document = new Events()
  const head = new Element('head'), root = new Element('html'), body = new Element('body')
  const upstreamStyle = new Element('style')
  upstreamStyle.textContent = '/* Existing Harness stylesheet must remain owned by Harness. */'
  head.append(upstreamStyle)
  const draft = new Element('div')
  draft.textContent = 'Existing draft'
  let queryCount = 0, booted = false
  document.head = head
  document.documentElement = root
  document.body = null
  document.querySelectorAll = () => { queryCount++; return [] }
  Object.defineProperty(document, 'activeElement', {
    get: () => draft,
    set: () => { throw new Error('Typography update must not replace the active editor') }
  })
  document.createElement = tag => {
    assert.equal(tag, 'style', 'Only stylesheets are needed for a theme update')
    return new Element(tag)
  }
  root.style.properties.set('--dsh-content-font-size', '13px')
  body.style.properties.set('--dsh-content-font-size', '12px')
  const window = new Events()
  window.matchMedia = query => {
    assert.equal(query, '(prefers-color-scheme: dark)')
    return { matches: systemDark }
  }
  window.setTimeout = () => { throw new Error('This test does not trigger DOM mutation timers') }
  window.getSelection = () => { throw new Error('Typography update must not read or move selection') }
  window.focus = () => { throw new Error('Typography update must not activate a window') }
  const observers = [], ipcListeners = new Map(), syncCalls = [], sent = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options }
  }
  const ipcRenderer = {
    on(channel, listener) {
      const rows = ipcListeners.get(channel) ?? []
      rows.push(listener); ipcListeners.set(channel, rows)
    },
    sendSync(channel, payload) {
      syncCalls.push([channel, payload])
      assert.equal(channel, 'guest:confirm-send')
      assert.deepEqual(payload, { kind: 'settings' }, 'No send confirmation is requested')
      return { confirmSend: false, confirmQueued: false }
    },
    send(...args) { sent.push(args) }
  }
  createTypeScriptLoader({ electron: { ipcRenderer } }, {
    window, document, MutationObserver, Element, HTMLElement: Element,
    Node: { ELEMENT_NODE: 1 },
    getComputedStyle: () => { throw new Error('Empty test page has no toast to inspect') }
  })(preload)
  const guest = {
    document, window, head, root, body, draft, upstreamStyle, observers, ipcListeners, syncCalls, sent,
    boot() {
      assert.equal(booted, false, 'A document becomes ready only once')
      booted = true; document.body = body; window.emit('DOMContentLoaded')
    },
    update(patch = {}) {
      const payload = { theme: 'light', accent: '#5B8CFF', reduceMotion: false, ...patch }
      for (const listener of ipcListeners.get(themeChannel) ?? []) listener({}, payload)
    },
    listenerSnapshot() {
      return {
        window: window.counts(), document: document.counts(),
        ipc: [...ipcListeners].map(([channel, rows]) => [channel, rows.length]),
        observers: observers.length, queries: queryCount
      }
    }
  }
  if (ready) guest.boot()
  return guest
}

function styles(guest, kind) { return guest.head.children.filter(child => child.dataset.hsInjected === kind) }
function singleStyle(guest, kind) {
  const rows = styles(guest, kind)
  assert.equal(rows.length, 1, `Exactly one ${kind} stylesheet`)
  return rows[0]
}
function assertSize(style, size) {
  assert.match(style.textContent, new RegExp(`--dsh-content-font-size:\\s*${size}px\\s*;`))
  assert.match(style.textContent, new RegExp(`--dsw-font-markdown-base:\\s*${size}px/`))
}
function assertPagePreserved(guest) {
  assert.ok(guest.head.children.includes(guest.upstreamStyle), 'Preserve upstream stylesheet identity')
  assert.equal(guest.upstreamStyle.textContent, '/* Existing Harness stylesheet must remain owned by Harness. */')
  assert.equal(guest.root.style.fontSize, '13px')
  assert.equal(guest.root.style.properties.get('--dsh-content-font-size'), '13px')
  assert.equal(guest.body.style.fontSize, '13px')
  assert.equal(guest.body.style.properties.get('--dsh-content-font-size'), '12px')
  assert.equal(guest.document.activeElement, guest.draft)
  assert.equal(guest.draft.textContent, 'Existing draft')
  assert.deepEqual(guest.sent, [], 'Theme changes do not submit messages or issue navigation IPC')
}

test('Default and legacy theme payloads leave Harness typography in control', () => {
  const guest = createGuest()
  guest.update()
  assert.equal(styles(guest, 'conversation-font').length, 0)
  singleStyle(guest, 'theme')
  assertPagePreserved(guest)
  assert.deepEqual(guest.syncCalls, [['guest:confirm-send', { kind: 'settings' }]])
})

test('Each supported size reaches the real preload through guest:theme', () => {
  for (const size of [14, 16, 18]) {
    const guest = createGuest()
    guest.update({ conversationFontSize: size })
    assertSize(singleStyle(guest, 'conversation-font'), size)
    assert.equal(guest.ipcListeners.get(themeChannel).length, 1)
    assertPagePreserved(guest)
  }
})

test('Follow Harness, missing values and malformed sizes remove only the override', () => {
  for (const size of [0, undefined, null, '16', 15, -1, NaN, Infinity, {}, []]) {
    const guest = createGuest()
    guest.update({ conversationFontSize: 18 })
    const font = singleStyle(guest, 'conversation-font'), theme = singleStyle(guest, 'theme')
    guest.update({ conversationFontSize: size })
    assert.equal(styles(guest, 'conversation-font').length, 0)
    assert.equal(font.parentNode, null, 'Detach the old override')
    assert.equal(singleStyle(guest, 'theme'), theme, 'Retain the other injected style')
    assert.equal(guest.head.children.length, 2)
    assertPagePreserved(guest)
  }
})

test('Selecting a size after reset installs a fresh attached override', () => {
  const guest = createGuest()
  guest.update({ conversationFontSize: 18 })
  const previous = singleStyle(guest, 'conversation-font')
  guest.update({ conversationFontSize: 0 })
  guest.update({ conversationFontSize: 16 })
  const current = singleStyle(guest, 'conversation-font')
  assert.notEqual(current, previous)
  assert.equal(previous.parentNode, null)
  assert.equal(current.parentNode, guest.head)
  assertSize(current, 16)
  assertPagePreserved(guest)
})

test('Repeated and changed sizes reuse one style without multiplying listeners', () => {
  const guest = createGuest()
  guest.update({ conversationFontSize: 14 })
  const font = singleStyle(guest, 'conversation-font'), theme = singleStyle(guest, 'theme')
  const baseline = guest.listenerSnapshot()
  for (const size of Array.from({ length: 48 }, (_, index) => [14, 16, 18, 18][index % 4])) {
    guest.update({ conversationFontSize: size })
    assert.equal(singleStyle(guest, 'conversation-font'), font)
    assert.equal(singleStyle(guest, 'theme'), theme)
    assertSize(font, size)
    assert.equal(guest.head.children.length, 3)
  }
  assert.deepEqual(guest.listenerSnapshot(), baseline)
  assertPagePreserved(guest)
})

test('Appearance changes retain the chosen size and existing preload listeners', () => {
  const guest = createGuest({ systemDark: true })
  guest.update({ conversationFontSize: 16 })
  const font = singleStyle(guest, 'conversation-font'), baseline = guest.listenerSnapshot()
  for (const [theme, expected] of [['dark', 'dark'], ['light', 'light'], ['system', 'dark']]) {
    guest.update({ theme, accent: '#9C27B0', reduceMotion: true, conversationFontSize: 16 })
    assert.equal(guest.root.dataset.hsTheme, expected)
    assert.equal(guest.root.dataset.hsMotion, 'reduce')
    assert.equal(guest.root.style.colorScheme, expected)
    assert.equal(guest.root.style.properties.get('--hs-accent'), '#9C27B0')
    assert.equal(singleStyle(guest, 'conversation-font'), font)
    assertSize(font, 16)
  }
  assert.deepEqual(guest.listenerSnapshot(), baseline)
  assertPagePreserved(guest)
})

test('Separate guest contexts update and reset independently', () => {
  const guests = Array.from({ length: 4 }, () => createGuest())
  for (const guest of guests) guest.update({ conversationFontSize: 18 })
  const fonts = guests.map(guest => singleStyle(guest, 'conversation-font'))
  assert.equal(new Set(fonts).size, 4, 'Each guest owns its stylesheet')
  guests[0].update({ conversationFontSize: 14 })
  guests[1].update({ conversationFontSize: 0 })
  assertSize(fonts[0], 14)
  assert.equal(styles(guests[1], 'conversation-font').length, 0)
  for (const index of [2, 3]) assertSize(fonts[index], 18)
  for (const guest of guests) assertPagePreserved(guest)
})

test('A new guest applies the current setting on its first theme delivery', () => {
  const existing = createGuest()
  existing.update({ conversationFontSize: 18 })
  const originalStyle = singleStyle(existing, 'conversation-font')
  const fresh = createGuest()
  assert.equal(styles(fresh, 'conversation-font').length, 0)
  fresh.update({ conversationFontSize: 18 })
  const freshStyle = singleStyle(fresh, 'conversation-font')
  assert.notEqual(freshStyle, originalStyle)
  assertSize(freshStyle, 18)
  assertSize(originalStyle, 18)
  assertPagePreserved(fresh)
})

test('An early theme delivery survives DOM readiness without a second subscription', () => {
  const guest = createGuest({ ready: false })
  guest.update({ conversationFontSize: 16 })
  const font = singleStyle(guest, 'conversation-font')
  guest.boot()
  assert.equal(singleStyle(guest, 'conversation-font'), font)
  assertSize(font, 16)
  assert.equal(guest.ipcListeners.get(themeChannel).length, 1)
  assert.equal(guest.observers.length, 2)
  assertPagePreserved(guest)
})

test('The override stylesheet stays scoped to conversation text without root font changes', () => {
  const guest = createGuest()
  guest.update({ conversationFontSize: 18 })
  const css = singleStyle(guest, 'conversation-font').textContent.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim())
  assert.ok(selectors.length > 0)
  for (const selector of selectors) {
    assert.ok(selector.startsWith('[data-conversation-content] '), `Unscoped font selector: ${selector}`)
    assert.doesNotMatch(selector, /:root|\bbody\b|\bhtml\b|composer|xterm/)
  }
  assert.ok(selectors.some(selector => selector.includes('[data-chat-flow-kind="user"]')))
  assert.ok(selectors.some(selector => selector.includes('[data-chat-flow-kind="steering"]')))
  assert.ok(selectors.some(selector => selector.includes('[data-chat-flow-kind="assistant-step"]') && selector.includes(':not([data-markdown-variant="compact"])')))
  assertPagePreserved(guest)
})

console.log(`Passed ${count} conversation font preload regressions (DOM/IPC lifecycle and stylesheet scope; no CSS layout or physical keyboard acceptance)`)
