import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const script = fileURLToPath(import.meta.url)
const HELP = `Test the installed DSH model adapter against a loopback SSE fixture.

Usage:
  node scripts/test-upstream-model-adapter.mjs --dsh-package <package-directory> [options]

Options:
  --dsh-package <path>     Required installed @deepseek-ai/dsh program package.
  --expect-version <v>     Require this DSH and adapter version.
  --report <path>          Also write the JSON result to this path.
  --help                  Show this help without loading DSH.

Runs in a child with a fresh home, cwd, and temporary directory, without inherited
credentials or proxy settings. Uses only an in-memory placeholder and loopback
OpenAI Chat Completions fixture. Covers streamed text, two-turn history, tool-call
translation and synthetic tool-result replay. Does not test real models, real
tool execution, the Host, Electron UI, or other provider protocols.
`

function safeTemporaryPath(path) {
  const part = relative(resolve(tmpdir()), resolve(path))
  assert.ok(part.startsWith('harness-model-adapter-') && !part.includes(sep) && !isAbsolute(part), 'Refuse to clean an unexpected temporary path')
}

async function runChild(values) {
  const root = resolve(values['isolated-child'])
  assert.equal(process.cwd(), root, 'Adapter worker must use its isolated cwd')
  assert.equal(process.env.HARNESS_STUDIO_ADAPTER_TEST_ROOT, root, 'Adapter worker must be created by this script')
  const report = {
    passed: false,
    checkedAt: new Date().toISOString(),
    dshPackage: values['dsh-package'],
    expectedVersion: values['expect-version'] ?? null,
    upstreamVersion: null,
    adapterVersion: null,
    protocol: 'openai-completions',
    checks: [],
    requests: [],
    externalRequests: [],
    credentialRecordWrites: 0,
    requestHeaderHookCalls: 0,
    accountServicesAvailable: false,
    realModelTested: false,
    realToolExecutions: 0,
    syntheticToolResults: 0,
    isolatedChildEnvironment: true,
    scope: 'Real shipped DSH adapter with in-memory Host services and loopback SSE fixture. Protocol translation only; no real model, tool execution, Host, Electron UI, accounts or credential store.'
  }
  let server
  const originalFetch = globalThis.fetch
  try {
    assert.equal(Object.keys(process.env).some(name => /api.?key|token|secret|cookie|credential|proxy|^node_options$/i.test(name)), false, 'Child must not inherit credentials, proxies or Node injection options')
    for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DSH_HOME', 'DSH_AGENTS_HOME', 'TMP', 'TEMP']) {
      const part = relative(root, resolve(process.env[name] ?? ''))
      assert.ok(part && !part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part), `${name} must be isolated`)
    }
    const packageFile = join(values['dsh-package'], 'package.json')
    const dsh = JSON.parse(await readFile(packageFile, 'utf8'))
    assert.equal(dsh.name, '@deepseek-ai/dsh', '--dsh-package must point to the program package, not DSH_HOME')
    const requireFromDsh = createRequire(packageFile)
    const adapterPackage = JSON.parse(await readFile(requireFromDsh.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json'), 'utf8'))
    report.upstreamVersion = dsh.version
    report.adapterVersion = adapterPackage.version
    if (values['expect-version']) {
      assert.equal(dsh.version, values['expect-version'], 'DSH does not match --expect-version')
      assert.equal(adapterPackage.version, values['expect-version'], 'Model adapter does not match --expect-version')
    }

    const providerName = 'qa-local'
    const modelName = 'qa-local-model'
    const firstQuestion = 'Return the first local fixture response.'
    const firstAnswer = 'LOCAL_FIRST_RESPONSE'
    const secondQuestion = 'Continue using the preceding question and answer.'
    const secondAnswer = 'LOCAL_SECOND_RESPONSE'
    const toolQuestion = 'Call the synthetic fixture tool.'
    const toolName = 'qa_read_file'
    const toolArguments = { path: 'example.txt' }
    const toolResult = 'SYNTHETIC_FILE_CONTENT_NOT_READ_FROM_DISK'
    const finalAnswer = 'LOCAL_TOOL_RESULT_RECEIVED'
    let phase = 'first-turn'
    let serverError
    const textOf = message => typeof message.content === 'string'
      ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('')
    const ordinaryHistory = [
      ['user', firstQuestion], ['assistant', firstAnswer], ['user', secondQuestion]
    ]
    server = createServer(async (req, res) => {
      try {
        assert.equal(req.socket.remoteAddress, '127.0.0.1')
        assert.equal(req.method, 'POST')
        assert.equal(req.url, '/v1/chat/completions')
        assert.equal(req.headers.authorization, 'Bearer local-placeholder')
        let raw = ''
        for await (const part of req) {
          raw += part
          assert.ok(raw.length < 64 * 1024, 'Fixture request is unexpectedly large')
        }
        const body = JSON.parse(raw)
        assert.equal(body.model, modelName)
        assert.equal(body.stream, true)
        const history = body.messages.filter(message => message.role !== 'system')
        if (phase === 'first-turn') assert.deepEqual(history.map(message => [message.role, textOf(message)]), [['user', firstQuestion]])
        else if (phase === 'second-turn') assert.deepEqual(history.map(message => [message.role, textOf(message)]), ordinaryHistory)
        else {
          assert.deepEqual(history.slice(0, 5).map(message => [message.role, textOf(message)]), [...ordinaryHistory, ['assistant', secondAnswer], ['user', toolQuestion]])
          assert.equal(body.tools.length, 1)
          assert.equal(body.tools[0].function.name, toolName)
          assert.deepEqual(body.tools[0].function.parameters.required, ['path'])
          if (phase === 'tool-call') assert.equal(history.length, 5)
          else {
            assert.equal(phase, 'tool-result')
            assert.equal(history.length, 7)
            assert.equal(history[5].role, 'assistant')
            assert.equal(history[5].tool_calls.length, 1)
            const call = history[5].tool_calls[0]
            assert.equal(call.function.name, toolName)
            assert.deepEqual(JSON.parse(call.function.arguments), toolArguments)
            assert.equal(history[6].role, 'tool')
            assert.equal(history[6].tool_call_id, call.id)
            assert.equal(textOf(history[6]), toolResult)
          }
        }
        report.requests.push({ phase, method: req.method, path: req.url, loopback: true, placeholderBearer: true, stream: true, messageRoles: history.map(message => message.role), toolCount: body.tools?.length ?? 0 })
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        const base = { id: `chatcmpl-${phase}`, object: 'chat.completion.chunk', created: 1, model: modelName }
        const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
        chunk({ role: 'assistant' })
        if (phase === 'tool-call') {
          chunk({ tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: toolName, arguments: '{"path":' } }] })
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"example.txt"}' } }] })
        } else {
          const answer = phase === 'first-turn' ? firstAnswer : phase === 'second-turn' ? secondAnswer : finalAnswer
          chunk({ content: answer.slice(0, 6) })
          chunk({ content: answer.slice(6) })
        }
        chunk({}, phase === 'tool-call' ? 'tool_calls' : 'stop')
        res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`)
        res.end('data: [DONE]\n\n')
      } catch (error) {
        serverError = error
        if (!res.headersSent) res.writeHead(500)
        res.end('Loopback protocol fixture failed')
      }
    })
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
    const origin = `http://127.0.0.1:${server.address().port}`
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.origin !== origin) {
        report.externalRequests.push(`${url.origin}${url.pathname}`)
        throw new Error('External model requests are forbidden in this protocol test')
      }
      return originalFetch(input, { ...init, redirect: 'error' })
    }
    const { apply, Config } = await import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-llm-pi-ai')).href)
    const adapterFor = placeholder => {
      let adapter
      const profile = {
        displayName: 'Loopback protocol fixture', api: 'openai-completions', baseURL: `${origin}/v1`,
        timeoutMs: 5000, streamIdleTimeoutMs: 5000,
        models: [{ id: modelName, contextWindow: 8192, maxTokens: 1024, input: ['text'], reasoningEfforts: false }],
        ...(placeholder ? { apiKeyEnv: 'QA_LOCAL_PLACEHOLDER' } : {})
      }
      const credentials = {
        resolve: async ref => String(ref) === 'QA_LOCAL_PLACEHOLDER' ? { value: 'local-placeholder' } : undefined,
        readRecord: async () => undefined,
        listRecords: async () => [],
        modifyRecord: async () => { report.credentialRecordWrites++; throw new Error('Credential writes forbidden') },
        deleteRecord: async () => { report.credentialRecordWrites++; throw new Error('Credential deletion forbidden') }
      }
      const ctx = {
        fiber: { entry: { options: { id: 'llm-pi-ai' } } }, inject: () => {}, on: () => {},
        // DSH 0.2.2 adds this Cordis hook. No header-contributing plugins are
        // registered in the fixture, so preserve the default request headers.
        waterfall: (event, request, headers, fallback) => {
          assert.equal(event, 'llm-pi-ai/request-headers')
          assert.ok(request && typeof request === 'object')
          assert.ok(headers instanceof Headers)
          assert.equal(typeof fallback, 'function')
          report.requestHeaderHookCalls++
          const result = fallback()
          assert.equal(result, headers)
          return result
        },
        get: name => {
          if (name === 'credentials') return credentials
          if (name === 'launchEnvironment') return { get: () => undefined }
          if (/account|authorization/i.test(name)) throw new Error('Account services forbidden')
          return undefined
        },
        logger: { warn: () => {}, error: () => {} },
        llm: {
          registerConfigurableProviders: () => ({ replace: () => {} }), registerModelDiscovery: () => {},
          registerAdapter: (routes, value) => { assert.deepEqual(routes, [providerName]); adapter = value; return { replace: () => {} } }
        }
      }
      apply(ctx, Config({ providers: { [providerName]: profile } }))
      assert.ok(adapter, 'The selected DSH package did not register the expected adapter')
      return adapter
    }
    const user = text => ({ role: 'user', content: [{ type: 'text', text }] })
    const assistant = (id, content) => ({ id, role: 'assistant', content, source: { kind: 'model', provider: providerName, model: modelName } })
    const request = { provider: providerName, model: modelName, messages: [user(firstQuestion)], maxTokens: 128 }
    const collect = async adapter => {
      const chunks = []
      for await (const chunk of adapter.stream({ ...request, signal: AbortSignal.timeout(7000) })) chunks.push(chunk)
      if (serverError) throw serverError
      return chunks
    }
    const checked = name => report.checks.push({ name, passed: true })
    const expectText = (chunks, answer) => {
      assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), answer)
      assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'), 'Text stream must finish normally')
    }
    let blankFailure
    try { blankFailure = (await collect(adapterFor(false))).find(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error')?.reason }
    catch (error) { blankFailure = { message: error.message } }
    assert.ok(blankFailure, 'Missing key must fail before HTTP')
    assert.match(blankFailure.failure?.message ?? blankFailure.message ?? '', /No API key for provider: qa-local/)
    assert.equal(report.requests.length, 0)
    checked('Blank local key is rejected before HTTP')
    const adapter = adapterFor(true)
    assert.equal((await adapter.listModels(providerName))[0].id, modelName)
    expectText(await collect(adapter), firstAnswer)
    checked('Placeholder authenticates a streamed loopback text response without an account')
    request.messages.push(assistant('assistant-first', [{ type: 'text', text: firstAnswer }]), user(secondQuestion))
    phase = 'second-turn'
    expectText(await collect(adapter), secondAnswer)
    checked('Second text turn preserves the first user and assistant messages')
    request.messages.push(assistant('assistant-second', [{ type: 'text', text: secondAnswer }]), user(toolQuestion))
    request.tools = [{ name: toolName, description: 'Synthetic protocol fixture; never executed', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }]
    phase = 'tool-call'
    const toolChunks = await collect(adapter)
    const call = toolChunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')?.block
    assert.equal(call?.name, toolName)
    assert.deepEqual(JSON.parse(call.arguments), toolArguments)
    assert.ok(toolChunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'tool-calls'))
    checked('Split wire tool-call arguments become a Harness tool-call block')
    request.messages.push(assistant('assistant-tool', [call]), {
      id: 'synthetic-tool-result', role: 'tool', toolCallId: call.id,
      source: { kind: 'tool', callId: call.id }, content: [{ type: 'text', text: toolResult }]
    })
    report.syntheticToolResults++
    phase = 'tool-result'
    expectText(await collect(adapter), finalAnswer)
    checked('Synthetic tool result replays with its correlated tool call and complete history')
    assert.equal(report.requests.length, 4)
    assert.equal(report.externalRequests.length, 0)
    assert.equal(report.credentialRecordWrites, 0)
    checked('All requests stay on loopback; no account, credentials store or real tools used')
    report.passed = true
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    process.exitCode = 1
  } finally {
    if (server?.listening) {
      server.closeAllConnections()
      await new Promise(resolveClose => server.close(resolveClose))
    }
    globalThis.fetch = originalFetch
    await writeFile(join(root, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'dsh-package': { type: 'string' }, 'expect-version': { type: 'string' },
    report: { type: 'string' }, help: { type: 'boolean' }, 'isolated-child': { type: 'string' }
  } })
  if (values.help) { process.stdout.write(HELP); return }
  if (!values['dsh-package']?.trim()) throw new Error('--dsh-package is required. Use --help for usage.')
  values['dsh-package'] = resolve(values['dsh-package'])
  if (values['isolated-child']) return runChild(values)

  const root = await mkdtemp(join(tmpdir(), 'harness-model-adapter-'))
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'programfiles', 'programfiles(x86)', 'commonprogramfiles', 'processor_architecture', 'number_of_processors'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toLowerCase())))
  const isolated = {
    HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), APPDATA: join(root, 'app-data'),
    LOCALAPPDATA: join(root, 'local-app-data'), XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    DSH_HOME: join(root, 'dsh'), DSH_AGENTS_HOME: join(root, 'agents'), DSH_BUNDLED_SKILL_DIR: join(root, 'bundled'),
    TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp')
  }
  let report
  try {
    for (const path of new Set(Object.values(isolated))) await mkdir(path, { recursive: true })
    const args = [script, '--dsh-package', values['dsh-package'], '--isolated-child', root]
    if (values['expect-version']) args.push('--expect-version', values['expect-version'])
    const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...isolated, HARNESS_STUDIO_ADAPTER_TEST_ROOT: root }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { if (stderr.length < 8000) stderr += data.toString().slice(0, 8000 - stderr.length) })
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill() }, 60_000)
    let result
    try {
      result = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolveExit({ code, signal })) })
    } finally { clearTimeout(timeout) }
    try { report = JSON.parse(await readFile(join(root, 'result.json'), 'utf8')) }
    catch { report = { passed: false, scope: 'Isolated loopback adapter protocol test', error: timedOut ? 'Worker exceeded 60 seconds' : stderr.trim() || 'Worker exited without a report' } }
    report.workerExitCode = result.code
    if (timedOut || result.code !== 0) { report.passed = false; process.exitCode = 1 }
  } finally {
    safeTemporaryPath(root)
    await rm(root, { recursive: true, force: true })
    if (report) report.temporaryDirectoryRemoved = true
  }
  const output = `${JSON.stringify(report, null, 2)}\n`
  if (values.report) {
    const reportPath = resolve(values.report)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, output, 'utf8')
  }
  process.stdout.write(output)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
