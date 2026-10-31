import assert from 'node:assert/strict'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const load = createTypeScriptLoader({ electron: { app: {} } })
const { messages, normalizeLanguage, resolveLanguage, translate } = load(new URL('../src/shared/i18n.ts', import.meta.url))
const { mergeSettings } = load(new URL('../src/main/store.ts', import.meta.url))
const { DEFAULT_SETTINGS } = load(new URL('../src/shared/defaults.ts', import.meta.url))
let count = 0
function test(name, run) { run(); console.log(`PASS ${name}`); count++ }

test('Follow system maps supported Chinese locales and other OS locales consistently', () => {
  for (const language of ['zh', 'zh-CN', 'zh-TW', 'zh_HK', 'ZH-cn']) assert.equal(resolveLanguage('system', language), 'zh-CN')
  for (const language of ['en-US', 'en-GB', 'de-DE', 'ja-JP', '']) assert.equal(resolveLanguage('system', language), 'en-US')
})
test('Explicit choices override the OS locale and invalid settings fall back to system', () => {
  assert.equal(resolveLanguage('zh-CN', 'en-US'), 'zh-CN')
  assert.equal(resolveLanguage('en-US', 'zh-CN'), 'en-US')
  for (const invalid of [undefined, null, 'fr', 7, {}, []]) {
    assert.equal(normalizeLanguage(invalid), 'system')
    assert.equal(resolveLanguage(invalid, 'zh-CN'), 'zh-CN')
  }
})
test('Persisted settings migrate old files and reject malformed language values', () => {
  assert.equal(mergeSettings(DEFAULT_SETTINGS, {}).language, 'system')
  for (const language of ['system', 'zh-CN', 'en-US']) assert.equal(mergeSettings(DEFAULT_SETTINGS, { language }).language, language)
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { language: { bad: true } }).language, 'system')
  const legacy = mergeSettings(DEFAULT_SETTINGS, { language: 'en-US', lastWorkspaceId: 'keep-me', tabs: { limit: 6 } })
  assert.equal(legacy.lastWorkspaceId, 'keep-me')
  assert.equal(legacy.tabs.limit, 6)
})
test('Every dictionary entry has both translations and matching substitution names', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  assert.ok(Object.keys(messages).length > 0)
  for (const [key, pair] of Object.entries(messages)) {
    assert.equal(pair.length, 2, key)
    for (const value of pair) {
      assert.equal(typeof value, 'string', key)
      assert.ok(value.trim(), `${key} is empty`)
      assert.ok(!value.includes('\uFFFD'), `${key} contains a replacement character`)
    }
    assert.deepEqual(placeholders(pair[0]), placeholders(pair[1]), key)
  }
})
test('Substitutions preserve user text literally and do not interpret replacement patterns', () => {
  const name = '<project> $& {limit} 中文'
  assert.equal(translate('en-US', 'core.workspaceAdded', { name }), `Workspace “${name}” added`)
  assert.match(translate('en-US', 'core.tabLimit', { limit: 6 }), /up to 6 session tabs/)
  assert.match(translate('zh-CN', 'core.tabLimit', { limit: 6 }), /6 个/)
})

let menuTemplate
let trayCreations = 0
class FakeTray {
  events = []
  constructor() { trayCreations++ }
  setToolTip() {}
  setContextMenu(menu) { this.menu = menu }
  on(name, handler) { this.events.push([name, handler]) }
}
const icon = { isEmpty: () => false, resize() { return this } }
const nativeLoad = createTypeScriptLoader({ electron: {
  app: { getAppPath: () => process.cwd(), getVersion: () => 'test' },
  nativeImage: { createFromPath: () => icon }, Tray: FakeTray,
  Menu: { buildFromTemplate: template => template, setApplicationMenu: template => { menuTemplate = template } },
  shell: { openExternal() {} }
} }, { process: { platform: 'darwin' } })
const native = nativeLoad(new URL('../src/main/i18n.ts', import.meta.url))
const trayApi = nativeLoad(new URL('../src/main/tray.ts', import.meta.url))
const menuApi = nativeLoad(new URL('../src/main/menu.ts', import.meta.url))
test('Native send confirmations use the current language and preserve drafts and queue counts', () => {
  native.setMainLanguage('en-US', 'zh-CN')
  const draft = '用户自己的中文草稿 $&'
  assert.equal(native.sendConfirmationCopy(0, draft).detail, draft)
  assert.equal(native.sendConfirmationCopy(0).title, 'Confirm send')
  assert.match(native.sendConfirmationCopy(1).message, /1 queued message\?/)
  assert.match(native.sendConfirmationCopy(3).message, /3 queued messages\?/)
  native.setMainLanguage('system', 'zh-TW')
  assert.equal(native.sendConfirmationCopy(0).title, '确认发送')
  assert.match(native.sendConfirmationCopy(3).message, /3 条排队消息/)
})
test('Tray language updates preserve the existing icon and click handlers', () => {
  const handlers = { show() {}, toggle() {}, openWorkspace() {}, openSettings() {}, logs() {}, restartHost() {}, checkUpdates() {}, quit() {} }
  const tray = trayApi.createTray(handlers)
  assert.equal(tray.menu[0].label, '打开 Harness Studio')
  native.setMainLanguage('en-US', 'zh-CN')
  trayApi.updateTrayMenu(tray, handlers)
  assert.equal(tray.menu[0].label, 'Open Harness Studio')
  native.setMainLanguage('zh-CN', 'en-US')
  trayApi.updateTrayMenu(tray, handlers)
  assert.equal(tray.events.length, 2)
  assert.equal(trayCreations, 1)
})
test('Application menu language updates retain keyboard accelerators', () => {
  const handlers = { openWorkspace() {}, openSettings() {}, openLogs() {}, restartHost() {}, checkUpdates() {}, showAbout() {}, toggleWindow() {}, quit() {} }
  native.setMainLanguage('en-US', 'zh-CN')
  menuApi.installApplicationMenu(handlers)
  assert.equal(menuTemplate[1].label, 'File')
  assert.equal(menuTemplate[1].submenu[0].accelerator, 'Command+O')
  native.setMainLanguage('zh-CN', 'en-US')
  menuApi.installApplicationMenu(handlers)
  assert.equal(menuTemplate[1].label, '文件')
  assert.equal(menuTemplate[1].submenu[0].accelerator, 'Command+O')
})

