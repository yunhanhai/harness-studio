import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import vm from 'node:vm'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Exercise the actual guest script and cancellation coordinator without a Host,
// model request, user profile or installed plugin.
const { openPluginPanel } = createTypeScriptLoader()(new URL('../src/main/plugin-navigation.ts', import.meta.url))
const gate = () => {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

class Guest extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.buttons = []
    this.clicks = 0
    this.evaluations = 0
    this.grants = new Map()
    this.queued = null
    this.entered = null
    this.beforeEvaluate = null
    this.beforeAuthorize = null
    this.failure = null
    this.removedGates = 0
  }
  isDestroyed() { return this.destroyed }
  close() { this.destroyed = true; this.emit('destroyed') }
  button(options = {}) {
    const button = {
      label: 'Plugins', nav: true, sidebar: true, visible: true, current: false,
      disabled: false, ariaDisabled: false, inert: false,
      style: { display: 'block', visibility: 'visible' },
      ...options,
      getBoundingClientRect: () => ({ width: button.visible ? 80 : 0, height: button.visible ? 30 : 0 }),
      getAttribute: (name) => name === 'aria-label' ? button.label
        : name === 'aria-current' ? button.current ? 'page' : null
        : name === 'aria-disabled' ? String(button.ariaDisabled) : null,
      closest: (selector) => selector === '[inert]' && button.inert ? {} : null,
      querySelector: (selector) => selector === '[data-slot="sidebar.panellist"]' && button.sidebar ? {} : null,
      click: () => {
        this.clicks++
        if (button.onClick) button.onClick(button)
        else button.current = true
      }
    }
    this.buttons.push(button)
    return button
  }
  async executeJavaScript(code) {
    this.evaluations++
    this.beforeEvaluate?.(this.evaluations, code)
    if (this.failure) throw this.failure
    if (this.queued) {
      const waiting = this.queued
      this.queued = null
      this.entered?.release()
      await waiting.promise
    }
    const document = {
      querySelectorAll: (selector) => {
        assert.equal(selector, 'nav button[aria-label="插件"], nav button[aria-label="Plugins"]')
        return this.buttons.filter((button) => button.nav && ['插件', 'Plugins'].includes(button.label))
      },
      documentElement: { append() {} },
      createElement: () => {
        const element = {
          dataset: {},
          dispatchEvent: (event) => {
            assert.equal(event.type, 'hs-workspace-check')
            this.beforeAuthorize?.()
            element.dataset.hsAllowed = this.grants.get(element.dataset.hsRequest)?.() ? 'true' : 'false'
          },
          remove: () => { this.removedGates++ }
        }
        return element
      }
    }
    return vm.runInNewContext(code, { document, getComputedStyle: (button) => button.style, Event })
  }
}

let sequence = 0
function authorize(guest, guard = () => true) {
  const key = `plugins-${++sequence}`
  const authorization = {
    key, releases: 0,
    valid: () => guest.grants.has(key) && !guest.destroyed && guard(),
    release: () => { authorization.releases++; guest.grants.delete(key) }
  }
  guest.grants.set(key, authorization.valid)
  return authorization
}
async function open(guest, options = {}, guard) {
  const authorization = authorize(guest, guard)
  const result = await openPluginPanel(guest, authorization, { timeoutMs: 45, pollMs: 2, ...options })
  assert.equal(authorization.releases, 1, 'release the click grant exactly once')
  assert.equal(guest.listenerCount('destroyed'), 0, 'remove guest listeners')
  if (options.signal) assert.equal(getEventListeners(options.signal, 'abort').length, 0, 'remove caller abort listeners')
  return result
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
async function bounded(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('navigation did not settle')), 200)
    })])
  } finally { clearTimeout(timer) }
}

let cases = 0
async function test(name, run) {
  await run()
  cases++
  console.log(`PASS ${name}`)
}

