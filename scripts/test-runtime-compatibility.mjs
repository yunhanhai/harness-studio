import assert from 'node:assert/strict'
import { win32 as path } from 'node:path'
import { promisify } from 'node:util'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

const loadTranslations = createTypeScriptLoader()
const { translate } = loadTranslations(new URL('../src/shared/i18n.ts', import.meta.url))
const { DEFAULT_SETTINGS } = loadTranslations(new URL('../src/shared/defaults.ts', import.meta.url))
let checks = 0
async function test(name, run) { await run(); checks++; console.log('PASS ' + name) }

// Execute the real detector against an in-memory Windows installation. No user
// files, real Node/DSH processes, registry or network access are needed.
async function detect({ node = 'v24.9.0', engine = '>=24.9.0', omitEngine = false, source = 'custom', version = '0.2.2-rc.1', locale = 'en-US', nodeFails = false, manifestText, manifestFails = false, enginesOverride } = {}) {
  const userData = 'D:\\qa\\studio'
  const packageDir = source === 'custom' ? 'D:\\qa\\chosen dsh' : source === 'portable'
    ? path.join(userData, 'runtime/node_modules/@deepseek-ai/dsh')
    : source === 'npm-global' ? 'D:\\qa\\appdata\\npm\\node_modules\\@deepseek-ai\\dsh'
      : 'D:\\qa\\shim\\node_modules\\@deepseek-ai\\dsh'
  const cli = path.join(packageDir, 'lib/bin.js')
  const nodeExe = source === 'portable' ? path.join(userData, 'runtime/node/node.exe') : 'D:\\qa\\node.exe'
  const shim = 'D:\\qa\\shim\\dsh.cmd'
  const manifest = { name: '@deepseek-ai/dsh', version, ...(omitEngine ? {} : { engines: { node: engine } }) }
  if (enginesOverride !== undefined) manifest.engines = enginesOverride
  const files = new Set([nodeExe, cli, packageDir, path.join(packageDir, 'package.json'), ...(source === 'path' ? [shim] : [])])
  const reads = [], executions = []
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.runtime.mode = source === 'custom' ? 'custom' : 'auto'
  settings.runtime.customPath = source === 'custom' ? packageDir : ''
  settings.runtime.nodePath = source === 'portable' ? '' : nodeExe
  settings.runtime.dshHome = 'D:\\qa\\dsh-home'
  const execFile = () => { throw new Error('Use the promisified fixture') }
  execFile[promisify.custom] = async (exe, args) => {
    executions.push({ exe, args })
    if (exe === 'where.exe') return { stdout: source === 'path' && args[0] === 'dsh.cmd' ? shim : '' }
    assert.equal(exe, nodeExe)
    assert.deepEqual(args, ['--version'], 'Detection must not start the DSH CLI')
    if (nodeFails) throw new Error('Node fixture cannot execute')
    return { stdout: node + '\r\n' }
  }
  const load = createTypeScriptLoader({
    '../i18n': { t: (key, values) => translate(locale, key, values) },
    'node:path': path,
    'node:os': { homedir: () => 'D:\\qa\\home' },
    'node:fs': { existsSync: file => files.has(file) },
    'node:fs/promises': { readFile: async file => {
      reads.push(file)
      assert.equal(file, path.join(packageDir, 'package.json'), 'Read only the selected DSH program manifest')
      if (manifestFails) throw Object.assign(new Error('Unreadable package fixture'), { code: 'EACCES' })
      return manifestText ?? JSON.stringify(manifest)
    } },
    'node:child_process': { execFile }
  }, { process: { env: { APPDATA: 'D:\\qa\\appdata', ProgramFiles: 'D:\\qa\\programs' } } })
  const { detectRuntime } = load(new URL('../src/main/runtime/detect.ts', import.meta.url))
  const result = await detectRuntime(settings, userData)
  assert.ok(executions.every(call => call.exe === 'where.exe' || call.exe === nodeExe))
  return { result, packageDir, cli, nodeExe, reads }
}

await test('DSH requiring Node 24.9 rejects Node 22 and preserves actionable runtime identity', async () => {
  const { result, cli, nodeExe } = await detect({ node: 'v22.23.3' })
  assert.equal(result.state, 'error')
  assert.equal(result.version, '0.2.2-rc.1')
  assert.equal(result.nodeVersion, '22.23.3')
  assert.equal(result.nodeRequirement, '>=24.9.0')
  assert.equal(result.source, 'custom')
  assert.equal(result.cliPath, cli)
  assert.equal(result.nodePath, nodeExe)
  assert.equal(result.dshHome, 'D:\\qa\\dsh-home')
  assert.match(result.error, /0\.2\.2-rc\.1.*>=24\.9\.0.*22\.23\.3/)
  assert.match(result.error, /Settings → Runtime/)
})

