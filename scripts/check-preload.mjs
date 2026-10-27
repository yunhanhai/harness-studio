// Guard against a silent, total preload failure.
//
// Sandboxed preloads (`sandbox: true`) can only `require('electron')` and Node
// builtins. When two preload entries import the same `@shared/*` module, Rollup
// splits it into `chunks/*.js` and every preload starts with
// `require("./chunks/...")`, which throws inside the sandbox. The window then
// renders with no `window.studio` and the UI hangs on the splash screen.
//
// This check turns that silent failure into a build error.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const preloadDir = join(process.cwd(), 'out', 'preload')
const RELATIVE_REQUIRE = /\brequire\(\s*["']\.\.?\//

async function walk(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, files)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}

const files = []
await walk(preloadDir, files)

const offenders = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  const match = source.match(RELATIVE_REQUIRE)
  if (match) offenders.push({ file: relative(process.cwd(), file), snippet: match[0] })
}

if (offenders.length > 0) {
  console.error('preload bundles are not self-contained:')
  for (const item of offenders) console.error(`  ${item.file}  ->  ${item.snippet}...`)
  console.error('')
  console.error('A sandboxed preload cannot require a relative file. Importing one')
  console.error('shared module from two preload entries makes Rollup split it out.')
  console.error('Inline the constant in the preload, or move it to a type-only import.')
  process.exit(1)
}

console.log(`preload check: ${files.length} bundle(s) self-contained`)
