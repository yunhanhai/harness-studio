import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Keep the working tree lean: drop stale build output, preview copies and
 * screenshots, but never touch source, node_modules or the latest installer.
 */

const root = process.cwd()
const KEEP_VERSION = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8')).version

const junkDirs = ['.preview', '.edge-profile', '.edge-qa', '.dev-userdata', '.icon-build', '.desktop-build']
const junkPrefixes = ['.run-', '.qa-']

const dirSize = async (dir) => {
  let total = 0
  const walk = async (current) => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else total += (await stat(full).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total
}

let freed = 0
const report = []

const entries = await readdir(root, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const isJunk = junkDirs.includes(entry.name) || junkPrefixes.some((prefix) => entry.name.startsWith(prefix))
  if (!isJunk) continue
  const full = join(root, entry.name)
  const size = await dirSize(full)
  await rm(full, { recursive: true, force: true })
  freed += size
  report.push(`  ${entry.name.padEnd(24)} ${(size / 1048576).toFixed(1)} MB`)
}

// dist/win-unpacked is a throwaway copy produced by `dist:dir`.
const unpacked = join(root, 'dist', 'win-unpacked')
const unpackedSize = await dirSize(unpacked).catch(() => 0)
if (unpackedSize > 0) {
  await rm(unpacked, { recursive: true, force: true })
  freed += unpackedSize
  report.push(`  ${'dist/win-unpacked'.padEnd(24)} ${(unpackedSize / 1048576).toFixed(1)} MB`)
}

// Only the current version's installers are worth keeping locally.
const distDir = join(root, 'dist')
const distEntries = await readdir(distDir, { withFileTypes: true }).catch(() => [])
for (const entry of distEntries) {
  if (!entry.isFile()) continue
  const match = entry.name.match(/Harness-Studio-(\d+\.\d+\.\d+)-/)
  if (!match || match[1] === KEEP_VERSION) continue
  const full = join(distDir, entry.name)
  const size = (await stat(full)).size
  await rm(full, { force: true })
  freed += size
  report.push(`  dist/${entry.name}`.padEnd(26) + ` ${(size / 1048576).toFixed(1)} MB`)
}

if (report.length === 0) {
  console.log('没有需要清理的内容。')
} else {
  console.log('已清理：')
  console.log(report.join('\n'))
  console.log(`\n释放 ${(freed / 1048576).toFixed(1)} MB`)
}
