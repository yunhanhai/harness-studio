import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Exercise production settings and the renderer coordinator. No Electron Host,
// credentials, user data directories or model endpoints are involved.
const loadSettings = createTypeScriptLoader({ electron: { app: {} } })
const { DEFAULT_SETTINGS } = loadSettings(new URL('../src/shared/defaults.ts', import.meta.url))
const { createStores, deepMerge, mergeSettings } = loadSettings(new URL('../src/main/store.ts', import.meta.url))
const { translate } = loadSettings(new URL('../src/shared/i18n.ts', import.meta.url))
let passed = 0
const failures = []
async function test(name, run) {
  try { await run(); process.stdout.write(`PASS ${++passed} ${name}\n`) }
  catch (error) { failures.push({ name, error }); process.stderr.write(`FAIL ${name}: ${error.message}\n`) }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
async function bounded(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Model coordinator did not settle')), 500)
    })])
  } finally { clearTimeout(timer) }
}

await test('fresh setup requires a choice; legacy workspace settings migrate without mutation', () => {
  assert.equal(DEFAULT_SETTINGS.modelSetupSeen, false)
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).modelSetupSeen, false)
  const legacy = { lastWorkspaceId: 'previous-project', language: 'en-US', composer: { confirmSend: true }, tabs: { limit: 7 } }
  const snapshot = structuredClone(legacy)
  const migrated = mergeSettings(DEFAULT_SETTINGS, legacy)
  assert.equal(migrated.modelSetupSeen, true)
  assert.equal(migrated.language, 'en-US')
  assert.equal(migrated.composer.confirmSend, true)
  assert.equal(migrated.tabs.limit, 7)
  assert.deepEqual(legacy, snapshot)
  for (const lastWorkspaceId of ['', undefined, null, false, 42, {}, []]) assert.equal(mergeSettings(DEFAULT_SETTINGS, { lastWorkspaceId }).modelSetupSeen, false)
})
await test('only boolean setup completion survives; malformed flags recover using legacy activity', () => {
  for (const seen of [true, false]) {
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { modelSetupSeen: seen, lastWorkspaceId: 'old' }).modelSetupSeen, seen)
  }
  for (const seen of [undefined, null, '', 'true', 'false', 0, 1, {}, [], [true], NaN]) {
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { modelSetupSeen: seen, lastWorkspaceId: 'old' }).modelSetupSeen, true)
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { modelSetupSeen: seen, lastWorkspaceId: '' }).modelSetupSeen, false)
  }
})

const temporaryRoot = resolve(tmpdir())
const temporary = await mkdtemp(join(temporaryRoot, 'harness-model-setup-settings-'))
try {
  await test('completion persists through save and restart; reset requires a fresh explicit choice', async () => {
    const directory = join(temporary, 'fresh')
    const store = createStores(directory).settings
    assert.equal((await store.load()).modelSetupSeen, false)
    await store.update(current => mergeSettings(DEFAULT_SETTINGS, deepMerge(current, { modelSetupSeen: true, language: 'en-US' })))
    assert.equal(JSON.parse(await readFile(store.file, 'utf8')).modelSetupSeen, true)
    const restarted = createStores(directory).settings
    assert.equal((await restarted.load()).modelSetupSeen, true)
    assert.equal(restarted.get().language, 'en-US')
    await restarted.set(mergeSettings(DEFAULT_SETTINGS, { window: restarted.get().window }))
    assert.equal((await createStores(directory).settings.load()).modelSetupSeen, false)
  })
  await test('persisted legacy and malformed completion values normalize and survive subsequent saves', async () => {
    const store = createStores(join(temporary, 'old')).settings
    await store.load()
    const original = structuredClone(DEFAULT_SETTINGS)
    delete original.modelSetupSeen
    original.lastWorkspaceId = 'saved-project'
    original.theme = 'light'
    original.runtime.profile = 'custom-qa'
    await writeFile(store.file, JSON.stringify(original))
    const migrated = createStores(dirname(store.file)).settings
    assert.equal((await migrated.load()).modelSetupSeen, true)
    await migrated.update(current => mergeSettings(DEFAULT_SETTINGS, deepMerge(current, { modelSetupSeen: false })))
    const reloaded = await createStores(dirname(store.file)).settings.load()
    assert.equal(reloaded.modelSetupSeen, false)
    assert.equal(reloaded.lastWorkspaceId, 'saved-project')
    assert.equal(reloaded.theme, 'light')
    assert.equal(reloaded.runtime.profile, 'custom-qa')
    await writeFile(store.file, JSON.stringify({ ...reloaded, modelSetupSeen: 'bogus' }))
    assert.equal((await createStores(dirname(store.file)).settings.load()).modelSetupSeen, true)
  })
} finally {
  assert.ok(isAbsolute(temporary))
  assert.equal(dirname(temporary), temporaryRoot)
  assert.ok(temporary.startsWith(join(temporaryRoot, 'harness-model-setup-settings-')))
  await rm(temporary, { recursive: true, force: true })
}

