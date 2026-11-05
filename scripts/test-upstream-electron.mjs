import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, readdir, writeFile, stat, rm } from 'node:fs/promises'
import { join, resolve, dirname, relative, isAbsolute } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createTypeScriptLoader } from './lib/load-typescript.mjs'

// Tests the built Studio with official DSH. Writable state stays in a new QA root.
// The default suite never submits a model request. --live-config explicitly
// enables a small paid/live acceptance run against the selected endpoint.
const { values } = parseArgs({ options: { 'dsh-package': { type: 'string' }, 'expect-version': { type: 'string' }, 'report-dir': { type: 'string' }, 'live-config': { type: 'string' }, 'app-executable': { type: 'string' }, 'keep-open-for-keyboard': { type: 'boolean' }, help: { type: 'boolean' } } })
if (values.help) {
  console.log('Usage: node scripts/test-upstream-electron.mjs --dsh-package <installed @deepseek-ai/dsh directory> [--expect-version <version>] [--report-dir <new directory>] [--live-config <explicit endpoint/model/key-file JSON>] [--app-executable <installed or unpacked app exe>] [--keep-open-for-keyboard]\nDefault: navigation only, no model calls. The selected packaged app must match package.json and the current out files. Keyboard mode keeps the isolated GUI open after the eight automatic checks; it does not verify human keyboard use. Close the app, press Ctrl+C here, or create the stop-request file named in keyboard-session.json. Live and keyboard modes cannot be combined. See docs/ACCEPTANCE.md.')
  process.exit(0)
}
if (process.platform !== 'win32') throw new Error('Official Electron smoke currently requires Windows.')
if (!values['dsh-package']) throw new Error('Pass --dsh-package; no user runtime or account configuration is auto-discovered.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appExecutable = values['app-executable'] ? resolve(values['app-executable']) : join(root, 'node_modules/electron/dist/electron.exe')
const packaged = Boolean(values['app-executable'])
const keepOpenForKeyboard = Boolean(values['keep-open-for-keyboard'])
assert.ok(!(keepOpenForKeyboard && values['live-config']), 'Use separate runs for live acceptance and human keyboard verification')
assert.ok((await stat(appExecutable)).isFile(), 'The app executable must exist')
const appPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const qaParent = join(root, '.qa-upstream')
await mkdir(qaParent, { recursive: true })
const qa = await mkdtemp(join(qaParent, 'electron-'))
const reportDir = values['report-dir'] ? resolve(values['report-dir']) : join(qa, 'report')
// A failed run must not leave an earlier successful report at the same path.
await mkdir(reportDir, { recursive: false })
const data = join(qa, 'user-data')
const dshHome = join(qa, 'dsh-home')
const agentsHome = join(qa, 'agents-home')
const project = join(qa, 'workspace')
const documents = join(qa, 'documents')
const temp = join(qa, 'tmp')
const upstream = resolve(values['dsh-package'])
const yaml = createRequire(join(upstream, 'package.json'))('js-yaml')
const rendererBuild = (await readFile(join(root, 'out/renderer/index.html'), 'utf8')).match(/assets\/(index-[^"']+\.js)/)?.[1]
const upstreamPackage = JSON.parse(await readFile(join(upstream, 'package.json'), 'utf8'))
assert.equal(upstreamPackage.name, '@deepseek-ai/dsh')
if (values['expect-version']) assert.equal(upstreamPackage.version, values['expect-version'], 'DSH version does not match --expect-version')
console.log('Official DSH ' + upstreamPackage.version + '; reports: ' + reportDir)
assert.ok(rendererBuild, 'current renderer build exists')
let liveConfig
if (values['live-config']) {
  const configPath = resolve(values['live-config'])
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const baseURL = new URL(config.baseURL)
  assert.ok(baseURL.protocol === 'https:' || (baseURL.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(baseURL.hostname)), 'Use HTTPS or a local HTTP endpoint')
  assert.ok(!baseURL.username && !baseURL.password && !baseURL.search && !baseURL.hash, 'Endpoint must not contain credentials, a query or fragment')
  assert.equal(config.api, 'openai-completions', 'Live acceptance currently covers OpenAI Chat Completions only')
  assert.ok(typeof config.model === 'string' && config.model.trim(), 'Specify a model ID')
  assert.ok(typeof config.apiKeyFile === 'string' && config.apiKeyFile.trim(), 'Specify apiKeyFile; keys are not accepted in command arguments')
  const apiKey = (await readFile(resolve(dirname(configPath), config.apiKeyFile), 'utf8')).trim()
  assert.ok(apiKey && !/[\r\n]/.test(apiKey), 'Key file must contain one nonempty value')
  liveConfig = { baseURL: baseURL.href.replace(/\/$/, ''), model: config.model, api: config.api, apiKey }
}
await Promise.all([data, dshHome, agentsHome, project, documents, temp, join(qa, 'appdata'), join(qa, 'localappdata'), join(qa, 'home')].map(path => mkdir(path, { recursive: true })))
// Keep filesystem skill/instruction discovery inside the disposable project,
// even though the QA root itself lives underneath the Studio checkout.
await mkdir(join(project, '.git'))
await mkdir(join(project, '.dsh', 'skills'), { recursive: true })
for (const path of [join(project, '.env'), join(dshHome, '.env'), join(dshHome, '.credentials.yaml')]) {
  assert.equal(await stat(path).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false, 'isolation starts without environment or credentials files')
}
const overlay = [
  { id: 'workspace-controller', config: { documentsDirectory: documents, documentsLookupTimeoutMs: 1000 } },
  { id: 'credentials', config: { path: join(dshHome, '.credentials.yaml'), watch: false } },
  { id: 'llm-deepseek', config: { apiKeyEnv: 'HARNESS_STUDIO_QA_ABSENT_CREDENTIAL' } }
]
await writeFile(join(dshHome, 'cordis.patch.yml'), JSON.stringify(overlay, null, 2) + '\n', 'utf8')
const { DEFAULT_SETTINGS } = createTypeScriptLoader()(join(root, 'src/shared/defaults.ts'))
const settings = structuredClone(DEFAULT_SETTINGS)
Object.assign(settings, { language: 'zh-CN', closeToTray: false, checkUpdatesOnStart: false, modelSetupSeen: true, lastWorkspaceId: 'qa-upstream' })
Object.assign(settings.runtime, { mode: 'custom', customPath: join(upstream, 'lib/bin.js'), nodePath: process.execPath, dshHome, profile: 'studio-upstream-qa', autoStart: false, extraArgs: ['--host', '127.0.0.1'], env: {} })
settings.window = { width: 1400, height: 920, maximized: false }
settings.shortcuts = { toggleWindow: '', palette: '', quickAsk: '' }
await writeFile(join(data, 'settings.json'), JSON.stringify(settings), 'utf8')
await writeFile(join(data, 'workspaces.json'), JSON.stringify([{ id: 'qa-upstream', name: 'Upstream Model QA', path: project, color: '#5B8CFF', pinned: true, createdAt: Date.now(), lastOpenedAt: Date.now() }]), 'utf8')
await writeFile(join(data, 'prompts.json'), '[]', 'utf8')

async function buildSnapshot() {
  const files = {}
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(?:js|css|html)$/.test(entry.name)) files[relative(root,path).replaceAll('\\','/')] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await walk(join(root, 'out'))
  return files
}
const buildFiles = await buildSnapshot()
async function packagedSnapshot() {
  if (!packaged) return null
  const { extractFile, listPackage, uncache } = await import('@electron/asar')
  const archive = join(dirname(appExecutable), 'resources', 'app.asar')
  // Re-read archive metadata as well as bytes on the post-run comparison.
  uncache(archive)
  const manifest = JSON.parse(extractFile(archive, 'package.json').toString('utf8'))
  assert.equal(manifest.name, appPackage.name, 'Packaged app name must match this project')
  assert.equal(manifest.version, appPackage.version, 'Packaged app version must match package.json')
  const files = {}
  for (const entry of listPackage(archive)) {
    const path = entry.replaceAll('\\','/').replace(/^\//,'')
    if (/^out\/.*\.(?:js|css|html)$/.test(path)) files[path] = createHash('sha256').update(extractFile(archive,join(...path.split('/')))).digest('hex')
  }
  assert.deepEqual(files,buildFiles,'Packaged app bundle must match the current out files')
  return {
    executable:appExecutable,executableSha256:createHash('sha256').update(await readFile(appExecutable)).digest('hex'),
    archive,archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex'),
    name:manifest.name,version:manifest.version,buildFiles:files
  }
}
const packagedBundle = await packagedSnapshot()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const sanitize = value => {
  let result = String(value)
  if (liveConfig?.apiKey) result = result.split(liveConfig.apiKey).join('[redacted-key]')
  return result.replace(/([?&]token=)[^&\s"']+/g, '$1[isolated-token]').replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
}
const safeUrl = url => { try { const parsed = new URL(url); return parsed.origin + parsed.pathname } catch { return sanitize(url) } }
const checks = [], inputFallbacks = [], screenshots = [], executions = [], network = [], uncaughtErrors = []
let running
let appInfo
let liveResult
let liveStateRemoved = false
let isolatedStateRemoved = false
let keyboardSession
async function cleanupIsolatedState() {
  if (!liveConfig && !keepOpenForKeyboard) return
  // Only remove the disposable state created by this run, never the supplied
  // key file, installed runtime, or any directory found in user settings.
  assert.equal(dirname(qa), qaParent)
  assert.ok(qa.startsWith(join(qaParent, 'electron-')))
  for (const path of [data, dshHome, agentsHome, documents, temp, join(qa, 'home'), join(qa, 'appdata'), join(qa, 'localappdata')]) {
    const part = relative(qa, resolve(path))
    assert.ok(part && !part.startsWith('..') && !isAbsolute(part))
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })
  }
  liveStateRemoved = Boolean(liveConfig)
  isolatedStateRemoved = true
}
async function freePort() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port }
class Client {
  constructor(target, name) {
    this.target = target; this.name = name; this.ws = new WebSocket(target.webSocketDebuggerUrl); this.pending = new Map(); this.seq = 0; this.errors = []
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return
        this.pending.delete(message.id); clearTimeout(pending.timer)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      } else if (message.method === 'Runtime.exceptionThrown') this.errors.push(sanitize(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text))
      else if (message.method === 'Network.requestWillBeSent') {
        const request = message.params.request
        let rpc
        try { rpc = JSON.parse(request.postData || '{}').method } catch {}
        network.push({ surface: name, method: request.method, url: safeUrl(request.url), ...(rpc ? { rpc } : {}) })
      }
    })
  }
  async ready() { await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }) }); await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable') }
  send(method, params = {}) { const id = ++this.seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 25000); this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value }
  close() { for (const pending of this.pending.values()) clearTimeout(pending.timer); this.pending.clear(); this.ws.close() }
}
const main = expression => running.clients.main.eval(expression)
async function waitFor(name, condition, timeout = 20000) { const started=Date.now(),end = started + timeout; let last,nextProgress=started+20000; while (Date.now() < end) { try { last = await condition(); if (last) return last } catch (error) { last = sanitize(error.message) } if(Date.now()>=nextProgress){console.log('WAIT '+name+' ('+Math.round((Date.now()-started)/1000)+'s)');nextProgress+=20000} await delay(150) } throw new Error('Timed out: ' + name + '; last=' + JSON.stringify(last)) }
async function check(name, run) { const detail = await run(); checks.push({ name, passed: true, detail }); console.log('PASS ' + name) }
async function action(type, extra = {}) { await main('window.studio.studio.runAction(' + JSON.stringify({ type, ...extra }) + '); true'); await delay(120) }
async function navigate(view) { await action('navigate', { view }); await delay(180) }
async function guest(index, code) { return main(`document.querySelectorAll('webview')[${index}].executeJavaScript(${JSON.stringify(code)})`) }
async function targets() { return (await fetch('http://127.0.0.1:' + running.port + '/json/list')).json() }
async function attachGuest(index) {
  const id = await main(`document.querySelectorAll('webview')[${index}].getWebContentsId()`)
  const marker = 'upstream-qa-' + id
  await guest(index, `window.__qaUpstreamDocument ||= crypto.randomUUID(); document.title = ${JSON.stringify(marker)}; true`)
  const target = await waitFor('guest CDP target ' + id, async () => (await targets()).find(item => item.title === marker))
  const client = new Client(target, 'guest-' + index); await client.ready()
  running.guestClients[index] = client
  return { id, type: target.type }
}
async function snapshot(index) {
  const id = await main(`document.querySelectorAll('webview')[${index}].getWebContentsId()`)
  return { guestId: id, ...await guest(index, `(() => {
    const root = [...document.querySelectorAll('[data-conversation-content][data-conversation-session]')].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })
    const editor = root?.querySelector('[contenteditable="true"]')
    const selected = document.querySelector('nav button[aria-label="插件"][aria-current="page"], nav button[aria-label="Plugins"][aria-current="page"]')
    return { documentId: window.__qaUpstreamDocument, sessionId: root?.getAttribute('data-conversation-session') || null, draft: editor?.textContent || null, pluginsSelected: Boolean(selected), url: location.origin + location.pathname, timeOrigin: performance.timeOrigin }
  })()`) }
}
async function screenshot(surface, name) { const client = surface.startsWith('guest-') ? running.guestClients[Number(surface.slice(6))] : running.clients[surface]; const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const path = join(reportDir, name + '.png'); await writeFile(path, Buffer.from(result.data, 'base64')); screenshots.push(path) }
async function rememberHost() { const status = await main('window.studio.host.status()'); if (status.pid && !running.execution.hostPids.includes(status.pid)) running.execution.hostPids.push(status.pid); return { state: status.state, pid: status.pid, url: status.url ? safeUrl(status.url) : undefined, error: sanitize(status.error || '') } }
async function launch() {
  const port = await freePort()
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'programfiles', 'programfiles(x86)', 'commonprogramfiles', 'commonprogramfiles(x86)', 'processor_architecture', 'number_of_processors'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toLowerCase())))
  Object.assign(env, { HARNESS_STUDIO_USER_DATA: data, DSH_HOME: dshHome, DSH_AGENTS_HOME: agentsHome, DSH_TELEMETRY_DISABLED: '1', HOME: join(qa, 'home'), USERPROFILE: join(qa, 'home'), APPDATA: join(qa, 'appdata'), LOCALAPPDATA: join(qa, 'localappdata'), TEMP: temp, TMP: temp, TMPDIR: temp })
  assert.equal(Object.keys(env).some(name => /api.?key|token|secret|cookie|credential/i.test(name)), false)
  const startedAt = Date.now()
  const child = spawn(appExecutable, [...(packaged?[]:[root]), '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port], { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const execution = { startedAt, electronPid: child.pid, hostPids: [], descendantPids: [], helperPids: [], launchEnvironmentNames: Object.keys(env).sort() }; executions.push(execution)
  let log = ''; child.stdout.on('data', chunk => { log += chunk.toString() }); child.stderr.on('data', chunk => { log += chunk.toString() })
  running = { child, clients: {}, guestClients: {}, port, log: () => sanitize(log), execution, env }
  const appTargets = await waitFor('three app targets', async () => { const values = (await targets()).filter(item => item.type === 'page' && item.url.includes('index.html')); return values.length === 3 ? values : null }, 20000)
  for (const surface of ['main', 'palette', 'quickask']) { const target = appTargets.find(item => surface === 'main' ? !item.url.includes('#') : item.url.includes('#' + surface)); const client = running.clients[surface] = new Client(target, surface); await client.ready() }
  await waitFor('main initialization', () => main('Boolean(window.studio && document.querySelector(".plugin-entry"))'))
  appInfo = await main('window.studio.app.info()')
  assert.equal(appInfo.version,appPackage.version,'Running app version must match package.json')
  assert.equal(appInfo.isPackaged,packaged,'Running app package mode must match the selected executable')
  assert.equal(resolve(appInfo.userData),data,'Running app must use the isolated userData')
  assert.equal(resolve(appInfo.dshHome),dshHome,'Running app must use the isolated DSH home')
}
async function stop() {
  if (!running) return
  try {
    if(running.child.exitCode===null)await rememberHost()
    const helper=spawn(join(running.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{Name="StartedAt";Expression={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress'],{env:running.env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    running.execution.helperPids.push(helper.pid)
    let output='';helper.stdout.on('data',chunk=>{output+=chunk.toString()})
    await new Promise((resolve,reject)=>{helper.once('exit',code=>code===0?resolve():reject(new Error('process tree inspection failed')));helper.once('error',reject)})
    const rows=JSON.parse(output),owned=new Set([running.execution.electronPid,...running.execution.hostPids])
    let changed=true;while(changed){changed=false;for(const row of rows)if(row.StartedAt>=running.execution.startedAt&&owned.has(row.ParentProcessId)&&!owned.has(row.ProcessId)){owned.add(row.ProcessId);changed=true}}
    running.execution.descendantPids=[...owned].filter(pid=>pid!==running.execution.electronPid&&!running.execution.hostPids.includes(pid))
  } catch(error) { running.execution.processTreeInspectionError=sanitize(error.message) }
  if(running.child.exitCode===null)try { await main('window.studio.host.stop()'); await main('window.studio.app.close(); true') } catch {}
  for (const [surface, client] of [...Object.entries(running.clients), ...Object.entries(running.guestClients).map(([index, client]) => ['guest-' + index, client])]) { uncaughtErrors.push({ surface, errors: client.errors }); client.close() }
  if (running.child.exitCode === null) { await Promise.race([new Promise(resolve => running.child.once('exit', resolve)), delay(6000)]); if (running.child.exitCode === null) running.child.kill() }
  await writeFile(join(reportDir, 'electron.log'), running.log(), 'utf8')
  running = null
}
async function conversationReady(index) {
  await waitFor('visible conversation ' + index, () => guest(index, `Boolean([...document.querySelectorAll('[data-conversation-content][data-conversation-session]')].find(root => { const r = root.getBoundingClientRect(); return r.width > 0 && r.height > 0 && root.querySelector('[contenteditable="true"]') }))`), 25000)
}
async function workspaceReady(index) {
  // runAction is fire-and-forget. An old composer can remain visible while the
  // real project navigation is pending; never use that composer as a baseline.
  await waitFor('confirmed workspace ' + index, async () => {
    const shell = await main(`(() => {
      const footnote = document.querySelector('.workspace-footnote')
      return { path: footnote?.getAttribute('title'), pending: Boolean(document.querySelector('.workspace-switcher .spin, .workspace-footnote .spin')) }
    })()`)
    if (shell.pending || !shell.path || resolve(shell.path) !== project) return false
    const location = await guest(index, `(async () => {
      const current = () => [...document.querySelectorAll('[data-conversation-content][data-conversation-session]')]
        .find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 })?.getAttribute('data-conversation-session')
      const id = current(), rpcId = crypto.randomUUID(), method = 'session/list'
      if (!id) return null
      const response = await fetch('api/' + method, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { _request: {} } } })
      })
      const body = await response.json()
      if (!response.ok || body.rpcId !== rpcId || body.result?.ok !== true) throw new Error('Cannot verify official session cwd')
      return current() === id ? body.result.value.items?.find(item => item.sessionId === id) : null
    })()`)
    return location?.cwd && resolve(location.cwd) === project
  }, 30000)
}
async function acknowledgePreview(index) {
  await waitFor('initial preview notice renders',()=>guest(index,'/预览版说明|Preview Notice/.test(document.body.innerText)'),10000)
  const preview=await guest(index, `(() => {
    const dialogs=[...document.querySelectorAll('[role="dialog"], [class*="Dialog"], [class*="dialog"]')]
    const dialog=dialogs.find(el => /预览版说明|Preview Notice/i.test(el.textContent || ''))
    if(!dialog)return {acknowledged:false}
    if(/API Key|登录|授权|删除|卸载|重置/.test(dialog.textContent || ''))throw new Error('informational preview acknowledgement included a sensitive action')
    const button=[...dialog.querySelectorAll('button')].find(el => /^(继续|Continue)$/.test(el.textContent.trim()))
    if(!button)throw new Error('preview acknowledgement button absent')
    button.click();return {acknowledged:true,button:button.textContent.trim()}
  })()`)
  assert.equal(preview.acknowledged,true,'initial preview acknowledgement was located')
  await waitFor('preview notice removed',()=>guest(index,'!/预览版说明|Preview Notice/.test(document.body.innerText)'),10000)
  return preview
}
async function insertDraft(index, value) {
  await main(`document.querySelectorAll('webview')[${index}].focus(); true`)
  const focus = await guest(index, `(() => { const root = [...document.querySelectorAll('[data-conversation-content][data-conversation-session]')].find(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 }); const editor = root?.querySelector('[contenteditable="true"]'); if (!editor) return false; editor.focus(); const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return document.activeElement===editor; })()`)
  assert.equal(focus, true)
  await running.guestClients[index].send('Input.insertText', { text: value })
  await delay(400)
  if((await snapshot(index)).draft!==value) {
    assert.ok((await snapshot(index)).draft===null||(await snapshot(index)).draft==='','native fallback only from empty composer; avoids duplicate input')
    const inserted=await waitFor('native no-send input ready',async()=>{
      const result=await main('window.studio.quickAsk.submit('+JSON.stringify(value)+',{autoSend:false,reveal:false})')
      if(result.status==='needs-host')return null
      assert.equal(result.status,'inserted',JSON.stringify(result))
      return result
    },12000)
    inputFallbacks.push({guestIndex:index,input:'WebContents.insertText through existing QuickAsk IPC',autoSend:false,reveal:false,status:inserted.status})
  }
  await waitFor('real draft inserted ' + index, async () => (await snapshot(index)).draft === value)
  await delay(500)
}
async function sessionAudit() {
  const files = []
  async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) { const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.jsonl')) { const rows=(await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));files.push({path,rows:rows.map(row => ({type:row.type,role:row.role,kind:row.kind}))});assert.equal(rows.some(row=>row.role==='user'||row.type==='user'||row.type==='turn-start'||row.type==='turn-trigger'),false,'no submitted prompts or model turns in isolated logs') } } }
  await walk(join(dshHome,'sessions'))
  return files
}
async function credentialSummary() {
  const path=join(dshHome,'.credentials.yaml')
  const document=await readFile(path,'utf8').then(value=>yaml.load(value),error=>error.code==='ENOENT'?{}:Promise.reject(error))
  const refKeys=Object.keys(document.refs || {}),recordKeys=Object.keys(document.records || {})
  assert.equal(refKeys.length,0,'no model API keys stored')
  assert.ok(recordKeys.every(key=>key==='client-connection/browser-session'),'only local browser authentication grant, no account or model credentials')
  return {refKeys,recordKeys,recordKinds:Object.fromEntries(recordKeys.map(key=>[key,document.records[key].kind]))}
}

async function modelPanel(index, choice='models') {
  return main(`(async()=>{const frame=document.querySelectorAll('webview')[${index}];const id=frame.getWebContentsId();window.studio.tabs.setActiveGuest(id,{visible:true,focus:false});return window.studio.tabs.openModels(id,'qa-model-'+crypto.randomUUID(),${JSON.stringify(choice)})})()`)
}
async function closeSettings(index) {
  await guest(index,`(()=>{const panel=document.querySelector('[data-shortcut-modal="settings"]');if(!panel)return true;const button=[...panel.querySelectorAll('button')].find(button=>button.querySelector('[data-slot="settings.close"]'));if(!button)throw new Error('official Settings close missing');button.click();return true})()`)
  await waitFor('settings closed',()=>guest(index,'!document.querySelector("[data-shortcut-modal=settings]")'))
}
async function modelsSnapshot(index) {
  return guest(index,`(()=>{const panel=document.querySelector('[data-shortcut-modal="settings"]');const nav=[...(panel?.querySelectorAll('nav button')||[])].map(button=>({label:button.textContent.trim(),current:button.getAttribute('aria-current')}));const section=panel?.querySelector('[data-slot="settings.section"]');return {settings:Boolean(panel),navigation:nav,custom:Boolean(section?.querySelector('input[aria-label="Provider ID"]')),inputs:[...(section?.querySelectorAll('input')||[])].map(input=>({label:input.getAttribute('aria-label'),type:input.type,empty:input.value===''})),documentId:window.__qaUpstreamDocument,timeOrigin:performance.timeOrigin}})()`)
}
async function waitForHumanKeyboardCheck() {
  const sessionFile = join(reportDir,'keyboard-session.json')
  const stopRequestFile = join(reportDir,'keyboard-stop.request')
  await running.clients.main.send('Emulation.clearDeviceMetricsOverride')
  const beforeComposer = await main('(async()=>{const settings=await window.studio.settings.get();return settings.composer})()')
  await main(`window.studio.settings.save({language:"zh-CN",composer:${JSON.stringify({...beforeComposer,confirmSend:true})}})`)
  const composer = await main('(async()=>{const settings=await window.studio.settings.get();return settings.composer})()')
  assert.equal(composer.confirmSend,true,'Human Enter/cancel verification requires send confirmation')
  assert.deepEqual(composer,{...beforeComposer,confirmSend:true},'Other composer settings must be preserved')
  const credentials = await credentialSummary()
  await navigate('workspace')
  await conversationReady(1)
  keyboardSession = {
    status:'awaiting-human-keyboard-check',humanKeyboardVerified:false,
    note:'The eight checks and existing drafts were automated. Actual keyboard, focus, and IME behavior require a human to verify.',
    composer,credentials,
    keyboardInstructions:'Type in the composer, press Enter, then cancel the send confirmation and check that the draft remains. This isolated session has no model credentials. Do not confirm sending or add credentials for this keyboard check.',
    startedAt:new Date().toISOString(),runnerPid:process.pid,electronPid:running.child.pid,
    hostPids:[...running.execution.hostPids],appExecutable,appInfo,
    isolatedRoot:qa,reportDir,stopRequestFile,
    closeInstructions:'Close the isolated app, press Ctrl+C in the runner, or create stopRequestFile. The runner stops its Host and app, then removes isolated account/browser state. It does not infer or record a human keyboard pass.'
  }
  await writeFile(sessionFile,JSON.stringify(keyboardSession,null,2)+'\n','utf8')
  let interrupted=false
  const interrupt=()=>{interrupted=true}
  process.on('SIGINT',interrupt)
  process.on('SIGTERM',interrupt)
  console.log('KEYBOARD READY: '+sessionFile)
  console.log('Human keyboard verification is pending. Create this empty file to close and clean up: '+stopRequestFile)
  try {
    for (;;) {
      if(interrupted){keyboardSession.stopReason='runner-interrupted';break}
      if(running.child.exitCode!==null){keyboardSession.stopReason='app-closed';break}
      if(await stat(stopRequestFile).then(()=>true,error=>error.code==='ENOENT'?false:Promise.reject(error))){keyboardSession.stopReason='stop-requested';break}
      await delay(250)
    }
  } finally {
    process.off('SIGINT',interrupt)
    process.off('SIGTERM',interrupt)
  }
  keyboardSession.status='closing'
  await writeFile(sessionFile,JSON.stringify(keyboardSession,null,2)+'\n','utf8')
}
try {
  await launch()
  await check('Official DSH starts with isolated homes and no model/account credentials', async () => {
    const detected=await main('window.studio.runtime.detect()');assert.equal(detected.version,upstreamPackage.version);assert.equal(resolve(detected.dshHome),dshHome)
    await main('window.studio.host.start("qa-upstream")')
    const host=await waitFor('Host ready',async()=>{const status=await rememberHost();if(status.state==='error')throw new Error(status.error);return status.state==='ready'?status:null},165000)
    await action('open-workspace',{id:'qa-upstream'})
    await waitFor('webview mounted',()=>main('document.querySelectorAll("webview").length===1'))
    await waitFor('official launcher mounted',()=>guest(0,'Boolean(document.querySelector("[data-slot=\\"settings.launcher\\"] button"))'),30000)
    await attachGuest(0)
    return {runtime:detected.version,host,userData:data,dshHome,agentsHome,documents,project}
  })
  await check('The model entry leaves the initial official preview notice unacknowledged',async()=>{
    await waitFor('preview visible',()=>guest(0,'/预览版说明|Preview Notice/.test(document.body.innerText)'),15000)
    const before=await guest(0,'document.body.innerText.includes("预览版说明")||document.body.innerText.includes("Preview Notice")')
    const dismissals=[]
    for(const dismissal of ['later','close']){
      await main('window.studio.settings.save({modelSetupSeen:false})')
      await waitFor('Studio first-use model dialog',()=>main('Boolean(document.querySelector(".model-setup-grid"))'))
      await main(dismissal==='later'
        ? 'document.querySelectorAll(".model-setup-choice")[2].click();true'
        : 'document.querySelector(".model-setup-grid").closest(".modal").querySelector(".modal-header button").click();true')
      await waitFor('Studio model choice dismissed above official preview',()=>main('!document.querySelector(".model-setup-grid")'))
      assert.equal((await main('window.studio.settings.get()')).modelSetupSeen,true)
      assert.equal(await guest(0,'/预览版说明|Preview Notice/.test(document.body.innerText)'),true)
      dismissals.push({dismissal,seen:true,officialNoticePreserved:true})
    }
    const result=await modelPanel(0,'custom');assert.equal(result.status,'blocked')
    assert.equal(await guest(0,'document.body.innerText.includes("预览版说明")||document.body.innerText.includes("Preview Notice")'),before)
    await screenshot('guest-0','preview-preserved')
    return {result,noticePreserved:before,studioDismissals:dismissals}
  })
  await check('After explicit QA preview acknowledgement, custom entry bypasses blank account onboarding',async()=>{
    const preview=await acknowledgePreview(0)
    await delay(800)
    const result=await modelPanel(0,'custom')
    if(result.status!=='opened'){
      const diagnosis=await guest(0,`(()=>({dialogs:[...document.querySelectorAll('[role="dialog"]')].map(dialog=>({heading:dialog.querySelector('h2')?.textContent.trim(),settings:dialog.getAttribute('data-shortcut-modal'),ariaModal:dialog.getAttribute('aria-modal'),rect:{width:dialog.getBoundingClientRect().width,height:dialog.getBoundingClientRect().height},style:{display:getComputedStyle(dialog).display,visibility:getComputedStyle(dialog).visibility,opacity:getComputedStyle(dialog).opacity}})),inputs:[...document.querySelectorAll('[data-slot="settings.section"] input,[data-slot="settings.section"] textarea,[data-slot="settings.section"] [contenteditable="true"]')].map(input=>({label:input.getAttribute('aria-label'),type:input.type,filled:Boolean((input.value??input.textContent??'').trim()),disabled:input.disabled,readOnly:input.readOnly,details:input.closest('details')?.open,rect:{width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height},style:{display:getComputedStyle(input).display,visibility:getComputedStyle(input).visibility}}))}))()`)
      console.log('MODEL DIAGNOSIS '+JSON.stringify(diagnosis));await writeFile(join(reportDir,'failure-controls.json'),JSON.stringify(diagnosis,null,2)+'\n','utf8')
    }
    assert.equal(result.status,'opened',JSON.stringify(result))
    const snapshot=await modelsSnapshot(0);assert.equal(snapshot.settings,true);assert.equal(snapshot.custom,true)
    assert.ok(snapshot.navigation.some(row=>['模型','Models'].includes(row.label)&&row.current==='true'))
    assert.ok(snapshot.inputs.filter(input=>input.type==='password'||['Provider ID','显示名称','Display name','API 地址','Base URL'].includes(input.label)).every(input=>input.empty))
    await screenshot('main','first-custom-model-entry');await screenshot('guest-0','official-custom-model-form')
    return {preview,result,snapshot,credentials:await credentialSummary()}
  })
  await check('A real draft survives opening and closing model settings',async()=>{
    await closeSettings(0);await action('open-workspace',{id:'qa-upstream'});await conversationReady(0);await workspaceReady(0)
    await insertDraft(0,'Model entry QA A 中文：保留且不发送。')
    const before=await snapshot(0);assert.ok(before.sessionId)
    const result=await modelPanel(0,'models');assert.equal(result.status,'opened')
    const panel=await modelsSnapshot(0);assert.equal(panel.documentId,before.documentId);assert.equal(panel.timeOrigin,before.timeOrigin)
    await closeSettings(0);await conversationReady(0)
    const after=await snapshot(0);assert.deepEqual(after,before)
    return {before,modelPanel:panel,after}
  })
  const firstDraft=await snapshot(0)
  await check('A second tab can choose Later without an account or model',async()=>{
    await action('new-tab');await waitFor('two guests',()=>main('document.querySelectorAll("webview").length===2'))
    await waitFor('second official launcher',()=>guest(1,'Boolean(document.querySelector("[data-slot=\\"settings.launcher\\"] button"))'),30000)
    await attachGuest(1)
    const result=await modelPanel(1,'later');assert.equal(result.status,'opened')
    await action('open-workspace',{id:'qa-upstream'});await conversationReady(1);await workspaceReady(1)
    const inherited=await snapshot(1)
    await guest(1,`(()=>{const button=[...document.querySelectorAll('button')].find(button=>/^(新建会话|新会话|New Session)$/i.test(button.getAttribute('aria-label')||'')&&!button.disabled);if(!button)throw new Error('official New Session missing');button.click();return true})()`)
    await waitFor('independent second session',async()=>{const state=await snapshot(1);return state.sessionId&&state.sessionId!==inherited.sessionId&&state.sessionId!==firstDraft.sessionId})
    await conversationReady(1);await insertDraft(1,'Model entry QA B：当前标签草稿。')
    assert.deepEqual(await snapshot(0),firstDraft)
    return {result,first:await snapshot(0),second:await snapshot(1),credentials:await credentialSummary()}
  })
  const secondDraft=await snapshot(1)
  await check('Home model entry opens only the foreground tab without restarting or losing drafts',async()=>{
    const host=await rememberHost();await navigate('home');await action('open-models',{choice:'custom'})
    await waitFor('foreground custom form',async()=>(await modelsSnapshot(1)).custom,15000)
    assert.deepEqual(await snapshot(0),firstDraft)
    const panel=await modelsSnapshot(1);assert.equal(panel.documentId,secondDraft.documentId);assert.equal(panel.timeOrigin,secondDraft.timeOrigin)
    assert.equal((await rememberHost()).pid,host.pid)
    await screenshot('main','two-tabs-model-entry')
    await closeSettings(1);await conversationReady(1);assert.deepEqual(await snapshot(1),secondDraft)
    return {hostPid:host.pid,background:await snapshot(0),panel,returned:await snapshot(1)}
  })
  await check('A background guest is rejected by the trusted model IPC',async()=>{
    const result=await main(`window.studio.tabs.openModels(document.querySelectorAll('webview')[0].getWebContentsId(),'qa-background-'+crypto.randomUUID(),'custom')`)
    assert.equal(result.status,'cancelled');assert.deepEqual(await snapshot(0),firstDraft);assert.deepEqual(await snapshot(1),secondDraft)
    return result
  })
  await check('English shell and official model form remain usable at 1040 px',async()=>{
    await main('window.studio.settings.save({language:"en-US",window:{width:1040,height:780,maximized:false}})')
    await running.clients.main.send('Emulation.setDeviceMetricsOverride',{width:1040,height:780,deviceScaleFactor:1,mobile:false})
    assert.equal(await main('document.documentElement.clientWidth'),1040)
    // Shell language changes immediately; Harness manages its own language.
    await action('open-models',{choice:'custom'});await waitFor('custom form after language change',async()=>(await modelsSnapshot(1)).custom)
    const panel=await modelsSnapshot(1);assert.equal(panel.documentId,secondDraft.documentId);assert.equal(panel.timeOrigin,secondDraft.timeOrigin)
    await screenshot('main','english-custom-entry');await closeSettings(1);await navigate('settings')
    await action('open-settings',{section:'models'});await delay(350);await screenshot('main','english-studio-model-settings')
    return {panel,shellLanguage:await main('document.documentElement.lang')}
  })
  const audit=await sessionAudit()
  const modelRequests=network.filter(row=>/\/messages$|\/chat\/completions$|\/responses$/.test(row.url)||/^(?:turn|agent|session)\/(?:submit|send|prompt|run|startTurn)/i.test(row.rpc||''))
  const credentialWrites=network.filter(row=>/^credentials\/(?:set|remove|delete|reset)/.test(row.rpc||''))
  assert.equal(modelRequests.length,0);assert.equal(credentialWrites.length,0)
  const credentials=await credentialSummary(),host=await rememberHost()
  if (liveConfig) {
    const { runLiveChecks } = await import('./lib/upstream-live-checks.mjs')
    liveResult = await runLiveChecks({ config: liveConfig, main, guest, waitFor, action, navigate,
      modelPanel, closeSettings, snapshot, insertDraft, conversationReady, workspaceReady,
      getGuestClient: index => running.guestClients[index], attachGuest, project, dshHome, reportDir, check })
  }
  if (keepOpenForKeyboard) {
    assert.equal(checks.length,8,'Human keyboard mode begins only after all eight automatic checks pass')
    await writeFile(join(reportDir,'report.json'),sanitize(JSON.stringify({checkedAt:new Date().toISOString(),passed:true,automaticChecksOnly:true,scope:'Eight automatic navigation checks completed without model requests or provider credential writes. Human keyboard verification is pending; activity during the following manual phase is not covered by the automatic no-request result.',appInfo,appExecutable,packagedBundle,rendererBuild,buildFiles,upstreamVersion:upstreamPackage.version,checks,inputFallbacks,screenshots,isolatedRoot:qa,allOwnedProcessesStopped:false,humanKeyboardVerified:false},null,2))+'\n','utf8')
    await waitForHumanKeyboardCheck()
  }
  await stop()
  assert.deepEqual(await buildSnapshot(),buildFiles,'out remained stable during real upstream QA')
  assert.deepEqual(await packagedSnapshot(),packagedBundle,'packaged application remained stable during real upstream QA')
  const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
  await waitFor('owned processes exited', () => executions.every(item=>!alive(item.electronPid)&&[...item.hostPids,...item.descendantPids,...item.helperPids].every(pid=>!alive(pid))), 10000)
  assert.ok(uncaughtErrors.every(item=>item.errors.length===0),'no uncaught renderer exceptions')
  await cleanupIsolatedState()
  if(keyboardSession){keyboardSession.status='closed';keyboardSession.closedAt=new Date().toISOString();keyboardSession.isolatedStateRemoved=isolatedStateRemoved;await writeFile(join(reportDir,'keyboard-session.json'),JSON.stringify(keyboardSession,null,2)+'\n','utf8')}
  await writeFile(join(reportDir,'report.json'),sanitize(JSON.stringify({checkedAt:new Date().toISOString(),passed:true,appInfo,appExecutable,packagedBundle,rendererBuild,upstreamVersion:upstreamPackage.version,buildFiles,scope:liveConfig ? 'Real Studio/official DSH model navigation plus explicitly configured live provider acceptance. See liveResult for exact coverage; live credential and browser state removed after exit.' : keepOpenForKeyboard ? 'Eight automatic Studio/official DSH navigation checks completed in isolated state without model requests or provider credential writes. The subsequent manual keyboard phase is outside that no-request assertion. Human keyboard results remain pending and must be reported separately; closing the app is not a keyboard pass.' : 'Real Studio Electron and installed official DSH, fresh isolated userData/DSH/agents/project, model navigation and blank custom editor only; no account login, no provider key/config writes and no submitted prompt. QA explicitly acknowledged only the official informational preview.',checks,inputFallbacks,screenshots,executions,uncaughtErrors,host,credentialsBeforeLive:credentials,isolatedRoot:qa,overlay,network:{requests:network,navigationModelRequests:0,navigationCredentialWrites:0},sessionAuditBeforeLive:audit,liveResult,liveStateRemoved,isolatedStateRemoved,keyboardSession,allOwnedProcessesStopped:true},null,2))+'\n','utf8')
  console.log('VERIFIED '+checks.length+' real upstream model checks')
}catch(error){
  console.error(sanitize(error.stack))
  if(running){try{
    const expression = liveConfig
      ? `(() => ({ dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => el.querySelector('h2')?.textContent || ''), inputs: [...document.querySelectorAll('input')].map(el => ({type:el.type,label:el.getAttribute('aria-label')})), toolStates: [...document.querySelectorAll('[data-tool]')].map(el => ({name:el.getAttribute('data-tool'),state:el.getAttribute('data-state')})) }))()`
      : 'document.body.innerText'
    const guests = await main(`(async()=>Promise.all([...document.querySelectorAll('webview')].map(async frame=>({dom:await frame.executeJavaScript(${JSON.stringify(expression)}),url:frame.getURL().split('?')[0]}))))()`)
    await writeFile(join(reportDir,'failure-dom.json'),sanitize(JSON.stringify({liveContentOmitted:Boolean(liveConfig),guests},null,2)),'utf8')
  }catch{}}
  await stop()
  let cleanupError
  try { await cleanupIsolatedState() } catch (failure) { cleanupError = sanitize(failure.message) }
  if(keyboardSession){keyboardSession.status='failed';keyboardSession.isolatedStateRemoved=isolatedStateRemoved;await writeFile(join(reportDir,'keyboard-session.json'),JSON.stringify(keyboardSession,null,2)+'\n','utf8')}
  await writeFile(join(reportDir,'report.json'),sanitize(JSON.stringify({checkedAt:new Date().toISOString(),passed:false,error:sanitize(error.stack),appInfo,appExecutable,packagedBundle,checks,inputFallbacks,screenshots,executions,uncaughtErrors,network,isolatedRoot:qa,liveStateRemoved,isolatedStateRemoved,keyboardSession,cleanupError},null,2))+'\n','utf8');process.exitCode=1
}
