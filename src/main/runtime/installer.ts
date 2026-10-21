import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallProgress, Settings } from '@shared/types'
import { logError, writeLogLine } from '../logger'
import { detectRuntime } from './detect'

const NODE_FALLBACKS = ['22.23.3', '22.20.0', '22.18.0']
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000
const INSTALL_TIMEOUT_MS = 12 * 60 * 1000

type ProgressFn = (progress: InstallProgress) => void

function platformTriple(): string {
  if (process.arch === 'arm64') return 'win-arm64'
  return 'win-x64'
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

async function pickNodeVersion(mirror: string): Promise<string> {
  for (const version of NODE_FALLBACKS) {
    const url = `${mirror.replace(/\/$/, '')}/v${version}/node-v${version}-${platformTriple()}.zip`
    if (await urlExists(url)) return version
  }
  return NODE_FALLBACKS[0]
}

async function download(
  url: string,
  destination: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(url, { signal, redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || 0
  const file = createWriteStream(destination)
  const reader = response.body.getReader()
  let received = 0
  let lastEmit = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => file.once('drain', () => resolve()))
      }
      const now = Date.now()
      if (now - lastEmit > 120) {
        lastEmit = now
        onProgress(received, total)
      }
    }
    onProgress(received, total || received)
  } finally {
    await new Promise<void>((resolve) => file.end(() => resolve()))
  }
}

function runNpm(
  nodeExe: string,
  npmCli: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onLine: (line: string) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(nodeExe, [npmCli, ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }) as unknown as ChildProcessWithoutNullStreams
    let done = false
    const finish = (error?: Error): void => {
      if (done) return
      done = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        /* ignore */
      }
      finish(new Error('安装已取消'))
    }
    signal.addEventListener('abort', abort, { once: true })

    let buffer = ''
    const pump = (chunk: string): void => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', pump)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', pump)
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      if (code === 0) finish()
      else finish(new Error(`npm 安装失败（退出码 ${code}）`))
    })
  })
}

export class RuntimeInstaller {
  private controller: AbortController | null = null
  private running = false

  get isRunning(): boolean {
    return this.running
  }

  cancel(): void {
    this.controller?.abort()
  }

  async install(userData: string, settings: Settings, onProgress: ProgressFn, signal?: AbortSignal): Promise<InstallProgress> {
    if (this.running) throw new Error('已有安装任务正在进行')
    this.running = true
    const controller = new AbortController()
    this.controller = controller
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const emit = (phase: InstallProgress['phase'], percent: number, message: string, detail?: string): void => {
      onProgress({ phase, percent: Math.round(percent), message, detail })
    }

    const runtimeDir = join(userData, 'runtime')
    const nodeDir = join(runtimeDir, 'node')
    const tempRoot = join(runtimeDir, `.tmp-${Date.now()}`)
    const zipPath = join(tempRoot, 'node.zip')

    try {
      emit('download-node', 0, '准备下载 Node.js 运行时…')
      await mkdir(tempRoot, { recursive: true })
      const mirror = settings.runtime.nodeMirror || 'https://npmmirror.com/mirrors/node'
      const version = await pickNodeVersion(mirror)
      const triple = platformTriple()
      const url = `${mirror.replace(/\/$/, '')}/v${version}/node-v${version}-${triple}.zip`
      emit('download-node', 1, `正在下载 Node.js ${version}（${triple}）…`, url)

      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
      try {
        await download(
          url,
          zipPath,
          (received, total) => {
            const ratio = total > 0 ? received / total : 0
            emit('download-node', 2 + ratio * 42, `正在下载 Node.js ${version}…`, `${(received / 1024 / 1024).toFixed(1)} MB`)
          },
          controller.signal
        )
      } finally {
        clearTimeout(timeout)
      }

      emit('extract', 46, '正在解压运行时…')
      const extract = (await import('extract-zip')).default
      await extract(zipPath, { dir: tempRoot })
      const entries = await readdir(tempRoot, { withFileTypes: true })
      const extracted = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('node-v'))
      if (!extracted) throw new Error('解压后的运行时目录不完整')
      const sourceDir = join(tempRoot, extracted.name)
      await rm(nodeDir, { recursive: true, force: true }).catch(() => undefined)
      await mkdir(join(runtimeDir), { recursive: true })
      await rename(sourceDir, nodeDir)
      emit('extract', 55, 'Node.js 已就绪')

      const npmCli = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      const nodeExe = join(nodeDir, 'node.exe')
      emit('install-dsh', 56, '正在安装 @deepseek-ai/dsh…', '这一步会下载全部依赖，通常需要 1–3 分钟。')

      let lineCount = 0
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${nodeDir};${process.env.PATH ?? ''}`,
        npm_config_registry: settings.runtime.registry || 'https://registry.npmmirror.com',
        npm_config_cache: join(runtimeDir, 'cache'),
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
        NO_COLOR: '1'
      }
      delete env.ELECTRON_RUN_AS_NODE

      const npmTimeout = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS)
      try {
        await runNpm(
          nodeExe,
          npmCli,
          [
            'install',
            '@deepseek-ai/dsh@latest',
            '--prefix',
            runtimeDir,
            '--registry',
            settings.runtime.registry || 'https://registry.npmmirror.com',
            '--no-audit',
            '--no-fund',
            '--loglevel=error'
          ],
          env,
          (line) => {
            lineCount += 1
            emit('install-dsh', Math.min(93, 58 + lineCount * 0.8), '正在安装 DeepSeek Harness…', line.slice(0, 300))
          },
          controller.signal
        )
      } finally {
        clearTimeout(npmTimeout)
      }

      emit('verify', 95, '正在校验运行时…')
      const info = await detectRuntime(settings, userData)
      if (info.state !== 'ready') throw new Error(info.error || '运行时校验失败')

      emit('done', 100, `运行时安装完成（dsh ${info.version ?? '未知版本'}）`)
      void writeLogLine('runtime', 'info', `portable runtime installed: ${info.cliPath}`)
      return { phase: 'done', percent: 100, message: `运行时安装完成（dsh ${info.version ?? '未知版本'}）` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('runtime-install', error)
      emit('error', 0, controller.signal.aborted ? '安装已取消' : `安装失败：${message}`, message)
      return { phase: 'error', percent: 0, message: controller.signal.aborted ? '安装已取消' : `安装失败：${message}` }
    } finally {
      this.running = false
      this.controller = null
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
