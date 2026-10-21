import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [url, output, widthArg, heightArg] = process.argv.slice(2)
if (!url || !output) {
  console.error('usage: node scripts/shot.mjs <url> <output.png> [width] [height]')
  process.exit(1)
}
const width = Number(widthArg || 1360)
const height = Number(heightArg || 860)
const debugPort = Number(process.env.CDP_PORT || 9222)

async function createTarget(targetUrl) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT'
  })
  if (!response.ok) throw new Error(`create target failed: ${response.status}`)
  return response.json()
}

async function closeTarget(id) {
  await fetch(`http://127.0.0.1:${debugPort}/json/close/${id}`).catch(() => undefined)
}

function cdp(ws) {
  let nextId = 0
  const pending = new Map()
  const events = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolvePromise(message.result)
      return
    }
    for (const listener of events.get(message.method) ?? []) listener(message.params)
  })
  return {
    send(method, params = {}) {
      const id = ++nextId
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    on(method, listener) {
      const list = events.get(method) ?? []
      list.push(listener)
      events.set(method, list)
    }
  }
}

const target = await createTarget('about:blank')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolvePromise, reject) => {
  ws.addEventListener('open', resolvePromise, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

const client = cdp(ws)
await client.send('Page.enable')
await client.send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false
})
await client.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: 'dark' }]
})

const loaded = new Promise((resolvePromise) => client.on('Page.loadEventFired', resolvePromise))
await client.send('Page.navigate', { url })
await Promise.race([loaded, new Promise((resolvePromise) => setTimeout(resolvePromise, 8000))])
await new Promise((resolvePromise) => setTimeout(resolvePromise, 1600))

const shot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile(resolve(output), Buffer.from(shot.data, 'base64'))
console.log(`SHOT ${output} ${width}x${height}`)

ws.close()
await closeTarget(target.id)
