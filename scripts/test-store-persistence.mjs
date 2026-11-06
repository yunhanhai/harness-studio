import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Exercise the production store against files owned by this test. Faults are
// injected at filesystem boundaries; no daily Studio data or Electron is used.
const temporaryRoot = resolve(tmpdir())
const temporary = await fs.mkdtemp(join(temporaryRoot, 'harness-store-persistence-'))
let count = 0
async function test(name, run) {
  await run()
  count++
  console.log(`PASS ${name}`)
}

function fixture(overrides = {}) {
  const load = createTypeScriptLoader({
    electron: { app: {} },
    'node:fs/promises': { ...fs, ...overrides }
  })
  return load(new URL('../src/main/store.ts', import.meta.url))
}
const api = fixture()
const defaults = () => ({ count: 0, nested: { label: 'original' } })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function bounded(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Store operation did not settle')), 3000)
    })])
  } finally { clearTimeout(timer) }
}
const ioError = code => Object.assign(new Error('Injected filesystem failure'), { code })
const diskValue = async file => JSON.parse(await fs.readFile(file, 'utf8'))
async function location(name) {
  const directory = join(temporary, name)
  await fs.mkdir(directory)
  return { directory, file: join(directory, 'state.json') }
}
function persistenceError(api, file, operation, code) {
  return error => {
    assert.ok(error instanceof api.StorePersistenceError)
    assert.equal(error.file, file)
    assert.equal(error.operation, operation)
    if (code) assert.equal(error.code, code)
    assert.ok(!error.message.includes('PRIVATE_FIXTURE_CONTENT'), 'Error must not disclose file content')
    return true
  }
}
function tryMutation(change) {
  try { change() } catch (error) { assert.ok(error instanceof TypeError) }
}
async function onlyStateFile(directory) {
  assert.deepEqual((await fs.readdir(directory)).sort(), ['state.json'], 'No partial temporary file should remain')
}