for (const label of ['插件', 'Plugins']) {
  await test(`opens and confirms the ${label} sidebar panel`, async () => {
    const guest = new Guest(); guest.button({ label })
    assert.equal((await open(guest)).status, 'opened')
    assert.equal(guest.clicks, 1)
    assert.equal(guest.removedGates, 1)
  })
}
await test('an already selected Plugins panel is idempotent', async () => {
  const guest = new Guest(); guest.button({ current: true })
  assert.equal((await open(guest)).status, 'opened')
  assert.equal(guest.clicks, 0)
  assert.equal(guest.removedGates, 0)
})
for (const options of [
  { disabled: true }, { ariaDisabled: true }, { visible: false }, { inert: true },
  { style: { display: 'none', visibility: 'visible' } },
  { style: { display: 'block', visibility: 'hidden' } },
  { sidebar: false }, { nav: false }, { label: 'Install Plugins' }
]) {
  await test(`rejects an unavailable or unrelated button ${JSON.stringify(options)}`, async () => {
    const guest = new Guest(); guest.button(options)
    assert.equal((await open(guest)).status, 'missing')
    assert.equal(guest.clicks, 0)
  })
}
await test('ambiguous eligible sidebar buttons are never clicked', async () => {
  const guest = new Guest(); guest.button(); guest.button({ label: '插件' })
  assert.equal((await open(guest)).status, 'missing')
  assert.equal(guest.clicks, 0)
})
await test('an unrelated duplicate does not hide the unique official entry', async () => {
  const guest = new Guest(); guest.button(); guest.button({ sidebar: false })
  assert.equal((await open(guest)).status, 'opened')
  assert.equal(guest.clicks, 1)
})
await test('waits for the sidebar entry to become available', async () => {
  const guest = new Guest()
  guest.beforeEvaluate = (count) => { if (count === 2) guest.button() }
  assert.equal((await open(guest)).status, 'opened')
  assert.equal(guest.clicks, 1)
})
await test('waits for selection after one click without repeating the action', async () => {
  const guest = new Guest(); const button = guest.button({ onClick() {} })
  guest.beforeEvaluate = (count, code) => {
    if (count > 1) assert.equal(code.includes('hs-workspace-check'), false, 'confirmation is read-only')
    if (count === 3) button.current = true
  }
  assert.equal((await open(guest)).status, 'opened')
  assert.equal(guest.clicks, 1)
})
await test('a click without confirmed selection is a failure', async () => {
  const guest = new Guest(); guest.button({ onClick() {} })
  assert.equal((await open(guest)).status, 'failed')
  assert.equal(guest.clicks, 1)
})
await test('hiding Chat after clicking does not invalidate confirmation', async () => {
  const guest = new Guest(); let valid = true
  const button = guest.button({ onClick() { valid = false } })
  guest.beforeEvaluate = (count) => { if (count === 2) button.current = true }
  assert.equal((await open(guest, {}, () => valid)).status, 'opened')
  assert.equal(guest.clicks, 1)
})
await test('a guard that expired before the actual click cancels it', async () => {
  const guest = new Guest(); guest.button(); let valid = true
  guest.beforeAuthorize = () => { valid = false }
  assert.equal((await open(guest, {}, () => valid)).status, 'cancelled')
  assert.equal(guest.clicks, 0)
  assert.equal(guest.removedGates, 1)
})
await test('an already aborted request does not evaluate guest JavaScript', async () => {
  const guest = new Guest(); guest.button(); const controller = new AbortController(); controller.abort()
  assert.equal((await open(guest, { signal: controller.signal })).status, 'cancelled')
  assert.equal(guest.evaluations, 0)
})
await test('cancelling queued JavaScript settles and revokes its later click', async () => {
  const guest = new Guest(); guest.button(); guest.queued = gate(); guest.entered = gate()
  const queued = guest.queued; const controller = new AbortController()
  const pending = open(guest, { signal: controller.signal, timeoutMs: 1_000 }, () => !controller.signal.aborted)
  await guest.entered.promise
  controller.abort()
  assert.equal((await bounded(pending)).status, 'cancelled')
  queued.release(); await flush()
  assert.equal(guest.clicks, 0)
})
await test('timeout revokes the grant before delayed JavaScript can execute', async () => {
  const guest = new Guest(); guest.button(); guest.queued = gate(); guest.entered = gate()
  const queued = guest.queued
  assert.equal((await open(guest)).status, 'missing')
  queued.release(); await flush()
  assert.equal(guest.clicks, 0)
})
await test('guest destruction settles an evaluation that never resolves', async () => {
  const guest = new Guest(); guest.button(); guest.queued = gate(); guest.entered = gate()
  const pending = open(guest, { timeoutMs: 1_000 })
  await guest.entered.promise
  guest.close()
  assert.equal((await bounded(pending)).status, 'cancelled')
  assert.equal(guest.clicks, 0)
})
await test('a never resolving guest evaluation has a global deadline', async () => {
  const guest = new Guest(); guest.queued = gate()
  assert.equal((await bounded(open(guest))).status, 'missing')
})
await test('a rejected evaluation reports failure and removes its listeners', async () => {
  const guest = new Guest(); guest.failure = new Error('evaluation failed')
  const controller = new AbortController()
  assert.equal((await open(guest, { signal: controller.signal })).status, 'failed')
  assert.equal(guest.clicks, 0)
})
await test('a cancelled queued request cannot block a newer request', async () => {
  const guest = new Guest(); guest.button(); guest.queued = gate(); guest.entered = gate()
  const queued = guest.queued; const controller = new AbortController()
  const old = open(guest, { signal: controller.signal, timeoutMs: 1_000 }, () => !controller.signal.aborted)
  await guest.entered.promise
  controller.abort()
  assert.equal((await bounded(old)).status, 'cancelled')
  assert.equal((await open(guest)).status, 'opened')
  queued.release(); await flush()
  assert.equal(guest.clicks, 1)
})

