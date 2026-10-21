import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [output, expression, waitArg] = process.argv.slice(2)
if (!output) {
  console.error('usage: node scripts/app-shot.mjs <output.png> [js-expression] [waitMs]')
  process.exit(1)
}
const debugPort = Number(process.env.CDP_PORT || 9333)
const waitMs = Number(waitArg || 2000)

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
const wantsPalette = process.env.TARGET === 'palette'
const wantsQuickAsk = process.env.TARGET === 'quickask'

// The embedded Harness webview is also a CDP page target; only pick the app's
// own renderer so screenshots and evals never hit the wrong document.
const isAppRenderer = (item) => item.type === 'page' && item.url.includes('index.html')
const target = wantsPalette
  ? targets.find((item) => isAppRenderer(item) && item.url.includes('#palette'))
  : wantsQuickAsk
    ? targets.find((item) => isAppRenderer(item) && item.url.includes('#quickask'))
    : targets.find((item) => isAppRenderer(item) && !item.url.includes('#'))
if (!target) {
  console.log('TARGETS', targets.map((item) => item.url).join(' | '))
  throw new Error('window target not found')
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolvePromise, reject) => {
  ws.addEventListener('open', resolvePromise, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve: resolvePromise, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolvePromise(message.result)
  }
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await send('Page.enable')
await send('Runtime.enable')

if (expression) {
  const code = expression.startsWith('@') ? await readFile(resolve(expression.slice(1)), 'utf8') : expression
  const result = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
  console.log('EVAL', JSON.stringify(result.result?.value ?? result.result?.description ?? result))
}
await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(resolve(output), Buffer.from(shot.data, 'base64'))
console.log('APP_SHOT', output)
ws.close()
