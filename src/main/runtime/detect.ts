import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { RuntimeInfo, Settings } from '@shared/types'

const execFileAsync = promisify(execFile)

function existing(paths: Array<string | undefined>): string | undefined {
  for (const path of paths) {
    if (path && existsSync(path)) return path
  }
  return undefined
}

async function where(executable: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('where.exe', [executable], { timeout: 4000, windowsHide: true })
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first && existsSync(first) ? first : undefined
  } catch {
    return undefined
  }
}

async function packageVersion(packageDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: string; version?: string }
    if (parsed.name === '@deepseek-ai/dsh' || parsed.name === 'dsh') return parsed.version
    return parsed.version
  } catch {
    return undefined
  }
}

async function nodeVersion(nodePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(nodePath, ['--version'], { timeout: 5000, windowsHide: true })
    return stdout.trim().replace(/^v/, '')
  } catch {
    return undefined
  }
}

/** Resolve a user-supplied path to a dsh `lib/bin.js` entry. */
function resolveCustomEntry(input: string): string | undefined {
  const path = resolve(input.replace(/^"|"$/g, ''))
  if (!existsSync(path)) return undefined
  if (path.endsWith('bin.js')) return path
  const asPackage = join(path, 'lib', 'bin.js')
  if (existsSync(asPackage)) return asPackage
  const asPackageJson = join(path, 'package.json')
  if (existsSync(asPackageJson)) {
    const sibling = join(path, 'lib', 'bin.js')
    if (existsSync(sibling)) return sibling
  }
  // A `dsh.cmd` shim from an npm global prefix: look for the package next to it.
  const siblingModules = join(dirname(path), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(siblingModules)) return siblingModules
  return undefined
}

export function resolveDshHome(settings: Settings): string {
  const configured = settings.runtime.dshHome.trim()
  if (configured) return resolve(configured)
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export async function detectRuntime(settings: Settings, userData: string): Promise<RuntimeInfo> {
  const checkedAt = Date.now()
  const portableNode = join(userData, 'runtime', 'node', 'node.exe')
  const portableCli = join(userData, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const appData = process.env.APPDATA ?? ''
  const npmGlobalCli = join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

  const nodePath = existing([
    settings.runtime.nodePath.trim() || undefined,
    portableNode,
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    await where('node.exe'),
    await where('node')
  ])

  let cliPath: string | undefined
  let source: RuntimeInfo['source'] = null

  if (settings.runtime.mode === 'custom' && settings.runtime.customPath.trim()) {
    cliPath = resolveCustomEntry(settings.runtime.customPath)
    if (cliPath) source = 'custom'
  }

  if (!cliPath) {
    cliPath = existing([portableCli])
    if (cliPath) source = 'portable'
  }
  if (!cliPath) {
    cliPath = existing([npmGlobalCli])
    if (cliPath) source = 'npm-global'
  }
  if (!cliPath) {
    const shim = await where('dsh.cmd')
    const candidate = shim ? resolveCustomEntry(shim) : undefined
    if (candidate) {
      cliPath = candidate
      source = 'path'
    }
  }

  const dshHome = resolveDshHome(settings)

  if (!nodePath) {
    return {
      state: 'missing',
      source: null,
      dshHome,
      error: '未找到 Node.js。请安装 Node.js 22+，或使用「安装便携运行时」。',
      checkedAt
    }
  }

  const nVersion = await nodeVersion(nodePath)
  if (!nVersion) {
    return { state: 'error', source, nodePath, dshHome, error: 'Node.js 无法执行，请检查路径。', checkedAt }
  }

  if (!cliPath) {
    return {
      state: 'missing',
      source: null,
      nodePath,
      nodeVersion: nVersion,
      dshHome,
      error: '未找到 DeepSeek Harness CLI。可以使用「安装便携运行时」一键部署。',
      checkedAt
    }
  }

  const version = await packageVersion(dirname(dirname(cliPath)))
  return {
    state: 'ready',
    source,
    version,
    nodePath,
    nodeVersion: nVersion,
    cliPath,
    dshHome,
    checkedAt
  }
}