// Load the real renderer store without React, a Host or user settings. Keep the
// IPC replies pending until the test explicitly releases them, including after
// cancellation, so the client must settle and clean up independently of main.
const { translate } = createTypeScriptLoader()(new URL('../src/shared/i18n.ts', import.meta.url))
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function withStore(options, run) {
  const listeners = new Set()
  const timers = new Map()
  const controllers = []
  const calls = []
  const replies = []
  let locale = options.locale ?? 'zh-CN'
  let useApp
  const set = (partial, replace = false) => {
    const previous = state
    const next = typeof partial === 'function' ? partial(state) : partial
    state = replace ? next : { ...state, ...next }
    for (const listener of listeners) listener(state, previous)
  }
  let state
  const trackedTimeout = (callback, delay, ...args) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      callback(...args)
    }, delay === 15_000 ? 30 : delay)
    timers.set(timer, delay)
    return timer
  }
  const trackedClearTimeout = (timer) => { timers.delete(timer); clearTimeout(timer) }
  class TrackedAbortController extends AbortController {
    constructor() { super(); controllers.push(this) }
  }
  const load = createTypeScriptLoader({
    zustand: { create: (initializer) => {
      const store = (selector = (value) => value) => selector(state)
      store.getState = () => state
      store.setState = set
      store.subscribe = (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      state = initializer(set, store.getState)
      return store
    } },
    './lib/theme': { applyAppearance() {}, resolveTheme: () => 'dark', watchSystemTheme: () => () => {} },
    './lib/i18n': { applyLanguage() {}, t: (key, params) => translate(locale, key, params) }
  }, {
    window: { studio: { tabs: {
      setActiveGuest: (guestId) => calls.push(['active', guestId]),
      openPlugins: (guestId, requestId) => {
        const reply = deferred()
        calls.push(['open', guestId, requestId])
        replies.push({ guestId, requestId, ...reply })
        return reply.promise
      },
      cancelPlugins: (guestId, requestId) => calls.push(['cancel', guestId, requestId])
    } } },
    setTimeout: trackedTimeout,
    clearTimeout: trackedClearTimeout,
    AbortController: TrackedAbortController
  })
  const assertClean = () => {
    assert.equal(listeners.size, 0, 'remove renderer subscriptions')
    assert.deepEqual([...timers.values()].filter((delay) => delay === 15_000 || delay === 90_000), [], 'clear request and guest deadlines')
    for (const controller of controllers) {
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'remove renderer abort listeners')
    }
  }
  try {
    ;({ useApp } = load(new URL('../src/renderer/src/store.ts', import.meta.url)))
    set({
      initialized: true,
      host: { state: 'ready', url: 'http://127.0.0.1:1/' },
      tabs: [{ id: 'a', seq: 1, title: '', guestId: 42 }, { id: 'b', seq: 2, title: '', guestId: 99 }],
      activeTabId: 'a',
      view: 'home',
      ...options.state
    })
    await run({
      useApp, calls, replies, listeners, assertClean,
      setLocale: (value) => { locale = value },
      message: (key) => translate(locale, key),
      toasts: () => useApp.getState().toasts
    })
    assertClean()
  } finally {
    // A failed assertion must also release any in-flight wait and leave no
    // long guest/toast timers keeping the test process alive.
    useApp?.getState().setView('home')
    await flush()
    for (const timer of timers.keys()) clearTimeout(timer)
    timers.clear()
  }
}

