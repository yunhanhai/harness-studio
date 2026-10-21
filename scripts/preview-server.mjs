import { createServer } from 'node:http'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { buildMockScript } from './preview-mock.mjs'

const root = process.cwd()
const outDir = join(root, '.preview')
const appDir = join(outDir, 'app')
const port = Number(process.env.PREVIEW_PORT || 4179)

await rm(appDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp(join(root, 'out', 'renderer'), appDir, { recursive: true })

const builtHtml = await readFile(join(appDir, 'index.html'), 'utf8')
const scripts = [...builtHtml.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1])
const styles = [...builtHtml.matchAll(/href="([^"]+\.css)"/g)].map((match) => match[1])
const asset = (path) => `./app/${path.replace(/^\.?\//, '')}`

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Harness Studio Preview</title>
    ${styles.map((href) => `<link rel="stylesheet" href="${asset(href)}" />`).join('\n    ')}
    <style>html,body,#root{height:100%;margin:0;overflow:hidden}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${buildMockScript()}</script>
    ${scripts.map((src) => `<script type="module" src="${asset(src)}"></script>`).join('\n    ')}
  </body>
</html>`

await writeFile(join(outDir, 'index.html'), html, 'utf8')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'
    const file = normalize(join(outDir, pathname))
    if (!file.startsWith(outDir)) {
      response.writeHead(403).end('forbidden')
      return
    }
    const data = await readFile(file)
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    response.end(data)
  } catch {
    response.writeHead(404).end('not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`PREVIEW_READY http://127.0.0.1:${port}/`)
})
