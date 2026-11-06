import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const loadShared = createTypeScriptLoader()
const { DEFAULT_SETTINGS } = loadShared(new URL('../src/shared/defaults.ts', import.meta.url))
let count = 0
async function test(name, run) { await run(); count++; console.log('PASS ' + name) }

await test('Preload preserves successful results and shows actionable IPC errors without transport prefixes', async () => {
  let api, failure
  const result = { theme: 'light' }
  const load = createTypeScriptLoader({ electron: {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value } },
    ipcRenderer: { invoke: async () => { if (failure) throw failure; return result } }
  } })
  load(new URL('../src/preload/index.ts', import.meta.url))
  assert.equal(await api.settings.save({ theme: 'light' }), result)
  failure = new Error("Error invoking remote method 'settings:save': Error: Unable to save\nRetained previous data")
  await assert.rejects(api.settings.save({}), error => { assert.equal(error.message, 'Unable to save\nRetained previous data'); return true })
  failure = new Error('Unrelated connection failure')
  await assert.rejects(api.settings.save({}), error => error === failure)
})

// Execute production store actions against rejected/successful IPC replies.
// No Electron process, user files, credentials or network calls are involved.
function fixture() {
  let state
  const effects = [], calls = [], failures = new Set()
  const ipc = async (operation, value) => {
    calls.push([operation, value])
    if (failures.has(operation)) throw new Error('Unable to save fixture state')
    return value
  }
  const load = createTypeScriptLoader({
    zustand: { create: initializer => {
      const store = (selector = x => x) => selector(state)
      store.getState = () => state
      store.setState = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
      store.subscribe = () => () => {}
      state = initializer(store.setState, store.getState)
      return store
    } },
    './lib/theme': { applyAppearance: value => effects.push(['appearance', value]), resolveTheme: () => 'dark', watchSystemTheme: () => () => {} },
    './lib/i18n': { applyLanguage: value => effects.push(['language', value]), t: key => key }
  }, {
    window: { studio: {
      settings: {
        save: patch => ipc('settings.save', { ...state.settings, ...patch }),
        reset: () => ipc('settings.reset', structuredClone(DEFAULT_SETTINGS))
      },
      prompts: {
        save: input => ipc('prompts.save', input), remove: id => ipc('prompts.remove', id), use: id => ipc('prompts.use', id)
      },
      workspaces: { remove: id => ipc('workspaces.remove', id), update: (id, patch) => ipc('workspaces.update', { id, patch }) },
      clipboard: { write: text => ipc('clipboard.write', text) },
      tabs: { cancelWorkspace: id => calls.push(['cancelWorkspace', id]) }
    } },
    navigator: { language: 'en-US' },
    // Toast expiry is irrelevant here and must not keep the test process alive.
    setTimeout: () => 0, clearTimeout: () => {}
  })
  const { useApp } = load(new URL('../src/renderer/src/store.ts', import.meta.url))
  useApp.setState({ settings: structuredClone(DEFAULT_SETTINGS), info: { systemLocale: 'en-US' },
    tabs: [{ id: 'a', seq: 1, title: 'Retained draft', guestId: 42, workspaceId: 'w', pendingWorkspaceId: 'w' }],
    workspaces: [{ id: 'w', name: 'Project', path: 'D:/fixture' }],
    prompts: [{ id: 'p', title: 'Saved prompt', content: 'Retain this', tags: [], usageCount: 1 }] })
  return { useApp, failures, effects, calls, errors: () => state.toasts.filter(t => t.kind === 'error'), successes: () => state.toasts.filter(t => t.kind === 'success') }
}

await test('Settings save failure reports false and keeps the committed settings and appearance', async () => {
  const f = fixture(), original = structuredClone(f.useApp.getState().settings)
  f.failures.add('settings.save')
  assert.equal(await f.useApp.getState().saveSettings({ theme: 'light' }), false)
  assert.deepEqual(f.useApp.getState().settings, original)
  assert.deepEqual(f.effects, [])
  assert.equal(f.errors().length, 1); assert.equal(f.successes().length, 0)
  f.failures.clear()
  assert.equal(await f.useApp.getState().saveSettings({ theme: 'light' }), true)
  assert.equal(f.useApp.getState().settings.theme, 'light')
  assert.ok(f.effects.some(([name]) => name === 'appearance'))
})