const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const unsubscribes = []
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: '' } } })
  let notifications = 0
  const rendererLoad = createTypeScriptLoader({ react: {
    useMemo: (make) => make(),
    useSyncExternalStore: (subscribe, snapshot) => { unsubscribes.push(subscribe(() => { notifications++ })); return snapshot() }
  } })
  const renderer = rendererLoad(new URL('../src/renderer/src/lib/i18n.ts', import.meta.url))
  const format = rendererLoad(new URL('../src/renderer/src/lib/format.ts', import.meta.url))
  test('Language subscribers update immediately and unchanged resolved settings do not notify again', () => {
    renderer.useI18n()
    renderer.applyLanguage('en-US', 'zh-CN')
    assert.equal(renderer.getLocale(), 'en-US')
    assert.equal(document.documentElement.lang, 'en-US')
    assert.equal(notifications, 1)
    renderer.applyLanguage('system', 'en-GB')
    assert.equal(notifications, 1)
    renderer.applyLanguage('system', 'zh-TW')
    assert.equal(renderer.getLocale(), 'zh-CN')
    assert.equal(notifications, 2)
    assert.equal(renderer.t('core.hostReady'), '运行中')
  })
  test('Formatting follows the selected locale without changing stored values', () => {
    const timestamp = Date.now() - 65_000
    renderer.applyLanguage('en-US')
    assert.equal(format.relativeTime(), 'Never opened')
    assert.equal(format.relativeTime(timestamp), '1 minute ago')
    assert.equal(format.hostStateLabel('starting'), 'Starting')
    renderer.applyLanguage('zh-CN')
    assert.equal(format.relativeTime(timestamp), '1分钟前')
    assert.equal(format.hostStateLabel('starting'), '启动中')
    assert.equal(format.compactTokens(1_500_000), '1.50M')
  })
} finally {
  for (const unsubscribe of unsubscribes) unsubscribe()
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
  else delete globalThis.navigator
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else delete globalThis.document
}

const previousGlobals = new Map(['navigator', 'document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: '', dataset: {}, style: { setProperty() {} } } } })
  let changed
  let releaseWorkspaces
  const workspaces = new Promise(resolve => { releaseWorkspaces = resolve })
  const off = () => () => {}
  const oldSettings = { ...structuredClone(DEFAULT_SETTINGS), language: 'zh-CN' }
  const api = {
    app: { info: async () => ({ systemLocale: 'zh-CN' }) },
    settings: { get: async () => oldSettings, onChange: callback => { changed = callback; return () => {} } },
    workspaces: { list: () => workspaces, onChange: off },
    prompts: { list: async () => [], onChange: off },
    host: { status: async () => ({ state: 'stopped' }), logs: async () => [], onStatus: off, onLog: off },
    tabs: { onWorkspaceChanged: off },
    runtime: { onInstallProgress: off, detect: async () => ({ state: 'missing', source: null }) },
    studio: { onAction: off, onToast: off }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { studio: api, location: { search: '' } } })
  const bootLoad = createTypeScriptLoader()
  const { useApp } = bootLoad(new URL('../src/renderer/src/store.ts', import.meta.url))
  const booting = useApp.getState().init()
  assert.equal(typeof changed, 'function', 'settings subscription must precede the initial reads')
  changed({ ...oldSettings, language: 'en-US' })
  releaseWorkspaces([])
  await booting
  test('A language change from another window during initialization wins over the old settings snapshot', () => {
    assert.equal(useApp.getState().settings.language, 'en-US')
    assert.equal(document.documentElement.lang, 'en-US')
    assert.equal(useApp.getState().initialized, true)
  })
} finally {
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}
console.log(`Passed ${count} localization regressions`)