await test('the store keeps its page and reports unavailable Hosts without IPC', async () => {
  for (const locale of ['zh-CN', 'en-US']) {
    for (const hostState of ['stopped', 'starting', 'error']) {
      await withStore({ locale, state: { host: { state: hostState } } }, async ({ useApp, calls, toasts, message }) => {
        await bounded(useApp.getState().openPlugins())
        assert.equal(useApp.getState().view, 'home')
        assert.deepEqual(calls, [])
        assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('core.pluginsNotReady'), kind: 'info' }])
      })
    }
  }
})

await test('a cold store waits for its own guest and foregrounds it before opening Plugins', async () => {
  await withStore({ state: { tabs: [{ id: 'a', seq: 1, title: '' }, { id: 'b', seq: 2, title: '', guestId: 99 }] } }, async ({ useApp, calls, replies, listeners, toasts, assertClean }) => {
    const pending = useApp.getState().openPlugins()
    await flush()
    assert.equal(useApp.getState().view, 'workspace')
    assert.deepEqual(calls, [], 'never fall back to another tab guest')
    assert.equal(listeners.size, 2, 'subscribe to context changes and guest mounting')
    useApp.getState().updateTab('a', { guestId: 42 })
    await flush()
    assert.deepEqual(calls, [['active', 42], ['open', 42, replies[0].requestId]])
    assert.equal(listeners.size, 1)
    replies[0].resolve({ status: 'opened' })
    await bounded(pending)
    assert.deepEqual(toasts(), [])
    assertClean()
  })
  await withStore({ state: { tabs: [{ id: 'a', seq: 1, title: '' }] } }, async ({ useApp, calls, toasts }) => {
    const pending = useApp.getState().openPlugins()
    // The mounting promise has resolved, but its continuation has not run yet.
    // A replaced guest must never be foregrounded or receive plugin navigation.
    useApp.getState().updateTab('a', { guestId: 41 })
    useApp.getState().updateTab('a', { guestId: 42 })
    await bounded(pending)
    assert.deepEqual(calls, [], 'recheck the guest identity after mounting settles')
    assert.deepEqual(toasts(), [])
  })
})

await test('leaving the plugin context cancels and settles even when main never replies', async () => {
  const changes = [
    ['page', (store) => store.getState().setView('settings')],
    ['tab', (store) => store.getState().activateTab('b')],
    ['closed tab', (store) => store.getState().closeTab('a')],
    ['invalid guest', (store) => store.getState().updateTab('a', { guestId: undefined })],
    ['reloaded guest', (store) => store.getState().updateTab('a', { guestId: 43 })],
    ['restarting Host', (store) => store.setState({ host: { state: 'starting' } })],
    ['stopped Host', (store) => store.setState({ host: { state: 'stopped' } })]
  ]
  for (const [name, change] of changes) {
    await withStore({}, async ({ useApp, calls, replies, toasts, assertClean }) => {
      const pending = useApp.getState().openPlugins()
      await flush()
      const { requestId } = replies[0]
      change(useApp)
      assert.deepEqual(calls.at(-1), ['cancel', 42, requestId], name)
      await bounded(pending)
      assertClean()
      replies[0].resolve({ status: 'failed', message: `late ${name}` })
      await flush()
      assert.deepEqual(toasts(), [], `${name} cancellation stays silent`)
      assert.equal(calls.filter(([kind]) => kind === 'cancel').length, 1)
    })
  }
})