await test('Reset failure preserves settings and cannot emit a success toast; retry succeeds', async () => {
  const f = fixture()
  f.useApp.setState({ settings: { ...DEFAULT_SETTINGS, theme: 'light' } })
  f.failures.add('settings.reset')
  assert.equal(await f.useApp.getState().resetSettings(), false)
  assert.equal(f.useApp.getState().settings.theme, 'light')
  assert.deepEqual(f.effects, []); assert.equal(f.successes().length, 0)
  f.failures.clear()
  assert.equal(await f.useApp.getState().resetSettings(), true)
  assert.deepEqual(f.useApp.getState().settings, DEFAULT_SETTINGS)
  assert.equal(f.successes().length, 1)
})

await test('Failed workspace writes leave tab associations and stored workspaces intact', async () => {
  const f = fixture(), tabs = structuredClone(f.useApp.getState().tabs), workspaces = structuredClone(f.useApp.getState().workspaces)
  f.failures.add('workspaces.remove'); f.failures.add('workspaces.update')
  await f.useApp.getState().removeWorkspace('w')
  await f.useApp.getState().updateWorkspace('w', { pinned: true })
  assert.deepEqual(f.useApp.getState().tabs, tabs)
  assert.deepEqual(f.useApp.getState().workspaces, workspaces)
  assert.equal(f.calls.some(([name]) => name === 'cancelWorkspace'), false)
  assert.equal(f.errors().length, 2); assert.equal(f.successes().length, 0)
})

await test('Prompt save, delete and usage failures are visible without success or list mutation', async () => {
  const f = fixture(), prompt = f.useApp.getState().prompts[0], before = structuredClone(f.useApp.getState().prompts)
  for (const operation of ['prompts.save', 'prompts.remove', 'prompts.use']) f.failures.add(operation)
  assert.equal(await f.useApp.getState().savePrompt({ ...prompt, content: 'New draft' }), false)
  assert.equal(await f.useApp.getState().deletePrompt('p'), false)
  await f.useApp.getState().usePrompt(prompt)
  assert.deepEqual(f.useApp.getState().prompts, before)
  assert.equal(f.errors().length, 3); assert.equal(f.successes().length, 0)
  assert.ok(f.calls.some(([name]) => name === 'clipboard.write'), 'Copy can succeed even if usage persistence fails')
})

// Render production page functions into plain JSX records. Hook state persists
// between renders so failed saves can be checked for modal/draft preservation.
function pageFixture(page, overrides = {}, initialHooks = [], globals = {}) {
  const hooks = [...initialHooks], effects = [], calls = []
  let cursor = 0, succeeds = false
  const settings = structuredClone(DEFAULT_SETTINGS)
  const state = {
    settings, info: { systemLocale: 'en-US' }, settingsSection: 'runtime', host: { state: 'ready' },
    runtime: null, workspaces: [], prompts: [], logs: [], instances: null, instancesLoading: false,
    saveSettings: async patch => { calls.push(['save', patch]); if (succeeds) state.settings = { ...state.settings, ...patch }; return succeeds },
    resetSettings: async () => { calls.push(['reset']); return succeeds },
    savePrompt: async value => { calls.push(['save-prompt', value]); return succeeds },
    deletePrompt: async id => { calls.push(['delete-prompt', id]); return succeeds },
    refreshRuntime: async () => { calls.push(['detect']) },
    toast: (...args) => effects.push(args), ...overrides
  }
  const useApp = selector => selector(state)
  useApp.getState = () => state
  const component = () => null
  const react = {
    useState: initial => {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
    },
    useEffect: () => {}, useMemo: callback => callback(), useRef: value => ({ current: value })
  }
  const shared = createTypeScriptLoader()
  const file = fileURLToPath(new URL('../src/renderer/src/' + (page === 'Palette' ? 'components/' : 'pages/') + page + '.tsx', import.meta.url))
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText
  const exports = {}
  const require = name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' }
    if (name === '../store') return { useApp }
    if (name === '../lib/i18n') return { t: key => key, useI18n: () => ({ locale: 'en-US', t: key => key }) }
    if (name === '../lib/format') return { sourceLabel: () => 'fixture' }
    if (name === '@shared/defaults') return shared(new URL('../src/shared/defaults.ts', import.meta.url))
    return new Proxy({}, { get: () => component })
  }
  new Function('exports', 'require', ...Object.keys(globals), compiled)(exports, require, ...Object.values(globals))
  const render = () => { cursor = 0; return exports[page === 'Settings' ? 'SettingsPage' : page === 'Palette' ? 'default' : 'Prompts']() }
  const nodes = value => {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object' || !value.props) return []
    return [value, ...Object.values(value.props).flatMap(nodes)]
  }
  const button = label => {
    const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : ''
    const found = nodes(render()).find(node => node.type === 'button' && text(node.props.children) === label)
    assert.ok(found, 'Button ' + label + ' must exist')
    return found
  }
  return { state, hooks, effects, calls, render, nodes, button, succeed: () => { succeeds = true } }
}

