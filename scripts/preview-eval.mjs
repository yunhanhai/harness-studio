import { writeFile } from 'node:fs/promises'

const [url, expression, output, widthArg, heightArg] = process.argv.slice(2)
const width = Number(widthArg || 1360)
const height = Number(heightArg || 860)
const debugPort = Number(process.env.CDP_PORT || 9222)

const created = await (
  await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
).json()

const ws = new WebSocket(created.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const events = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve: ok, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else ok(message.result)
    return
  }
  for (const listener of events.get(message.method) ?? []) listener(message.params)
})
const send = (method, params = {}) => {
  const id = ++nextId
  return new Promise((ok, reject) => {
    pending.set(id, { resolve: ok, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const on = (method, listener) => {
  const list = events.get(method) ?? []
  list.push(listener)
  events.set(method, list)
}

await send('Page.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })

const loaded = new Promise((resolve) => on('Page.loadEventFired', resolve))
await send('Page.navigate', { url })
await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 8000))])
await new Promise((resolve) => setTimeout(resolve, 1800))

const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
console.log('EVAL', JSON.stringify(result.result?.value ?? result.result?.description))

if (output) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(output, Buffer.from(shot.data, 'base64'))
  console.log('SHOT', output)
}

ws.close()
await fetch(`http://127.0.0.1:${debugPort}/json/close/${created.id}`).catch(() => undefined)
