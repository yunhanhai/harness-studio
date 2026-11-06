import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Run the actual main entry point, IPC handlers and recovery loop. Only Electron,
// the Host and operating-system integrations are replaced; JSON files are real
// and belong to this test. No user directories, processes or network are used.
const temporaryRoot = resolve(tmpdir())
const temporary = await fs.mkdtemp(join(temporaryRoot, 'harness-store-main-'))
let count = 0
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(condition) {
  const deadline = Date.now() + 5000
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Main-process operation did not settle')
    await tick()
  }
}
async function test(name, run) { await run(); count++; console.log('PASS ' + name) }
const disk = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function fixture(options = {}) {
  const directory = await fs.mkdtemp(join(temporary, 'case-'))
  const f = { directory, windows: [], messages: [], logs: [], dialogs: [], errorBoxes: [], opened: [], effects: [],
    failures: new Map(), quits: 0, hosts: 0, injections: 0, started: false, injectionStatus: 'sent', beforeRename: null }
  const handlers = new Map(), ipcMain = new EventEmitter(), app = new EventEmitter()
  ipcMain.handle = (channel, callback) => handlers.set(channel, callback)
  Object.assign(app, {
    setName() {}, setPath() {}, setAppUserModelId() {}, getLocale: () => options.systemLocale ?? 'zh-CN',
    getPath: () => directory, getVersion: () => '0.1.12', whenReady: async () => {},
    requestSingleInstanceLock: () => true, isPackaged: false, focus() {},
    quit: () => { f.quits++; app.emit('before-quit', { preventDefault: () => { f.preventedQuit = true } }) }
  })
  const contents = id => Object.assign(new EventEmitter(), {
    id, isDestroyed: () => false, setWindowOpenHandler() {},
    send: (channel, payload) => f.messages.push({ id, channel, payload }),
    setZoomFactor: value => f.effects.push(['zoom', value]), getZoomFactor: () => 1,
    getURL: () => 'http://127.0.0.1:34567/'
  })
  const window = (options = {}) => {
    const win = Object.assign(new EventEmitter(), {
      webContents: contents(f.windows.length + 1), isDestroyed: () => false, isVisible: () => true,
      isMinimized: () => false, restore() {}, show() {}, hide() {}, focus() {}, setSkipTaskbar() {}
    })
    f.windows.push(win)
    if (f.windows.length === 1) f.windowOptions = options
    return win
  }
  const hostState = { state: 'ready', url: 'http://127.0.0.1:34567/', pid: 123, startedAt: 1 }
  const mocks = {
    electron: { app, ipcMain, nativeTheme: { shouldUseDarkColors: true }, globalShortcut: { unregisterAll() {} },
      BrowserWindow: {}, clipboard: { writeText() {} },
      dialog: {
        showMessageBox: async value => { f.dialogs.push(value); return { response: options.choose ? await options.choose(f, value) : 2 } },
        showErrorBox: (title, message) => f.errorBoxes.push({ title, message })
      },
      shell: { openPath: async path => { f.opened.push(path); return options.openError ?? '' } },
      session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) }
    },
    'node:fs/promises': { ...fs, rename: async (...args) => {
      if (f.beforeRename) await f.beforeRename(...args)
      const code = f.failures.get(basename(args[1]))
      if (code) throw Object.assign(new Error('PRIVATE_FIXTURE_CONTENT filesystem detail'), { code })
      return fs.rename(...args)
    } },
    './logger': { log: (scope, message) => f.logs.push([scope, message]), logError: (scope, error) => f.logs.push([scope, String(error)]), logsDirectory: () => join(directory, 'logs') },
    './runtime/detect': { resolveDshHome: () => join(directory, 'dsh'), detectRuntime: async () => {
      f.started = true
      return { state: 'ready', checkedAt: Date.now() }
    } },
    './runtime/host': { HostManager: class {
      constructor() { f.hosts++ }
      onStatus() {} onLog() {} getStatus() { return hostState } getLogs() { return [] }
      canAdoptWorkspace() { return true } adoptWorkspace(value) { hostState.workspaceId = value.workspaceId; return true }
    } },
    './runtime/installer': { RuntimeInstaller: class {} },
    './windows': { createMainWindow: window, createPaletteWindow: window, createQuickAskWindow: window,
      preloadPath: () => '', applyTheme: value => f.effects.push(['theme', value]) },
    './quickask': { injectIntoComposer: async () => { f.injections++; return { status: f.injectionStatus } } },
    './workspace-navigation': { WorkspaceNavigator: class {
      track() {} cancelAll() {} isBusy() { return false }
      authorizeInput() { return { valid: () => true, key: 'fixture', release() {} } }
      async open(_guest, workspace) { return { status: 'opened', workspaceId: workspace.id, path: workspace.path, sessionId: 'session-fixture' } }
    } },
    './session-tab-focus': { SessionTabFocus: class { update() {} restore() {} } },
    './shortcuts': { registerGlobalShortcuts: () => [] },
    './menu': { installApplicationMenu() {} }, './tray': { createTray: () => ({ setToolTip() {} }), updateTrayMenu() {} },
    './updater': { checkForUpdates: async () => ({ status: 'not-available' }) },
    'electron-updater': { autoUpdater: new EventEmitter() },
    './instances': {}, './plugin-navigation': {}, './model-navigation': {}, './sessions': {},
    './skills-ipc': { registerSkillsIpc() {} }
  }
  const fakeProcess = Object.assign(new EventEmitter(), {
    env: {}, argv: [], platform: process.platform, arch: process.arch, pid: process.pid, versions: process.versions
  })
  const load = createTypeScriptLoader(mocks, { process: fakeProcess })
  const storeApi = load(new URL('../src/main/store.ts', import.meta.url))
  const { DEFAULT_SETTINGS } = load(new URL('../src/shared/defaults.ts', import.meta.url))
  f.initial = { ...structuredClone(DEFAULT_SETTINGS), language: options.language ?? 'en-US', checkUpdatesOnStart: false,
    runtime: { ...DEFAULT_SETTINGS.runtime, autoStart: false, dshHome: join(directory, 'dsh') },
    shortcuts: { toggleWindow: '', palette: '', quickAsk: '' } }
  await fs.writeFile(join(directory, 'settings.json'), JSON.stringify(f.initial))
  await fs.writeFile(join(directory, 'workspaces.json'), '[]')
  await fs.writeFile(join(directory, 'prompts.json'), '[]')
  await fs.writeFile(join(directory, 'quickask-recent.json'), '["Previous question"]')
  if (options.prepare) await options.prepare(f)
  mocks['./store'] = { ...storeApi, createStores: path => (f.stores = storeApi.createStores(path)) }
  const { IPC } = load(new URL('../src/shared/channels.ts', import.meta.url))
  f.IPC = IPC
  f.invoke = (key, ...args) => handlers.get(IPC[key])({ sender: f.windows[0].webContents }, ...args)
  f.send = (key, ...args) => ipcMain.emit(IPC[key], { sender: f.windows[0].webContents }, ...args)
  f.toasts = () => f.messages.filter(x => x.id === 1 && x.channel === IPC.toast).map(x => x.payload)
  f.attachGuest = () => {
    const guest = contents(42)
    f.windows[0].webContents.emit('did-attach-webview', {}, guest)
    f.send('tabsActiveGuest', 42)
    return guest
  }
  f.restarted = () => storeApi.createStores(directory)
  load(new URL('../src/main/index.ts', import.meta.url))
  await until(() => f.started || f.quits > 0)
  assert.deepEqual(f.logs.filter(([scope]) => scope === 'bootstrap'), [], 'Unexpected bootstrap failure')
  return f
}