await test('Runtime, advanced and insights page saves show success only after a true result', async () => {
  for (const [section, label, message] of [
    ['runtime', 'pages.settings.saveRuntime', 'pages.settings.runtimeSaved'],
    ['advanced', 'pages.settings.saveAdvanced', 'pages.settings.advancedSaved'],
    ['insights', 'pages.settings.save', 'pages.settings.insightsSaved']
  ]) {
    const f = pageFixture('Settings', { settingsSection: section })
    // Runtime/advanced event callbacks explicitly void the Promise. Flush their
    // continuation without depending on real timers or IPC.
    f.button(label).props.onClick(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls.some(([name]) => name === 'save'), true)
    assert.equal(f.calls.some(([name]) => name === 'detect'), false)
    assert.deepEqual(f.effects, [])
    f.succeed()
    f.button(label).props.onClick(); await new Promise(resolve => setImmediate(resolve))
    assert.ok(f.effects.some(([text, kind]) => text === message && kind === 'success'))
    if (section === 'runtime') assert.equal(f.calls.some(([name]) => name === 'detect'), true)
  }
})

await test('Failed settings reset keeps confirmation open for retry', async () => {
  const f = pageFixture('Settings')
  f.render(); f.hooks[4] = true
  await f.button('pages.settings.restoreDefaults').props.onClick()
  assert.equal(f.hooks[4], true)
  f.succeed(); await f.button('pages.settings.restoreDefaults').props.onClick()
  assert.equal(f.hooks[4], false)
})

await test('Failed prompt save and delete retain their editor and confirmation state', async () => {
  const draft = { title: 'Unsaved title', content: 'Unsaved text', tags: 'one, two' }
  const f = pageFixture('Prompts', {}, ['', draft, null, false])
  f.button('shell.createPrompt').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.hooks[1], draft); assert.equal(f.hooks[3], false)
  f.succeed(); f.button('shell.createPrompt').props.onClick(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.hooks[1], null)
  const pending = { id: 'p', title: 'Retain prompt' }
  const deletion = pageFixture('Prompts', {}, ['', null, pending, false])
  await deletion.button('shell.delete').props.onClick()
  assert.deepEqual(deletion.hooks[2], pending)
  deletion.succeed(); await deletion.button('shell.delete').props.onClick()
  assert.equal(deletion.hooks[2], null)
})

await test('Palette usage failures reach the main notification surface without an unhandled rejection', async () => {
  const effects = []
  const prompt = { id: 'fixture', title: 'Unique prompt fixture', content: 'Fixture contents', tags: [] }
  const f = pageFixture('Palette', {}, [prompt.title, 0, structuredClone(DEFAULT_SETTINGS), [], [prompt]], {
    window: { studio: {
      clipboard: { write: async value => effects.push(['copy', value]) },
      prompts: { use: async () => { throw new Error('Usage could not be saved') } },
      studio: { closePalette: () => effects.push(['close']), toast: (...args) => effects.push(['toast', ...args]) }
    } }
  })
  const item = f.nodes(f.render()).find(node => node.props.role === 'option')
  assert.ok(item)
  item.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(effects, [['close'], ['copy', prompt.content], ['toast', 'Usage could not be saved', 'error']])
})

await test('Shortcut blur failures restore committed values while preserving newer edits and omitting stale sibling shortcuts', async () => {
  for (const newer of [false, true]) {
    let settle, patch
    const f = pageFixture('Settings', { settingsSection: 'general', saveSettings: value => {
      patch = value
      return new Promise(resolve => { settle = resolve })
    } })
    const input = { value: 'Control+Alt+Q' }
    const control = f.nodes(f.render()).find(node => node.type === 'input' && node.props.defaultValue === DEFAULT_SETTINGS.shortcuts.toggleWindow)
    assert.ok(control)
    control.props.onBlur({ currentTarget: input })
    assert.deepEqual(patch, { shortcuts: { toggleWindow: 'Control+Alt+Q' } })
    if (newer) input.value = 'Control+Alt+R'
    settle(false); await new Promise(resolve => setImmediate(resolve))
    assert.equal(input.value, newer ? 'Control+Alt+R' : DEFAULT_SETTINGS.shortcuts.toggleWindow)
  }
})

console.log('Passed ' + count + ' renderer persistence regression groups')
