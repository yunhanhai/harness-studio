import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

// Run the real navigation coordinator with independently controlled Host and
// guest lifetimes. No Electron, user profile or model credentials are needed.
const source = await readFile(new URL('../src/main/workspace-navigation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exported = {}
new Function('exports', 'require', compiled)(exported, createRequire(import.meta.url))
const { WorkspaceNavigator } = exported
const project = (id) => ({ id, path: `D:/projects/${id}`, name: id })
const projects = ['A', 'B', 'C'].map(project)
const gate = () => {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

class Guest extends EventEmitter {
  constructor(id, path = project('A').path) {
    super()
    this.id = id
    this.destroyed = false
    this.selected = `initial-${id}`
    this.sessions = new Map([[this.selected, path]])
    this.registry = new Map()
    this.actions = []
    this.nextGate = null
    this.entered = null
    this.failed = false
    this.visibleSessions = true
    this.sequence = 0
    this.authorize = () => false
    this.actionGate = null
    this.actionEntered = null
  }
  isDestroyed() { return this.destroyed }
  row(key, onClick, buttons = []) {
    return {
      getAttribute: (name) => name === 'data-row-key' ? key : name === 'aria-expanded' ? 'true' : null,
      querySelectorAll: () => buttons,
      click: onClick
    }
  }
  async executeJavaScript(code) {
    if (this.destroyed) throw new Error('guest destroyed')
    if (code.includes('hs-workspace-check') && this.actionGate) {
      const waiting = this.actionGate
      this.actionGate = null
      this.actionEntered?.release()
      await waiting.promise
    }
    const roots = [{ getBoundingClientRect: () => ({ width: 100, height: 100 }), getAttribute: () => this.selected }]
    const rows = [...this.registry.entries()].map(([key, path]) => this.row(`workspace:${key}`, () => {}, [{
      getAttribute: () => '新建会话', disabled: false,
      click: () => {
        const id = `new-${this.id}-${++this.sequence}`
        this.actions.push({ kind: 'new', path, id })
        this.sessions.set(id, path)
        this.selected = id
      }
    }]))
    if (this.visibleSessions) for (const [id, path] of this.sessions) rows.push(this.row(`session:${id}`, () => {
      this.actions.push({ kind: 'restore', path, id })
      this.selected = id
    }))
    const document = {
      querySelectorAll: (selector) => selector.includes('data-conversation-content') ? roots : selector === '[data-row-key]' ? rows : [],
      documentElement: { append() {} },
      createElement: () => {
        const gate = { dataset: {}, remove() {}, dispatchEvent: () => { gate.dataset.hsAllowed = this.authorize(gate.dataset.hsRequest) ? 'true' : 'false' } }
        return gate
      }
    }
    const fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      const args = body.payload.args
      if (body.method === 'workspace/create') {
        if (this.failed) throw new Error('registration failed')
        const paused = this.nextGate
        this.nextGate = null
        this.entered?.release()
        if (paused) await paused.promise
        const path = args.request.path
        const workspaceId = path.split('/').at(-1)
        this.registry.set(workspaceId, path)
        return { ok: true, json: async () => ({ rpcId: body.rpcId, result: { ok: true, value: { workspace: { workspaceId, path } } } }) }
      }
      assert.equal(body.method, 'session/list')
      assert.deepEqual(args, { _request: {} }, 'use the actual Host argument name')
      return { ok: true, json: async () => ({ rpcId: body.rpcId, result: { ok: true, value: { items: [...this.sessions].map(([sessionId, cwd]) => ({ sessionId, cwd })) } } }) }
    }
    return vm.runInNewContext(code, { document, fetch, crypto: { randomUUID }, AbortSignal, Event })
  }
  close() { this.destroyed = true; this.emit('destroyed') }
  reload() { this.emit('did-start-navigation', {}, 'same-url', false, true) }
}

function setup() {
  let ready = true
  const changed = []
  const navigation = new WorkspaceNavigator(() => projects, () => ready, (state) => changed.push(state))
  const guest = new Guest(1)
  navigation.track(guest)
  guest.authorize = (key) => navigation.authorize(guest, key)
  return { navigation, guest, changed, setReady: (value) => { ready = value } }
}
let cases = 0
async function test(name, run) {
  await run()
  cases++
  console.log(`PASS ${name}`)
}

await test('opens and confirms the actual session cwd', async () => {
  const { navigation, guest, changed } = setup()
  const result = await navigation.open(guest, project('B'))
  assert.equal(result.status, 'opened')
  assert.equal(result.path, project('B').path)
  assert.equal(result.sessionId, guest.selected)
  assert.equal(changed.at(-1).workspaceId, 'B')
})
await test('newer target cancels a delayed registration before its click', async () => {
  const { navigation, guest } = setup()
  guest.nextGate = gate(); guest.entered = gate()
  const paused = guest.nextGate
  const old = navigation.open(guest, project('B'))
  await guest.entered.promise
  const latest = navigation.open(guest, project('C'))
  paused.release()
  assert.equal((await old).status, 'cancelled')
  assert.equal((await latest).status, 'opened')
  assert.deepEqual(guest.actions.map((x) => x.path), [project('C').path])
})
await test('different guests keep independent selections and queues', async () => {
  const { navigation, guest } = setup()
  const other = new Guest(2); navigation.track(other)
  other.authorize = (key) => navigation.authorize(other, key)
  guest.nextGate = gate(); guest.entered = gate()
  const paused = guest.nextGate
  const pending = navigation.open(guest, project('B'))
  await guest.entered.promise
  assert.equal((await navigation.open(other, project('C'))).status, 'opened')
  paused.release()
  await pending
  assert.equal(guest.sessions.get(guest.selected), project('B').path)
  assert.equal(other.sessions.get(other.selected), project('C').path)
})
for (const mutation of ['close', 'reload', 'host restart', 'explicit cancel']) {
  await test(`${mutation} cancels the old request without clicking`, async () => {
    const { navigation, guest, setReady } = setup()
    guest.nextGate = gate(); guest.entered = gate()
    const paused = guest.nextGate
    const pending = navigation.open(guest, project('B'))
    await guest.entered.promise
    if (mutation === 'host restart') { setReady(false); navigation.cancelAll([guest]); setReady(true) }
    else if (mutation === 'explicit cancel') navigation.cancel(guest)
    else guest[mutation]()
    paused.release()
    assert.equal((await pending).status, 'cancelled')
    assert.equal(guest.actions.length, 0)
    assert.equal(navigation.isBusy(guest), false)
  })
}
await test('returning to an available previous session restores it', async () => {
  const { navigation, guest } = setup()
  const before = guest.selected
  await navigation.open(guest, project('B'))
  assert.equal((await navigation.open(guest, project('A'))).status, 'opened')
  assert.equal(guest.selected, before)
  assert.equal(guest.actions.at(-1).kind, 'restore')
})
await test('failed registration retains the old session and confirmed project', async () => {
  const { navigation, guest, changed } = setup()
  const before = guest.selected
  guest.failed = true
  assert.equal((await navigation.open(guest, project('B'))).status, 'failed')
  assert.equal(guest.selected, before)
  assert.equal(changed.length, 0)
})
await test('cancelling an already queued guest script prevents its actual click', async () => {
  const { navigation, guest } = setup()
  guest.actionGate = gate(); guest.actionEntered = gate()
  const paused = guest.actionGate
  const pending = navigation.open(guest, project('B'))
  await guest.actionEntered.promise
  navigation.cancel(guest)
  paused.release()
  assert.equal((await pending).status, 'cancelled')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(guest.actions.length, 0)
  assert.equal(guest.sessions.get(guest.selected), project('A').path)
})
await test('guest destruction settles even when Electron evaluation never resolves', async () => {
  const { navigation, guest } = setup()
  guest.actionGate = gate(); guest.actionEntered = gate()
  const pending = navigation.open(guest, project('B'))
  await guest.actionEntered.promise
  guest.close()
  let timer
  try {
    const result = await Promise.race([pending, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('cancellation did not settle')), 500) })])
    assert.equal(result.status, 'cancelled')
    assert.equal(navigation.isBusy(guest), false)
  } finally { clearTimeout(timer) }
})
await test('a cancelled queued script cannot block or overwrite the next project', async () => {
  const { navigation, guest } = setup()
  guest.actionGate = gate(); guest.actionEntered = gate()
  const queued = guest.actionGate
  const old = navigation.open(guest, project('B'))
  await guest.actionEntered.promise
  const next = navigation.open(guest, project('C'))
  assert.equal((await old).status, 'cancelled')
  assert.equal((await next).status, 'opened')
  queued.release()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(guest.actions.map((action) => action.path), [project('C').path])
  assert.equal(guest.sessions.get(guest.selected), project('C').path)
})
await test('an unbookmarked project opens without inventing a Studio workspace', async () => {
  const { navigation, guest } = setup()
  const result = await navigation.open(guest, { id: '', path: 'D:/projects/unbookmarked', name: 'unbookmarked' })
  assert.equal(result.status, 'opened')
  assert.equal(result.workspaceId, undefined)
  assert.equal(result.path, 'D:/projects/unbookmarked')
  assert.equal(projects.length, 3)
})
await test('quick ask guard expires when project navigation begins', async () => {
  const { navigation, guest } = setup()
  const current = navigation.inputGuard(guest)
  assert.equal(current(), true)
  const pending = navigation.open(guest, project('B'))
  assert.equal(current(), false)
  await pending
  assert.equal(current(), false)
  assert.equal(navigation.inputGuard(guest)(), true)
})
await test('manual guest navigation publishes its actual directory', async () => {
  const { navigation, guest, changed } = setup()
  guest.sessions.set('manual', project('C').path); guest.selected = 'manual'
  await navigation.observe(guest, 'manual')
  assert.equal(changed.at(-1).workspaceId, 'C')
  assert.equal(changed.at(-1).sessionId, 'manual')
})
console.log(`workspace navigation: ${cases} cases passed`)
