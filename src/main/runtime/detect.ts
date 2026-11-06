import { t } from '../i18n'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { satisfies, valid, validRange } from 'semver'
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

interface RuntimePackage {
  version?: string
  nodeEngine?: unknown
  error?: 'manifest' | 'engine'
}

async function runtimePackage(packageDir: string): Promise<RuntimePackage> {
  try {
    const raw = await readFile(join(packageDir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown; engines?: unknown } | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'manifest' }
    const version = typeof parsed.version === 'string' ? parsed.version : undefined
    if (parsed.engines !== undefined && (!parsed.engines || typeof parsed.engines !== 'object' || Array.isArray(parsed.engines))) {
      return { version, error: 'engine' }
    }
    return {
      version,
      nodeEngine: (parsed.engines as { node?: unknown } | undefined)?.node
    }
  } catch {
    return { error: 'manifest' }
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
      error: t('main.nodeMissing'),
      checkedAt
    }
  }

  const nVersion = await nodeVersion(nodePath)
  if (!nVersion) {
    return { state: 'error', source, nodePath, dshHome, error: t('main.nodeNotExecutable'), checkedAt }
  }
  if (!valid(nVersion)) {
    return { state: 'error', source, nodePath, nodeVersion: nVersion, cliPath, dshHome, error: t('main.nodeVersionInvalid'), checkedAt }
  }

  if (!cliPath) {
    return {
      state: 'missing',
      source: null,
      nodePath,
      nodeVersion: nVersion,
      dshHome,
      error: t('main.dshMissing'),
      checkedAt
    }
  }

  const { version, nodeEngine, error } = await runtimePackage(dirname(dirname(cliPath)))
  const info: RuntimeInfo = {
    state: 'ready',
    source,
    version,
    nodePath,
    nodeVersion: nVersion,
    cliPath,
    dshHome,
    checkedAt
  }
  if (error) return { ...info, state: 'error', error: t(error === 'manifest' ? 'main.runtimePackageInvalid' : 'main.nodeEngineInvalid') }
  // Read the selected program package rather than a dist-tag or version table.
  // Older DSH releases without engines.node retain their existing behavior.
  if (nodeEngine !== undefined) {
    if (typeof nodeEngine !== 'string' || !nodeEngine.trim() || !validRange(nodeEngine)) {
      return { ...info, state: 'error', error: t('main.nodeEngineInvalid') }
    }
    info.nodeRequirement = nodeEngine.trim()
    if (!satisfies(nVersion, info.nodeRequirement)) {
      return {
        ...info, state: 'error',
        error: t('main.nodeEngineMismatch', { version: version ?? t('main.unknownVersion'), required: info.nodeRequirement, actual: nVersion })
      }
    }
  }
  return info
}

