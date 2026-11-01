import assert from 'node:assert/strict'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const load = createTypeScriptLoader()
const { SessionTabFocus } = load(new URL('../src/main/session-tab-focus.ts', import.meta.url))
const { syncSessionTabFocus } = load(new URL('../src/renderer/src/lib/session-tab-focus.ts', import.meta.url))
let tests = 0
function test(name, run) {
  run()
  tests++
  console.log('PASS ' + name)
}

function setup() {
  const events = []
  const state = { destroyed: false, visible: true, minimized: false, focused: true, enabled: true }
  let nativeId = null
  let active = null
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    isFocused: () => state.focused,
    isEnabled: () => state.enabled,
    focus: () => { throw Error('A tab transition must never activate a system window') },
    webContents: { focus: () => { events.push('native:shell'); nativeId = null } }
  }
  const guests = new Map([41, 42, 43].map(id => [id, {
    id, destroyed: false,
    isDestroyed() { return this.destroyed },
    isFocused: () => nativeId === id,
    focus: () => { events.push('native:' + id); nativeId = id }
  }]))
  const frames = new Map([...guests.keys()].map(id => [id, {
    id, attachedId: id,
    focus: () => events.push('dom:focus:' + id),
    blur: () => events.push('dom:blur:' + id),
    getWebContentsId() { return this.attachedId }
  }]))
  const broker = new SessionTabFocus(() => window, () => active && !active.destroyed ? active : null)
  const report = (id, options) => {
    events.push(['active', id, options])
    active = guests.get(id) ?? null
    broker.update(options)
  }
  return { events, state, guests, frames, broker, report, native: () => nativeId,
    setActive: id => { active = guests.get(id) ?? null },
    takeShellFocus: () => { nativeId = null } }
}

test('native input follows both tab directions, with the old DOM frame released first', () => {
  const q = setup()
  const a = q.frames.get(41), b = q.frames.get(42)
  let previous = syncSessionTabFocus(null, a, 41, true, q.report)
  assert.equal(q.native(), 41)
  q.events.length = 0
  previous = syncSessionTabFocus(previous, b, 42, true, q.report)
  assert.deepEqual(q.events.slice(0, 2), ['dom:blur:41', 'dom:focus:42'])
  assert.equal(q.native(), 42)
  q.events.length = 0
  previous = syncSessionTabFocus(previous, a, 41, true, q.report)
  assert.deepEqual(q.events.slice(0, 2), ['dom:blur:42', 'dom:focus:41'])
  assert.equal(previous, a)
  assert.equal(q.native(), 41)
})

test('parking the workspace preserves the Quick Ask identity and releases only its guest', () => {
  const q = setup(), a = q.frames.get(41)
  const previous = syncSessionTabFocus(null, a, 41, true, q.report)
  q.events.length = 0
  assert.equal(syncSessionTabFocus(previous, a, 41, false, q.report), null)
  assert.deepEqual(q.events, ['dom:blur:41', ['active', 41, { visible: false, focus: false }], 'native:shell'])
  q.events.length = 0
  syncSessionTabFocus(null, a, 41, false, q.report)
  assert.deepEqual(q.events, [['active', 41, { visible: false, focus: false }]])
  syncSessionTabFocus(null, a, 41, true, q.report)
  assert.equal(q.native(), 41, 're-entering the same guest can focus it')
})

test('cold and replaced frames cannot focus an unattached or stale guest identity', () => {
  const q = setup(), a = q.frames.get(41)
  a.attachedId = undefined
  syncSessionTabFocus(null, a, 41, true, q.report)
  assert.deepEqual(q.events, [['active', null, { visible: true, focus: false }]])
  a.attachedId = 42
  q.events.length = 0
  syncSessionTabFocus(null, a, 41, true, q.report)
  assert.deepEqual(q.events, [['active', null, { visible: true, focus: false }]])
  syncSessionTabFocus(null, a, 42, true, q.report)
  assert.equal(q.native(), 42)
  q.events.length = 0
  a.getWebContentsId = () => { throw Error('not attached') }
  syncSessionTabFocus(a, a, 42, true, q.report)
  assert.equal(q.native(), null)
  assert.equal(q.events.some(event => event === 'dom:focus:41'), false)
})