try {
  await test('Corrupt startup files show localized recovery, retain exact bytes and quit before creating windows or a Host', async () => {
    const damaged = '{ "PRIVATE_FIXTURE_CONTENT": "unfinished'
    const f = await fixture({ prepare: f => fs.writeFile(join(f.directory, 'settings.json'), damaged) })
    assert.equal(f.started, false); assert.equal(f.hosts, 0); assert.equal(f.windows.length, 0)
    assert.equal(f.quits, 1); assert.equal(f.preventedQuit, undefined)
    assert.equal(await fs.readFile(f.stores.settings.file, 'utf8'), damaged)
    assert.equal(f.dialogs.length, 1); assert.equal(f.dialogs[0].buttons[0], '重试')
    assert.ok(f.dialogs[0].detail.includes(f.stores.settings.file))
    assert.equal(JSON.stringify([f.dialogs, f.logs]).includes('PRIVATE_FIXTURE_CONTENT'), false)
  })

  await test('Repair and Retry reload all data before startup and honor a readable language preference', async () => {
    const f = await fixture({
      prepare: f => fs.writeFile(join(f.directory, 'prompts.json'), 'PRIVATE_FIXTURE_CONTENT invalid'),
      choose: async f => { await fs.writeFile(join(f.directory, 'prompts.json'), '[]'); return 0 }
    })
    assert.equal(f.dialogs.length, 1); assert.equal(f.dialogs[0].buttons[0], 'Retry')
    assert.equal(f.started, true); assert.equal(f.hosts, 1); assert.equal(f.quits, 0)
    await f.stores.prompts.update(items => [...items, { id: 'repaired', content: 'Retained' }])
    assert.equal((await f.restarted().prompts.load())[0].content, 'Retained')
  })

  await test('An unavailable data folder leaves recovery usable and never discloses raw shell or JSON errors', async () => {
    const damaged = 'PRIVATE_FIXTURE_CONTENT invalid'
    const f = await fixture({
      prepare: f => fs.writeFile(join(f.directory, 'prompts.json'), damaged),
      choose: f => f.dialogs.length === 1 ? 1 : 2,
      openError: 'PRIVATE_FIXTURE_CONTENT shell detail'
    })
    assert.deepEqual(f.opened, [f.directory]); assert.equal(f.dialogs.length, 2)
    assert.equal(f.errorBoxes.length, 1); assert.equal(f.quits, 1)
    assert.equal(await fs.readFile(f.stores.prompts.file, 'utf8'), damaged)
    assert.equal(JSON.stringify([f.dialogs, f.errorBoxes, f.logs]).includes('PRIVATE_FIXTURE_CONTENT'), false)
  })

  await test('Failed settings IPC reports an actionable error and cannot apply or broadcast an uncommitted value; retry persists', async () => {
    const f = await fixture(), before = await fs.readFile(f.stores.settings.file, 'utf8')
    f.messages.length = 0; f.effects.length = 0; f.failures.set('settings.json', 'ENOSPC')
    await assert.rejects(f.invoke('settingsSave', { theme: 'light' }), error => {
      assert.ok(error.message.includes('disk is full')); assert.ok(error.message.includes(f.stores.settings.file))
      assert.equal(error.message.includes('PRIVATE_FIXTURE_CONTENT'), false); return true
    })
    assert.equal(await fs.readFile(f.stores.settings.file, 'utf8'), before)
    assert.deepEqual(f.effects, []); assert.equal(f.messages.length, 0)
    f.failures.clear()
    assert.equal((await f.invoke('settingsSave', { theme: 'light' })).theme, 'light')
    assert.equal((await f.restarted().settings.load()).theme, 'light')
  })

  await test('Concurrent settings saves merge after previous commits and preserve a queued window update', async () => {
    const f = await fixture(), entered = deferred(), release = deferred()
    f.beforeRename = async () => { f.beforeRename = null; entered.resolve(); await release.promise }
    const first = f.invoke('settingsSave', { theme: 'light' })
    await entered.promise
    const second = f.invoke('settingsSave', { language: 'zh-CN' })
    const shortcutA = f.invoke('settingsSave', { shortcuts: { toggleWindow: 'Control+Alt+H' } })
    const shortcutB = f.invoke('settingsSave', { shortcuts: { palette: 'Control+Alt+K' } })
    f.windowOptions.onBounds({ width: 1410, height: 900 })
    assert.equal(f.stores.settings.get().theme, f.initial.theme)
    release.resolve()
    await Promise.all([first, second, shortcutA, shortcutB])
    await until(() => f.stores.settings.get().window.width === 1410)
    const saved = await f.restarted().settings.load()
    assert.equal(saved.theme, 'light'); assert.equal(saved.language, 'zh-CN'); assert.equal(saved.window.width, 1410)
    assert.deepEqual(saved.shortcuts, { toggleWindow: 'Control+Alt+H', palette: 'Control+Alt+K', quickAsk: '' })
  })

  await test('Theme, zoom and window-bound failures are visible without changing committed settings or appearance', async () => {
    const f = await fixture()
    f.messages.length = 0; f.effects.length = 0; f.failures.set('settings.json', 'EPERM')
    f.send('runAction', { type: 'toggle-theme' }); f.send('zoomSet', 1.5)
    f.windowOptions.onBounds({ width: 1700, height: 1000 })
    await until(() => f.toasts().length === 3)
    assert.ok(f.toasts().every(item => item.kind === 'error' && item.sticky && item.message.includes('permissions')))
    assert.deepEqual(f.effects, []); assert.deepEqual(f.stores.settings.get(), f.initial)
    assert.deepEqual(await disk(f.stores.settings.file), f.initial)
    f.failures.clear(); f.send('zoomSet', 1.25)
    await until(() => f.effects.some(([kind, value]) => kind === 'zoom' && value === 1.25))
    assert.equal((await f.restarted().settings.load()).zoomFactor, 1.25)
  })

  await test('Workspace mutations remain accurately reported when only the recent-workspace setting fails', async () => {
    const f = await fixture(); f.failures.set('settings.json', 'EPERM')
    const workspace = await f.invoke('workspacesAdd', f.directory)
    assert.equal(f.toasts().length, 1); assert.equal((await f.restarted().workspaces.load()).length, 1)
    assert.ok(f.messages.some(x => x.channel === f.IPC.workspacesChanged && x.payload[0]?.id === workspace.id))
    assert.equal((await f.invoke('workspacesAdd', f.directory)).id, workspace.id)
    assert.deepEqual(await f.invoke('workspacesRemove', workspace.id), [])
    assert.deepEqual(await f.restarted().workspaces.load(), []); assert.equal(f.toasts().length, 2)
  })

  await test('Concurrent additions cannot create duplicate bookmarks and primary write failures retain the list', async () => {
    const f = await fixture()
    const results = await Promise.all([f.invoke('workspacesAdd', f.directory), f.invoke('workspacesAdd', f.directory)])
    assert.equal(results[0].id, results[1].id); assert.equal((await f.restarted().workspaces.load()).length, 1)
    f.failures.set('workspaces.json', 'ENOSPC'); f.messages.length = 0
    await assert.rejects(f.invoke('workspacesRemove', results[0].id), /disk is full/)
    assert.equal((await f.restarted().workspaces.load()).length, 1)
    assert.equal(f.messages.some(x => x.channel === f.IPC.workspacesChanged), false)
  })

  await test('A completed workspace navigation still succeeds if its recent-project metadata cannot be saved', async () => {
    const f = await fixture(), workspace = await f.invoke('workspacesAdd', f.directory)
    f.attachGuest(); f.failures.set('settings.json', 'ENOSPC'); f.failures.set('workspaces.json', 'ENOSPC')
    const result = await f.invoke('tabsOpenWorkspace', workspace.id, 42)
    assert.equal(result.status, 'opened'); assert.equal(result.sessionId, 'session-fixture')
    assert.equal(f.toasts().length, 2)
    assert.equal((await f.invoke('hostStart', workspace.id)).state, 'ready')
  })

  await test('Quick Ask reports sent or inserted after history-write failure and never repeats the input', async () => {
    for (const status of ['sent', 'inserted']) {
      const f = await fixture(); f.attachGuest(); f.injectionStatus = status
      f.failures.set('quickask-recent.json', 'ENOSPC')
      const result = await f.invoke('quickAskSubmit', 'PRIVATE_FIXTURE_CONTENT question', { autoSend: status === 'sent' })
      assert.equal(result.status, status); assert.equal(f.injections, 1)
      assert.deepEqual(await f.restarted().quickAskRecent.load(), ['Previous question'])
      const warning = f.toasts().find(item => item.kind === 'error')
      assert.ok(warning.sticky); assert.ok(warning.message.includes(status === 'sent' ? 'question was sent' : 'text was inserted'))
      assert.equal(JSON.stringify([f.toasts(), f.logs]).includes('PRIVATE_FIXTURE_CONTENT'), false)
    }
  })
} finally {
  assert.equal(dirname(temporary), temporaryRoot)
  assert.ok(basename(temporary).startsWith('harness-store-main-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
console.log(`Passed ${count} main-process persistence regression groups`)