try {
  await test('Missing files initialize defaults and committed updates survive a new instance', async () => {
    const directory = join(temporary, 'fresh', 'nested')
    const file = join(directory, 'state.json')
    const store = new api.JsonStore(file, defaults)
    assert.deepEqual(await store.load(), defaults())
    await store.update(current => ({ ...current, count: 4 }))
    assert.deepEqual(await new api.JsonStore(file, defaults).load(), { ...defaults(), count: 4 })
    await onlyStateFile(directory)
  })

  await test('Loading an existing valid document preserves its exact bytes until an explicit save', async () => {
    const { file } = await location('read-only-load')
    const original = '{ "count": 8, "nested": { "label": "keep formatting" } }\n'
    await fs.writeFile(file, original)
    const store = new api.JsonStore(file, defaults)
    assert.equal((await store.load()).count, 8)
    assert.equal(await fs.readFile(file, 'utf8'), original)
  })

  await test('A failed application load waits for other initializations before allowing recovery or exit', async () => {
    const directory = await fs.mkdtemp(join(temporary, 'load-settlement-'))
    const entered = deferred(), release = deferred()
    const injected = fixture({ writeFile: async (...args) => {
      if (basename(args[0]) === 'quickask-recent.json') { entered.resolve(); await release.promise }
      return fs.writeFile(...args)
    } })
    const stores = injected.createStores(directory)
    await fs.writeFile(stores.settings.file, 'PRIVATE_FIXTURE_CONTENT corrupt')
    let settled = false
    const loading = injected.loadStores(stores).then(() => { settled = true }, error => { settled = true; return error })
    await bounded(entered.promise)
    try { assert.equal(settled, false) } finally { release.resolve() }
    assert.ok(await bounded(loading) instanceof injected.StorePersistenceError)
    assert.deepEqual(await diskValue(stores.quickAskRecent.file), [])
    assert.equal(await fs.readFile(stores.settings.file, 'utf8'), 'PRIVATE_FIXTURE_CONTENT corrupt')
  })

  await test('All four application stores preserve malformed JSON and block writes until a successful reload', async () => {
    for (const key of ['settings', 'workspaces', 'prompts', 'quickAskRecent']) {
      const directory = join(temporary, 'malformed-' + key)
      await fs.mkdir(directory)
      const store = api.createStores(directory)[key]
      const damaged = '{ "PRIVATE_FIXTURE_CONTENT": "unfinished'
      await fs.writeFile(store.file, damaged)
      const unchangedMemory = store.get()
      await assert.rejects(store.load(), persistenceError(api, store.file, 'load'))
      assert.equal(await fs.readFile(store.file, 'utf8'), damaged)
      assert.deepEqual(store.get(), unchangedMemory)
      for (const save of [() => store.set(unchangedMemory), () => store.update(x => x), () => store.updateSilent(x => x)]) {
        await assert.rejects(save())
        assert.equal(await fs.readFile(store.file, 'utf8'), damaged)
      }
      const repaired = key === 'settings' ? { language: 'en-US' } : []
      await fs.writeFile(store.file, JSON.stringify(repaired))
      const reloaded = await store.load()
      await store.set(reloaded)
      assert.deepEqual(await api.createStores(directory)[key].load(), reloaded)
      assert.deepEqual(await fs.readdir(directory), [basename(store.file)])
    }
  })

  await test('Permission errors preserve existing content and require reload before writes are allowed', async () => {
    const { file, directory } = await location('read-denied')
    const original = JSON.stringify({ ...defaults(), count: 12 })
    await fs.writeFile(file, original)
    let denied = true
    const injected = fixture({ readFile: async (...args) => {
      if (args[0] === file && denied) throw ioError('EACCES')
      return fs.readFile(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await assert.rejects(store.load(), persistenceError(injected, file, 'load', 'EACCES'))
    denied = false
    await assert.rejects(store.set(defaults()))
    assert.equal(await fs.readFile(file, 'utf8'), original)
    assert.equal((await store.load()).count, 12)
    await store.update(x => ({ ...x, count: x.count + 1 }))
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 13)
    await onlyStateFile(directory)
  })

  await test('A failed normalizer preserves the original document and does not initialize defaults', async () => {
    const { file } = await location('normalize-error')
    const original = JSON.stringify({ PRIVATE_FIXTURE_CONTENT: true })
    await fs.writeFile(file, original)
    let invalid = true
    const store = new api.JsonStore(file, defaults, value => {
      if (invalid) throw new Error('PRIVATE_FIXTURE_CONTENT invalid schema')
      return value
    })
    await assert.rejects(store.load(), persistenceError(api, file, 'load'))
    await assert.rejects(store.update(x => ({ ...x, count: 1 })))
    assert.equal(await fs.readFile(file, 'utf8'), original)
    invalid = false
    assert.deepEqual(await store.load(), { PRIVATE_FIXTURE_CONTENT: true })
  })

  await test('A file created after the missing-file read is never replaced by initialization', async () => {
    const { file } = await location('initialize-race')
    const other = { ...defaults(), count: 91 }
    let raced = false
    const injected = fixture({ readFile: async (...args) => {
      try { return await fs.readFile(...args) } catch (error) {
        if (args[0] === file && error.code === 'ENOENT' && !raced) {
          raced = true
          await fs.writeFile(file, JSON.stringify(other))
        }
        throw error
      }
    } })
    const store = new injected.JsonStore(file, defaults)
    const [result] = await Promise.allSettled([store.load()])
    assert.equal(raced, true)
    assert.deepEqual(await diskValue(file), other)
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof injected.StorePersistenceError)
      await store.load()
    }
    assert.deepEqual(store.get(), other)
  })

  await test('Partial temporary writes reject without changing committed state and can be retried', async () => {
    const { file, directory } = await location('partial-write')
    await fs.writeFile(file, JSON.stringify(defaults()))
    let failWrite = true
    const injected = fixture({ writeFile: async (...args) => {
      if (failWrite && args[0] !== file) {
        await fs.writeFile(args[0], 'partial', args[2])
        throw ioError('ENOSPC')
      }
      return fs.writeFile(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await store.load()
    const changes = []
    store.subscribe(value => changes.push(value))
    await assert.rejects(store.set({ ...defaults(), count: 1 }), persistenceError(injected, file, 'save', 'ENOSPC'))
    assert.deepEqual(store.get(), defaults())
    assert.deepEqual(await diskValue(file), defaults())
    assert.deepEqual(changes, [])
    await onlyStateFile(directory)
    failWrite = false
    await store.set({ ...defaults(), count: 2 })
    assert.equal(changes.length, 1)
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 2)
    await onlyStateFile(directory)
  })

  await test('Rename failure preserves disk and memory, suppresses notifications and leaves the queue usable', async () => {
    const { file, directory } = await location('rename-failure')
    await fs.writeFile(file, JSON.stringify(defaults()))
    let failRename = true
    const injected = fixture({ rename: async (...args) => {
      if (args[1] === file && failRename) throw ioError('EPERM')
      return fs.rename(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await store.load()
    const changes = []
    store.subscribe(value => changes.push(value))
    await assert.rejects(store.update(x => ({ ...x, count: 1 })), persistenceError(injected, file, 'save', 'EPERM'))
    assert.deepEqual(store.get(), defaults())
    assert.deepEqual(await diskValue(file), defaults())
    assert.deepEqual(changes, [])
    await onlyStateFile(directory)
    failRename = false
    await store.update(x => ({ ...x, count: x.count + 3 }))
    assert.equal(store.get().count, 3)
    assert.equal(changes.length, 1)
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 3)
  })

  await test('Concurrent normal and silent updates use the latest successful commit without exposing pending state', async () => {
    const { file } = await location('concurrent-updates')
    await fs.writeFile(file, JSON.stringify(defaults()))
    const entered = deferred(), release = deferred()
    let first = true
    const injected = fixture({ rename: async (...args) => {
      if (args[1] === file && first) { first = false; entered.resolve(); await release.promise }
      return fs.rename(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await store.load()
    const changes = []
    store.subscribe(value => changes.push(value.count))
    const one = store.update(x => ({ ...x, count: x.count + 1 }))
    const two = store.updateSilent(x => ({ ...x, count: x.count + 1 }))
    const three = store.update(x => ({ ...x, count: x.count + 1 }))
    await bounded(entered.promise)
    try {
      assert.deepEqual(store.get(), defaults())
      assert.deepEqual(await diskValue(file), defaults())
      assert.deepEqual(changes, [])
    } finally { release.resolve() }
    const values = await bounded(Promise.all([one, two, three]))
    assert.deepEqual(values.map(value => value.count), [1, 2, 3])
    assert.deepEqual(changes, [1, 3])
    assert.equal(store.get().count, 3)
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 3)
  })

  await test('An already queued update recovers after a failed commit and ignores the failed value', async () => {
    const { file, directory } = await location('queue-after-failure')
    await fs.writeFile(file, JSON.stringify(defaults()))
    let first = true
    const injected = fixture({ rename: async (...args) => {
      if (args[1] === file && first) { first = false; throw ioError('EPERM') }
      return fs.rename(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await store.load()
    const changes = []
    store.subscribe(value => changes.push(value.count))
    const results = await bounded(Promise.allSettled([
      store.update(x => ({ ...x, count: 100 })),
      store.update(x => ({ ...x, count: x.count + 1 }))
    ]))
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[1].status, 'fulfilled')
    assert.equal(results[1].value.count, 1)
    assert.deepEqual(changes, [1])
    assert.equal(store.get().count, 1)
    assert.equal((await diskValue(file)).count, 1)
    await onlyStateFile(directory)
  })

  await test('Invalid saves and throwing mutators cannot change memory or prevent a later valid update', async () => {
    const { file, directory } = await location('invalid-update')
    const store = new api.JsonStore(file, defaults)
    await store.load()
    const changes = []
    store.subscribe(value => changes.push(value.count))
    await assert.rejects(store.update(current => {
      current.nested.label = 'uncommitted mutation'
      throw new Error('PRIVATE_FIXTURE_CONTENT bad mutation')
    }), persistenceError(api, file, 'save'))
    await assert.rejects(store.set({ count: 1n, nested: { label: 'not JSON' } }), persistenceError(api, file, 'save'))
    assert.deepEqual(store.get(), defaults())
    assert.deepEqual(await diskValue(file), defaults())
    assert.deepEqual(changes, [])
    await store.update(current => ({ ...current, count: current.count + 1 }))
    assert.deepEqual(changes, [1])
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 1)
    await onlyStateFile(directory)
  })

  await test('Caller and subscriber object aliases cannot mutate committed or queued values', async () => {
    const { file } = await location('aliases')
    const store = new api.JsonStore(file, defaults)
    const loaded = await store.load()
    tryMutation(() => { loaded.nested.label = 'changed load result' })
    const read = store.get()
    tryMutation(() => { read.nested.label = 'changed get result' })
    assert.deepEqual(store.get(), defaults())
    const input = { count: 5, nested: { label: 'submitted' } }
    const pending = store.set(input)
    input.count = 99
    input.nested.label = 'changed set input'
    const result = await pending
    tryMutation(() => { result.nested.label = 'changed save result' })
    assert.deepEqual(store.get(), { count: 5, nested: { label: 'submitted' } })
    let laterSubscriber
    store.subscribe(value => tryMutation(() => { value.count = 500; value.nested.label = 'changed listener value' }))
    store.subscribe(value => { laterSubscriber = value })
    await store.update(x => ({ ...x, count: x.count + 1 }))
    assert.deepEqual(laterSubscriber, { count: 6, nested: { label: 'submitted' } })
    assert.deepEqual(store.get(), laterSubscriber)
    assert.deepEqual(await diskValue(file), laterSubscriber)
  })

  await test('A failed reload locks an already loaded store while preserving the last committed memory', async () => {
    const { file } = await location('failed-reload')
    const store = new api.JsonStore(file, defaults)
    await store.load()
    await store.update(current => ({ ...current, count: 7 }))
    const damaged = '{ PRIVATE_FIXTURE_CONTENT broken'
    await fs.writeFile(file, damaged)
    await assert.rejects(store.load(), persistenceError(api, file, 'load'))
    assert.equal(store.get().count, 7)
    await assert.rejects(store.set(defaults()))
    assert.equal(await fs.readFile(file, 'utf8'), damaged)
    await fs.writeFile(file, JSON.stringify({ ...defaults(), count: 9 }))
    assert.equal((await store.load()).count, 9)
    await store.updateSilent(current => ({ ...current, count: 10 }))
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 10)
  })

  await test('Failed initialization reports the failure without leaving a target or a partial temporary file', async () => {
    const { file, directory } = await location('failed-initialization')
    let denied = true
    const injected = fixture({ writeFile: async (...args) => {
      if (args[0] === file && denied) throw ioError('EACCES')
      return fs.writeFile(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await assert.rejects(store.load(), persistenceError(injected, file, 'load', 'EACCES'))
    assert.deepEqual(await fs.readdir(directory), [])
    await assert.rejects(store.update(current => current))
    denied = false
    assert.deepEqual(await store.load(), defaults())
    await onlyStateFile(directory)
  })

  await test('An interrupted first write preserves its partial file and requires deliberate repair before reuse', async () => {
    const { file } = await location('partial-initialization')
    const partial = '{ "PRIVATE_FIXTURE_CONTENT": "partial'
    let interrupt = true
    const injected = fixture({ writeFile: async (...args) => {
      if (args[0] === file && interrupt) {
        await fs.writeFile(file, partial, args[2])
        throw ioError('ENOSPC')
      }
      return fs.writeFile(...args)
    } })
    const store = new injected.JsonStore(file, defaults)
    await assert.rejects(store.load(), persistenceError(injected, file, 'load', 'ENOSPC'))
    interrupt = false
    await assert.rejects(store.load(), persistenceError(injected, file, 'load'))
    await assert.rejects(store.set(defaults()))
    assert.equal(await fs.readFile(file, 'utf8'), partial)
    await fs.writeFile(file, JSON.stringify(defaults()))
    assert.deepEqual(await store.load(), defaults())
  })

  await test('Wrong document roots are rejected in all application stores without discarding their contents', async () => {
    for (const key of ['settings', 'workspaces', 'prompts', 'quickAskRecent']) {
      for (const value of [null, true, 'PRIVATE_FIXTURE_CONTENT', key === 'settings' ? [] : {}]) {
        const directory = await fs.mkdtemp(join(temporary, 'wrong-root-' + key + '-'))
        const store = api.createStores(directory)[key]
        const original = JSON.stringify(value)
        await fs.writeFile(store.file, original)
        await assert.rejects(store.load(), persistenceError(api, store.file, 'load'))
        await assert.rejects(store.set(store.get()))
        assert.equal(await fs.readFile(store.file, 'utf8'), original)
      }
    }
  })

  await test('A throwing subscriber cannot turn a durable commit into a failed save or block other subscribers', async () => {
    const { file } = await location('subscriber-error')
    const store = new api.JsonStore(file, defaults)
    await store.load()
    const observations = []
    store.subscribe(() => { throw new Error('Subscriber failed') })
    store.subscribe(value => observations.push(value.count))
    assert.equal((await store.update(current => ({ ...current, count: 2 }))).count, 2)
    assert.deepEqual(observations, [2])
    assert.equal((await new api.JsonStore(file, defaults).load()).count, 2)
  })
} finally {
  assert.ok(isAbsolute(temporary))
  assert.equal(dirname(temporary), temporaryRoot)
  assert.ok(basename(temporary).startsWith('harness-store-persistence-'))
  await fs.rm(temporary, { recursive: true, force: true })
}

console.log(`Passed ${count} store persistence regressions; isolated files and injected filesystem faults only`)
