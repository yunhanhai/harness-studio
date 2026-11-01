import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const load = createTypeScriptLoader({ electron: { app: {} } })
const { DEFAULT_SETTINGS } = load(new URL('../src/shared/defaults.ts', import.meta.url))
const { createStores, deepMerge, mergeSettings } = load(new URL('../src/main/store.ts', import.meta.url))
let count = 0
async function test(name, run) {
  await run()
  console.log(`PASS ${name}`)
  count++
}

function legacySettings() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  delete settings.conversationFontSize
  Object.assign(settings, { theme: 'light', language: 'en-US', lastWorkspaceId: 'saved-workspace' })
  settings.tabs.limit = 7
  settings.runtime.env = { FONT_TEST_VAR: 'preserved' }
  settings.composer.confirmSend = true
  return settings
}

function patchFont(store, size) {
  return store.update(current => mergeSettings(DEFAULT_SETTINGS, deepMerge(current, { conversationFontSize: size })))
}

await test('Legacy settings follow Harness and preserve other preferences without mutating their input', () => {
  const input = legacySettings()
  const snapshot = structuredClone(input)
  const defaults = structuredClone(DEFAULT_SETTINGS)
  const migrated = mergeSettings(DEFAULT_SETTINGS, input)
  assert.equal(migrated.conversationFontSize, 0)
  const { conversationFontSize, ...otherSettings } = migrated
  assert.deepEqual(otherSettings, snapshot)
  assert.deepEqual(input, snapshot)
  assert.deepEqual(DEFAULT_SETTINGS, defaults)
})

await test('Only numeric supported font choices survive settings normalization', () => {
  for (const size of [0, 14, 16, 18]) {
    assert.equal(mergeSettings(DEFAULT_SETTINGS, { conversationFontSize: size }).conversationFontSize, size)
  }
  for (const size of [undefined, null, true, false, -1, 1, 15, 20, 14.5, NaN, Infinity, -Infinity,
    '0', '14', '18px', '18; color:red', {}, [], [18]]) {
    const normalized = mergeSettings(DEFAULT_SETTINGS, { conversationFontSize: size, language: 'en-US' })
    assert.equal(normalized.conversationFontSize, 0, `Unexpected font choice: ${String(size)}`)
    assert.equal(normalized.language, 'en-US')
  }
})

// All persistence checks use a directory created by this test, never app userData.
const temporaryRoot = resolve(tmpdir())
const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'harness-studio-font-test-'))
try {
  await test('A fresh store follows Harness and every supported choice survives a new store instance', async () => {
    const directory = join(temporaryDirectory, 'fresh')
    const store = createStores(directory).settings
    assert.equal((await store.load()).conversationFontSize, 0)
    for (const size of [14, 16, 18, 0]) {
      await patchFont(store, size)
      assert.equal(JSON.parse(await readFile(store.file, 'utf8')).conversationFontSize, size)
      assert.equal((await createStores(directory).settings.load()).conversationFontSize, size)
    }
  })

  await test('An old settings file migrates and persists a font change without losing nested preferences', async () => {
    const directory = join(temporaryDirectory, 'legacy')
    const store = createStores(directory).settings
    await store.load()
    const input = legacySettings()
    await writeFile(store.file, JSON.stringify(input), 'utf8')
    const reloaded = createStores(directory).settings
    assert.equal((await reloaded.load()).conversationFontSize, 0)
    await patchFont(reloaded, 18)
    const expected = { ...input, conversationFontSize: 18 }
    assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), expected)
    assert.deepEqual(await createStores(directory).settings.load(), expected)
  })

  await test('Resetting to follow Harness is persisted and subscribers receive the preserved settings', async () => {
    const directory = join(temporaryDirectory, 'reset')
    const store = createStores(directory).settings
    await store.load()
    const input = { ...legacySettings(), conversationFontSize: 18 }
    await store.set(mergeSettings(DEFAULT_SETTINGS, input))
    const changes = []
    const unsubscribe = store.subscribe(settings => changes.push(structuredClone(settings)))
    try {
      await patchFont(store, 0)
      const expected = { ...input, conversationFontSize: 0 }
      assert.deepEqual(changes, [expected])
      assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')), expected)
      assert.deepEqual(await createStores(directory).settings.load(), expected)
    } finally {
      unsubscribe()
    }
  })

  await test('Malformed persisted font values recover to follow Harness while keeping existing preferences', async () => {
    const directory = join(temporaryDirectory, 'malformed')
    const store = createStores(directory).settings
    await store.load()
    const input = { ...legacySettings(), conversationFontSize: '18; color:red' }
    await writeFile(store.file, JSON.stringify(input), 'utf8')
    const reloaded = createStores(directory).settings
    const recovered = await reloaded.load()
    assert.deepEqual(recovered, { ...input, conversationFontSize: 0 })
    await patchFont(reloaded, 16)
    assert.deepEqual(await createStores(directory).settings.load(), { ...input, conversationFontSize: 16 })
  })
} finally {
  assert.ok(isAbsolute(temporaryDirectory))
  assert.equal(dirname(temporaryDirectory), temporaryRoot)
  assert.ok(temporaryDirectory.startsWith(join(temporaryRoot, 'harness-studio-font-test-')))
  await rm(temporaryDirectory, { recursive: true, force: true })
}

console.log(`Passed ${count} conversation font settings regressions`)