async function withStore(options, run) {
  const listeners = new Set()
  const timers = new Map()
  const controllers = []
  const calls = []
  const replies = []
  const workspaceReplies = []
  let state, useApp
  let locale = options.locale ?? 'zh-CN'
  const set = (partial, replace = false) => {
    const previous = state
    const next = typeof partial === 'function' ? partial(state) : partial
    state = replace ? next : { ...state, ...next }
    for (const listener of listeners) listener(state, previous)
  }
  const trackedTimeout = (callback, delay, ...args) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(...args) }, delay === 20_000 ? 70 : delay === 90_000 ? 350 : delay)
    timers.set(timer, delay)
    return timer
  }
  const trackedClearTimeout = timer => { timers.delete(timer); clearTimeout(timer) }
  class TrackedAbortController extends AbortController {
    constructor() { super(); controllers.push(this) }
  }
  const load = createTypeScriptLoader({
    zustand: { create: initializer => {
      const store = (selector = value => value) => selector(state)
      store.getState = () => state
      store.setState = set
      store.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
      state = initializer(set, store.getState)
      return store
    } },
    './lib/theme': { applyAppearance() {}, resolveTheme: () => 'dark', watchSystemTheme: () => () => {} },
    './lib/i18n': { applyLanguage() {}, t: (key, params) => translate(locale, key, params) }
  }, {
    window: { studio: { tabs: {
      setActiveGuest: id => calls.push(['active', id]),
      openModels: (id, requestId, choice) => {
        const reply = deferred()
        calls.push(['open-models', id, requestId, choice])
        replies.push({ id, requestId, choice, ...reply })
        return reply.promise
      },
      cancelModels: (id, requestId) => calls.push(['cancel-models', id, requestId]),
      openPlugins: (id, requestId) => { const reply = deferred(); calls.push(['open-plugins', id, requestId]); replies.push({ id, requestId, kind: 'plugins', ...reply }); return reply.promise },
      cancelPlugins: (id, requestId) => calls.push(['cancel-plugins', id, requestId]),
      openWorkspace: (workspaceId, id, path) => { const reply = deferred(); calls.push(['open-workspace', workspaceId, id, path]); workspaceReplies.push(reply); return reply.promise },
      cancelWorkspace: id => calls.push(['cancel-workspace', id])
    }, settings: {
      save: async patch => { calls.push(['save-settings', patch]); return mergeSettings(DEFAULT_SETTINGS, deepMerge(state.settings, patch)) },
      reset: async () => { calls.push(['reset-settings']); return structuredClone(DEFAULT_SETTINGS) }
    } } },
    navigator: { language: 'en-US' },
    setTimeout: trackedTimeout, clearTimeout: trackedClearTimeout, AbortController: TrackedAbortController
  })
  const assertClean = () => {
    assert.equal(listeners.size, 0, 'remove request subscriptions')
    assert.deepEqual([...timers.values()].filter(delay => [15_000, 20_000, 90_000].includes(delay)), [], 'clear request deadlines')
    for (const controller of controllers) assert.equal(getEventListeners(controller.signal, 'abort').length, 0, 'remove request abort listeners')
  }
  try {
    ;({ useApp } = load(new URL('../src/renderer/src/store.ts', import.meta.url)))
    set({ initialized: true, settings: structuredClone(DEFAULT_SETTINGS), info: { systemLocale: locale },
      host: { state: 'ready', url: 'http://127.0.0.1:1/' },
      tabs: [{ id: 'a', seq: 1, title: 'A draft', guestId: 42 }, { id: 'b', seq: 2, title: 'B draft', guestId: 99 }],
      activeTabId: 'a', view: 'home', ...options.state })
    await run({ useApp, calls, replies, workspaceReplies, listeners, assertClean, toasts: () => useApp.getState().toasts,
      setLocale: value => { locale = value }, message: key => translate(locale, key) })
    assertClean()
  } finally {
    useApp?.getState().setView('home')
    for (const reply of workspaceReplies) reply.resolve({ status: 'cancelled' })
    await flush()
    for (const timer of timers.keys()) clearTimeout(timer)
    timers.clear()
  }
}