test('a cold-ready identity update leaves an existing shell input in control', () => {
  const q = setup()
  syncSessionTabFocus(null, q.frames.get(42), 42, true, q.report, false)
  assert.deepEqual(q.events, [['active', 42, { visible: true, focus: false }]])
  assert.equal(q.native(), null)
  q.broker.restore()
  assert.equal(q.native(), null)
})

test('an existing shell input also cancels a prior claim or deferred request for the same guest', () => {
  const q = setup(), a = q.frames.get(41)
  const previous = syncSessionTabFocus(null, a, 41, true, q.report)
  q.takeShellFocus()
  q.events.length = 0
  syncSessionTabFocus(previous, a, 41, false, q.report)
  assert.deepEqual(q.events, ['dom:blur:41', ['active', 41, { visible: false, focus: false }]])
  q.events.length = 0
  q.state.focused = false
  q.broker.update({ visible: true, focus: true })
  syncSessionTabFocus(null, a, 41, true, q.report, false)
  q.state.focused = true
  q.broker.restore()
  assert.deepEqual(q.events, [['active', 41, { visible: true, focus: false }]])
  assert.equal(q.native(), null)
})

test('native focus is denied for every inactive window state without activating it', () => {
  for (const [key, value] of [['destroyed', true], ['visible', false], ['minimized', true], ['focused', false], ['enabled', false]]) {
    const q = setup()
    q.state[key] = value
    q.setActive(41)
    q.broker.update({ visible: true, focus: true })
    q.broker.restore()
    assert.deepEqual(q.events, [], key)
  }
})

test('foreground restoration rechecks the current guest instead of replaying an old object', () => {
  const q = setup()
  q.state.focused = false
  q.setActive(41)
  q.broker.update({ visible: true, focus: true })
  q.setActive(42)
  q.broker.update({ visible: true, focus: true })
  q.guests.get(41).destroyed = true
  q.broker.forget(41)
  q.state.focused = true
  q.broker.restore()
  assert.deepEqual(q.events, ['native:42'])
  q.broker.restore()
  assert.deepEqual(q.events, ['native:42'], 'there is no persistent focus grab')
})

test('identity-only plugin reports never claim focus and cancel stale deferred focus', () => {
  const q = setup()
  q.state.focused = false
  q.setActive(41)
  q.broker.update({ visible: true, focus: true })
  q.setActive(42)
  q.broker.update()
  q.state.focused = true
  q.broker.restore()
  assert.deepEqual(q.events, [])
  q.broker.update()
  assert.deepEqual(q.events, [])
})

test('hiding or losing the guest cancels deferred focus before a later window activation', () => {
  for (const change of [q => q.broker.update({ visible: false, focus: false }), q => {
    q.guests.get(41).destroyed = true
    q.broker.forget(41)
  }, q => q.setActive(42), q => q.setActive(null)]) {
    const q = setup()
    q.state.focused = false
    q.setActive(41)
    q.broker.update({ visible: true, focus: true })
    change(q)
    q.state.focused = true
    q.broker.restore()
    assert.deepEqual(q.events, [])
  }
})

test('focus needs two strict boolean permissions and a live active guest', () => {
  for (const options of [undefined, null, {}, { visible: true }, { visible: true, focus: 1 },
    { visible: 'true', focus: true }, { visible: false, focus: true }, { visible: true, focus: false }]) {
    const q = setup()
    q.setActive(41)
    q.broker.update(options)
    assert.deepEqual(q.events, [])
  }
  const q = setup()
  q.broker.update({ visible: true, focus: true })
  q.setActive(41)
  q.guests.get(41).destroyed = true
  q.broker.update({ visible: true, focus: true })
  assert.deepEqual(q.events, [])
})

console.log(`Session tab focus: ${tests} tests passed`)