await test('replacement requests ignore old resolutions and rejections without cancelling the new request', async () => {
  for (const late of ['resolve', 'reject']) {
    await withStore({}, async ({ useApp, calls, replies, listeners, toasts, assertClean }) => {
      const old = useApp.getState().openPlugins()
      await flush()
      const current = useApp.getState().openPlugins()
      await flush()
      await bounded(old)
      assert.notEqual(replies[0].requestId, replies[1].requestId)
      assert.deepEqual(calls.filter(([kind]) => kind === 'cancel'), [['cancel', 42, replies[0].requestId]])
      if (late === 'resolve') replies[0].resolve({ status: 'failed', message: 'obsolete request' })
      else replies[0].reject(new Error('obsolete request'))
      await flush()
      assert.deepEqual(toasts(), [])
      assert.equal(listeners.size, 1, 'old finally leaves the new subscription intact')
      const replacement = useApp.getState().openPlugins()
      await flush()
      await bounded(current)
      assert.deepEqual(calls.filter(([kind]) => kind === 'cancel'), [
        ['cancel', 42, replies[0].requestId], ['cancel', 42, replies[1].requestId]
      ], 'a later request still cancels exactly its predecessor')
      replies[1].resolve({ status: 'failed', message: 'also obsolete' })
      replies[2].resolve({ status: 'opened' })
      await bounded(replacement)
      assert.deepEqual(toasts(), [])
      assertClean()
    })
  }
})

await test('backend cancellation during a workspace switch is silent in the original tab', async () => {
  await withStore({}, async ({ useApp, calls, replies, toasts }) => {
    const pending = useApp.getState().openPlugins()
    await flush()
    useApp.getState().updateTab('a', { pendingWorkspaceId: 'B' })
    replies[0].resolve({ status: 'cancelled' })
    await bounded(pending)
    assert.equal(useApp.getState().view, 'workspace')
    assert.equal(useApp.getState().activeTabId, 'a')
    assert.deepEqual(toasts(), [])
    assert.equal(calls.filter(([kind]) => kind === 'cancel').length, 0)
  })
})

await test('a guest that never mounts times out once and releases the mounting subscription', async () => {
  await withStore({ state: { tabs: [{ id: 'a', seq: 1, title: '' }, { id: 'b', seq: 2, title: '', guestId: 99 }] } }, async ({ useApp, calls, toasts, message, assertClean }) => {
    await bounded(useApp.getState().openPlugins())
    assert.deepEqual(calls, [])
    assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('core.pluginsTimeout'), kind: 'error' }])
    assertClean()
    useApp.getState().updateTab('a', { guestId: 42 })
    await flush()
    assert.deepEqual(calls, [], 'mounting after the deadline cannot revive the request')
    assert.equal(toasts().length, 1)
  })
})

await test('an IPC reply that never arrives times out once and ignores its later result', async () => {
  for (const late of ['resolve', 'reject']) {
    await withStore({}, async ({ useApp, calls, replies, toasts, message, assertClean }) => {
      await bounded(useApp.getState().openPlugins())
      assert.deepEqual(calls, [['active', 42], ['open', 42, replies[0].requestId], ['cancel', 42, replies[0].requestId]])
      assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('core.pluginsTimeout'), kind: 'error' }])
      assertClean()
      if (late === 'resolve') replies[0].resolve({ status: 'failed', message: 'late failure' })
      else replies[0].reject(new Error('late failure'))
      await flush()
      assert.equal(toasts().length, 1)
    })
  }
})

await test('pending plugin feedback uses the current language while deliberate navigation stays silent', async () => {
  for (const [initial, next] of [['zh-CN', 'en-US'], ['en-US', 'zh-CN']]) {
    for (const outcome of ['failed', 'missing', 'rejected', 'timeout', 'leave']) {
      await withStore({ locale: initial }, async ({ useApp, replies, setLocale, toasts, message }) => {
        const pending = useApp.getState().openPlugins()
        await flush()
        setLocale(next)
        if (outcome === 'leave') useApp.getState().setView('settings')
        else if (outcome === 'rejected') replies[0].reject(new Error('IPC failed'))
        else if (outcome !== 'timeout') replies[0].resolve({ status: outcome })
        await bounded(pending)
        if (outcome === 'leave') assert.deepEqual(toasts(), [])
        else assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{
          message: message(outcome === 'timeout' ? 'core.pluginsTimeout' : 'core.pluginsOpenFailed'), kind: 'error'
        }])
      })
    }
  }
})

console.log(`plugin navigation: ${cases} cases passed`)