await test('renderer saves and resets setup state through the production settings actions', async () => {
  await withStore({}, async ({ useApp, calls }) => {
    await useApp.getState().saveSettings({ modelSetupSeen: true })
    assert.equal(useApp.getState().settings.modelSetupSeen, true)
    await useApp.getState().resetSettings()
    assert.equal(useApp.getState().settings.modelSetupSeen, false)
    assert.deepEqual(calls, [['save-settings', { modelSetupSeen: true }], ['reset-settings']])
  })
})
await test('unavailable Hosts preserve the selected page and never issue model IPC', async () => {
  for (const locale of ['zh-CN', 'en-US']) for (const hostState of ['stopped', 'starting', 'error']) {
    await withStore({ locale, state: { host: { state: hostState }, view: 'settings' } }, async ({ useApp, calls, toasts, message }) => {
      assert.equal((await bounded(useApp.getState().openModels('custom'))).status, 'failed')
      assert.equal(useApp.getState().view, 'settings')
      assert.deepEqual(calls, [])
      assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('models.notReady'), kind: 'info' }])
    })
  }
})
await test('cold guest mounting waits for the exact foreground tab and forwards the chosen path', async () => {
  await withStore({ state: { tabs: [{ id: 'a', seq: 1, title: '' }, { id: 'b', seq: 2, title: '', guestId: 99 }] } }, async ({ useApp, calls, replies, listeners }) => {
    const pending = useApp.getState().openModels('account')
    await flush()
    assert.equal(useApp.getState().view, 'workspace')
    assert.deepEqual(calls, [])
    assert.equal(listeners.size, 2)
    useApp.getState().updateTab('a', { guestId: 42 })
    await flush()
    assert.deepEqual(calls, [['active', 42], ['open-models', 42, replies[0].requestId, 'account']])
    replies[0].resolve({ status: 'opened' })
    assert.equal((await bounded(pending)).status, 'opened')
    assert.equal(useApp.getState().tabs[1].title, '')
  })
})
await test('guest replacement between mount resolution and continuation never foregrounds stale identity', async () => {
  await withStore({ state: { tabs: [{ id: 'a', seq: 1, title: '' }] } }, async ({ useApp, calls, toasts }) => {
    const pending = useApp.getState().openModels()
    useApp.getState().updateTab('a', { guestId: 41 })
    useApp.getState().updateTab('a', { guestId: 42 })
    assert.equal((await bounded(pending)).status, 'cancelled')
    assert.deepEqual(calls, [])
    assert.deepEqual(toasts(), [])
  })
})
await test('page/tab/guest/Host changes settle cancellation without a main-process reply or late feedback', async () => {
  const changes = [
    ['page', store => store.getState().setView('skills')],
    ['tab', store => store.getState().activateTab('b')],
    ['close', store => store.getState().closeTab('a')],
    ['guest cleared', store => store.getState().updateTab('a', { guestId: undefined })],
    ['guest replaced', store => store.getState().updateTab('a', { guestId: 43 })],
    ['Host restart', store => store.setState({ host: { state: 'starting' } })]
  ]
  for (const [name, change] of changes) await withStore({}, async ({ useApp, calls, replies, toasts, assertClean }) => {
    const pending = useApp.getState().openModels('custom')
    await flush()
    const requestId = replies[0].requestId
    change(useApp)
    assert.equal((await bounded(pending)).status, 'cancelled', name)
    assert.deepEqual(calls.at(-1), ['cancel-models', 42, requestId])
    assertClean()
    replies[0].reject(new Error('obsolete model navigation'))
    await flush()
    assert.deepEqual(toasts(), [])
  })
})
await test('models and plugins cancel their predecessor, leaving the replacement request intact', async () => {
  await withStore({}, async ({ useApp, calls, replies, listeners }) => {
    const old = useApp.getState().openPlugins()
    await flush()
    const current = useApp.getState().openModels('later')
    await flush()
    await bounded(old)
    assert.ok(calls.some(call => call[0] === 'cancel-plugins' && call[2] === replies[0].requestId))
    replies[0].reject(new Error('late plugin error'))
    await flush()
    assert.equal(listeners.size, 1)
    const replacement = useApp.getState().openModels('custom')
    await flush()
    assert.equal((await bounded(current)).status, 'cancelled')
    assert.ok(calls.some(call => call[0] === 'cancel-models' && call[2] === replies[1].requestId))
    replies[2].resolve({ status: 'opened' })
    assert.equal((await bounded(replacement)).status, 'opened')
  })
})
await test('models cancel a queued workspace switch before it can navigate after guest mounting', async () => {
  await withStore({ state: {
    tabs: [{ id: 'a', seq: 1, title: 'A unchanged' }, { id: 'b', seq: 2, title: 'B untouched', guestId: 99 }],
    workspaces: [{ id: 'project', name: 'Project', path: 'D:/qa-project' }]
  } }, async ({ useApp, calls, replies }) => {
    const workspace = useApp.getState().openWorkspace('project')
    await flush()
    assert.equal(useApp.getState().tabs[0].pendingWorkspaceId, 'project')
    const models = useApp.getState().openModels()
    await flush()
    await bounded(workspace)
    assert.equal(useApp.getState().tabs[0].pendingWorkspaceId, undefined, 'cancelled navigation cannot leave a pending project badge')
    useApp.getState().updateTab('a', { guestId: 42 })
    await flush()
    assert.equal(calls.some(call => call[0] === 'open-workspace'), false)
    assert.deepEqual(calls.filter(call => call[0] === 'open-models').map(call => call[1]), [42])
    replies[0].resolve({ status: 'opened' })
    await bounded(models)
    assert.equal(useApp.getState().tabs[1].title, 'B untouched')
    assert.equal(useApp.getState().tabs[1].guestId, 99)
  })
})
await test('models revoke an in-flight workspace request and ignore its late confirmation', async () => {
  await withStore({ state: { workspaces: [{ id: 'project', name: 'Project', path: 'D:/qa-project' }] } }, async ({ useApp, calls, replies, workspaceReplies }) => {
    const workspace = useApp.getState().openWorkspace('project')
    await flush()
    assert.equal(workspaceReplies.length, 1)
    const models = useApp.getState().openModels('custom')
    await flush()
    assert.ok(calls.some(call => call[0] === 'cancel-workspace' && call[1] === 42))
    workspaceReplies[0].resolve({ status: 'opened', workspaceId: 'project', path: 'D:/qa-project', sessionId: 'obsolete-project' })
    await bounded(workspace)
    assert.equal(useApp.getState().tabs[0].sessionId, undefined)
    assert.equal(useApp.getState().tabs[0].workspaceId, undefined)
    assert.equal(useApp.getState().tabs[0].pendingWorkspaceId, undefined)
    assert.deepEqual(calls.filter(call => call[0] === 'open-models').map(call => call[1]), [42])
    replies[0].resolve({ status: 'opened' })
    await bounded(models)
  })
})
await test('missing guests and missing IPC replies hit one deadline, revoke requests and ignore late results', async () => {
  for (const cold of [false, true]) await withStore({ state: cold ? { tabs: [{ id: 'a', seq: 1, title: '' }] } : {} }, async ({ useApp, calls, replies, toasts, message }) => {
    assert.equal((await bounded(useApp.getState().openModels())).status, 'cancelled')
    assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('models.timeout'), kind: 'error' }])
    if (cold) { useApp.getState().updateTab('a', { guestId: 42 }); await flush(); assert.deepEqual(calls, []) }
    else { replies[0].resolve({ status: 'failed', message: 'late' }); await flush(); assert.equal(toasts().length, 1) }
  })
})
await test('delayed failure feedback follows the current language; successful navigation preserves both tabs', async () => {
  for (const [initial, next] of [['zh-CN', 'en-US'], ['en-US', 'zh-CN']]) await withStore({ locale: initial }, async ({ useApp, replies, setLocale, toasts, message }) => {
    const pending = useApp.getState().openModels('custom')
    await flush()
    setLocale(next)
    replies[0].reject(new Error('IPC failed'))
    assert.equal((await bounded(pending)).status, 'failed')
    assert.deepEqual(toasts().map(({ message, kind }) => ({ message, kind })), [{ message: message('models.failed'), kind: 'error' }])
    assert.deepEqual(useApp.getState().tabs.map(tab => [tab.id, tab.title, tab.guestId]), [['a', 'A draft', 42], ['b', 'B draft', 99]])
  })
})
process.stdout.write(`Passed ${passed} model setup persistence and renderer coordination regression groups.\n`)
assert.equal(failures.length, 0, failures.map(({ name, error }) => `${name}: ${error.message}`).join('\n\n'))
