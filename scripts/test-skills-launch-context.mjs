import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { win32 as path } from 'node:path'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

let child
const spawned = []
const fakeEnv = { USERPROFILE: 'D:\\qa\\home', DSH_HOME: 'D:\\qa\\inherited', DSH_AGENTS_HOME: 'D:\\qa\\agents', API_KEY: 'never-export-this' }
const load = createTypeScriptLoader({
  '../i18n': { t: (key) => key },
  '../logger': { logsDirectory: () => 'D:\\qa\\logs', stripAnsi: value => value, writeLogLine: async () => {} },
  'node:path': path,
  'node:os': { homedir: () => 'D:\\qa\\studio-home' },
  'node:fs': { existsSync: () => true },
  'node:fs/promises': { appendFile: async () => {}, mkdir: async () => {}, cp: async () => {}, readFile: async () => '{}', writeFile: async () => {} },
  'node:child_process': {
    spawn: (exe, args, options) => {
      child = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() })
      child.stdout.setEncoding = child.stderr.setEncoding = () => {}
      spawned.push({ exe, args, options, child })
      return child
    },
    execFile: () => queueMicrotask(() => child.emit('exit', 0, null)),
    execFileSync: () => {},
  }
}, { process: { platform: 'win32', env: fakeEnv } })
const { HostManager } = load(new URL('../src/main/runtime/host.ts', import.meta.url))
const options = () => ({ runtime: { nodePath: 'D:\\qa\\node.exe', cliPath: 'D:\\qa\\dsh\\lib\\bin.js', dshHome: 'D:\\qa\\dsh-home' }, settings: { runtime: { profile: 'studio', port: 0, extraArgs: ['--patch', './first.yml', '--patch=./second.yml'], env: { DSH_HOME: 'D:\\qa\\ignored', DSH_AGENTS_HOME: '~/shared-agents', DSH_BUNDLED_SKILL_DIR: './bundled', TOKEN: 'never-export-token' } } }, workspacePath: 'D:\\qa\\project-a', workspaceId: 'a' })
const manager = new HostManager()
assert.equal(manager.getSkillsLaunchContext(), null)
const first = options()
await manager.start(first)
assert.equal(manager.getSkillsLaunchContext(), null, 'starting host exposes no source identity')
child.stdout.emit('data', 'dsh web: http://127.0.0.1:4321/?token=test-only\n')
const context = manager.getSkillsLaunchContext()
assert.deepEqual(context, { nodePath: first.runtime.nodePath, cliPath: first.runtime.cliPath, processCwd: 'D:\\qa\\project-a', dshHome: 'D:\\qa\\dsh-home', agentsHome: 'D:\\qa\\home\\shared-agents', bundledSkillDir: 'D:\\qa\\project-a\\bundled', profile: 'studio', profileDir: 'D:\\qa\\dsh-home\\profiles\\studio', patchFiles: ['D:\\qa\\project-a\\first.yml', 'D:\\qa\\project-a\\second.yml'], configurationUncertain: false })
assert.equal(JSON.stringify(context).includes('never-export'), false, 'snapshot has neither credential strings nor full env')
context.patchFiles.push('mutated')
context.dshHome = 'mutated'
assert.deepEqual(manager.getSkillsLaunchContext().patchFiles, ['D:\\qa\\project-a\\first.yml', 'D:\\qa\\project-a\\second.yml'])
assert.equal(manager.getSkillsLaunchContext().dshHome, 'D:\\qa\\dsh-home')
assert.equal(manager.adoptWorkspace({ ...first, workspacePath: 'D:\\qa\\project-b', workspaceId: 'b' }), true)
assert.equal(manager.getSkillsLaunchContext().processCwd, 'D:\\qa\\project-a', 'adoption cannot reinterpret relative launch roots')
first.settings.runtime.env.DSH_AGENTS_HOME = 'changed-after-spawn'
first.settings.runtime.extraArgs.push('--patch=changed-after-spawn.yml')
assert.equal(manager.getSkillsLaunchContext().agentsHome, 'D:\\qa\\home\\shared-agents')
assert.equal(manager.getSkillsLaunchContext().patchFiles.length, 2)
await manager.stop()
assert.equal(manager.getSkillsLaunchContext(), null, 'stop clears the snapshot')
const next = options()
next.settings.runtime.extraArgs = ['--profile=other', '--patch']
await manager.start(next)
child.stdout.emit('data', 'dsh web: http://127.0.0.1:4322/\n')
assert.equal(manager.getSkillsLaunchContext().configurationUncertain, true)
manager.killNow()
assert.equal(manager.getSkillsLaunchContext(), null, 'quit clears the snapshot')
const failed = new HostManager()
await failed.start(options())
child.emit('error', new Error('fixture spawn failed'))
assert.equal(failed.getSkillsLaunchContext(), null, 'failed spawn clears the snapshot')
assert.equal(spawned.length, 3)
console.log('PASS skills launch context: 8 lifecycle/path/immutability checks; mocked spawn and I/O only')