await test('Version boundary distinguishes 24.8, 24.9 and a newer compatible Node', async () => {
  for (const [node, state] of [['v24.8.9', 'error'], ['v24.9.0', 'ready'], ['v26.0.0', 'ready']]) {
    const { result } = await detect({ node })
    assert.equal(result.state, state, node)
  }
})

await test('Full npm ranges honor OR branches, upper bounds and hyphen ranges', async () => {
  for (const [engine, node, state] of [
    ['^22.20.0 || >=24.9.0 <25', 'v22.23.3', 'ready'],
    ['^22.20.0 || >=24.9.0 <25', 'v24.8.0', 'error'],
    ['^22.20.0 || >=24.9.0 <25', 'v25.0.0', 'error'],
    ['24.9.0 - 24.12.0', 'v24.12.0', 'ready'],
    ['24.9.0 - 24.12.0', 'v24.12.1', 'error'],
    ['24.x', 'v24.10.0', 'ready']
  ]) assert.equal((await detect({ engine, node })).result.state, state, engine + ' / ' + node)
})

await test('Prerelease Node follows declared semver prerelease admission', async () => {
  assert.equal((await detect({ node: 'v24.9.0-rc.1' })).result.state, 'error')
  assert.equal((await detect({ node: 'v24.9.0-rc.1', engine: '>=24.9.0-rc.0 <25' })).result.state, 'ready')
})

await test('Legacy DSH without a Node engine keeps its supported detection behavior', async () => {
  const { result } = await detect({ omitEngine: true, node: 'v22.23.3', version: '0.2.1-rc.2' })
  assert.equal(result.state, 'ready')
  assert.equal(result.version, '0.2.1-rc.2')
  assert.equal(result.nodeRequirement, undefined)
})

await test('Invalid engine declarations cannot be reported as ready', async () => {
  for (const engine of ['', ' ', 'latest', '>=24.nope', 24, null, ['>=24'], {}]) {
    const { result } = await detect({ engine })
    assert.equal(result.state, 'error', JSON.stringify(engine))
    assert.match(result.error, /invalid Node\.js requirement/)
  }
  for (const enginesOverride of [null, '>=24.9.0', ['>=24.9.0']]) {
    assert.match((await detect({ enginesOverride })).result.error, /invalid Node\.js requirement/)
  }
  assert.equal((await detect({ enginesOverride: { npm: '>=10' } })).result.state, 'ready', 'Valid engines without node is undeclared')
})

await test('Unreadable or malformed manifests do not masquerade as legacy engine omissions', async () => {
  for (const options of [{ manifestFails: true }, ...['{', 'null', '[]', '"package"'].map(manifestText => ({ manifestText }))]) {
    const { result, cli, nodeExe } = await detect(options)
    assert.equal(result.state, 'error')
    assert.match(result.error, /Could not read or parse/)
    assert.equal(result.cliPath, cli)
    assert.equal(result.nodePath, nodeExe)
    assert.equal(result.nodeVersion, '24.9.0')
  }
})

await test('Malformed Node output and failed execution have distinct diagnostics', async () => {
  for (const node of ['node version 24.9.0', 'v24.9', 'garbage']) {
    const { result, reads } = await detect({ node })
    assert.equal(result.state, 'error')
    assert.match(result.error, /Could not recognize/)
    assert.equal(reads.length, 0)
  }
  assert.match((await detect({ nodeFails: true })).result.error, /could not be started/)
})

await test('Custom, portable, npm-global and PATH selections use their own package requirement', async () => {
  for (const source of ['custom', 'portable', 'npm-global', 'path']) {
    const { result, cli, packageDir, reads } = await detect({ source, node: 'v22.23.3' })
    assert.equal(result.source, source)
    assert.equal(result.cliPath, cli)
    assert.equal(result.state, 'error')
    assert.deepEqual(reads, [path.join(packageDir, 'package.json')])
  }
})

await test('Chinese mismatch guidance includes the requirement and current version', async () => {
  const { result } = await detect({ locale: 'zh-CN', node: 'v22.23.3' })
  assert.match(result.error, /要求 Node\.js >=24\.9\.0，当前检测到 22\.23\.3/)
  assert.match(result.error, /设置 → 运行时/)
})

console.log('PASS runtime compatibility: ' + checks + ' groups; in-memory manifests and mocked process probes only')
