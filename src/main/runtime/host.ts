import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostStatus, LogLine, RuntimeInfo, Settings } from '@shared/types'
import { logsDirectory, stripAnsi, writeLogLine } from '../logger'

type StatusListener = (status: HostStatus) => void
type LogListener = (line: LogLine) => void

const URL_PATTERN = /dsh web:\s*(https?:\/\/\S+)/
const MAX_LOG_LINES = 4000
const READY_TIMEOUT_MS = 150_000
const STOP_TIMEOUT_MS = 8_000

function maskToken(text: string): string {
  return text.replace(/([?&]token=)[^&\s]+/g, '$1***')
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

interface PreparedProfile {
  profile: string
  profileDir: string
  fromDefault: boolean
  cloned: boolean
}

export interface StartHostOptions {
  runtime: RuntimeInfo
  settings: Settings
  workspacePath?: string
  workspaceId?: string
  tempDir?: string
}

/**
 * Studio avoids fighting the user's running `dsh web` over the same profile.
 * On first use it clones the `web` profile config into an isolated profile.
 */
async function prepareProfile(dshHome: string, requested: string): Promise<PreparedProfile> {
  const profile = requested.trim() || 'studio'
  const profileDir = join(dshHome, 'profiles', profile)
  if (profile === 'web') {
    return { profile, profileDir, fromDefault: false, cloned: false }
  }
  if (existsSync(join(profileDir, 'package.json'))) {
    return { profile, profileDir, fromDefault: false, cloned: false }
  }

  const webDir = join(dshHome, 'profiles', 'web')
  if (!existsSync(join(webDir, 'package.json'))) {
    return { profile, profileDir, fromDefault: true, cloned: false }
  }

  await mkdir(profileDir, { recursive: true })
  for (const file of ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml', '.npmrc']) {
    const source = join(webDir, file)
    if (existsSync(source)) await cp(source, join(profileDir, file), { recursive: true })
  }

  const packageFile = join(profileDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packageFile, 'utf8')) as {
    name?: string
    dependencies?: Record<string, string>
  }
  packageJson.name = `dsh-profile-${profile}`
  await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
    const modules = join(webDir, 'node_modules')
    if (existsSync(modules)) {
      await cp(modules, join(profileDir, 'node_modules'), { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return { profile, profileDir, fromDefault: false, cloned: true }
}

export class HostManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private status: HostStatus = { state: 'stopped' }
  private logs: LogLine[] = []
  private seq = 0
  private readyTimer: NodeJS.Timeout | null = null
  private stopping = false
  private statusListeners = new Set<StatusListener>()
  private logListeners = new Set<LogListener>()
  private logFile = ''
  private logQueue: string[] = []
  private flushing = false
  private lifecycle: Promise<unknown> = Promise.resolve()

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(task, task)
    this.lifecycle = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onLog(listener: LogListener): () => void {
    this.logListeners.add(listener)
    return () => this.logListeners.delete(listener)
  }

  getStatus(): HostStatus {
    return { ...this.status }
  }

  getLogs(): LogLine[] {
    return this.logs.slice()
  }

  clearLogs(): void {
    this.logs = []
  }

  private emitStatus(patch: Partial<HostStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const listener of this.statusListeners) listener(this.getStatus())
  }

  private append(stream: LogLine['stream'], text: string): void {
    const line: LogLine = {
      id: ++this.seq,
      ts: Date.now(),
      stream,
      text: stripAnsi(text).replace(/\r$/, '')
    }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
    for (const listener of this.logListeners) listener(line)
    this.enqueueFile(line)
  }

  private enqueueFile(line: LogLine): void {
    if (!this.logFile) return
    this.logQueue.push(`${new Date(line.ts).toISOString()} [${line.stream}] ${line.text}\n`)
    if (this.flushing) return
    this.flushing = true
    void this.flushFile()
  }

  private async flushFile(): Promise<void> {
    while (this.logQueue.length > 0) {
      const chunk = this.logQueue.join('')
      this.logQueue = []
      try {
        await appendFile(this.logFile, chunk, 'utf8')
      } catch {
        /* keep the app alive even when the log file is locked */
      }
    }
    this.flushing = false
  }

  start(options: StartHostOptions): Promise<HostStatus> {
    return this.enqueue(() => this.startInternal(options))
  }

  private async startInternal(options: StartHostOptions): Promise<HostStatus> {
    const { runtime, settings } = options
    if (this.status.state === 'ready' || this.status.state === 'starting') return this.getStatus()
    if (!runtime.nodePath || !runtime.cliPath) {
      this.emitStatus({ state: 'error', error: '运行时尚未就绪：缺少 Node.js 或 dsh CLI。' })
      return this.getStatus()
    }

    const cwd = options.workspacePath && options.workspacePath.trim() ? options.workspacePath : homedir()
    const port = settings.runtime.port || 0
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...settings.runtime.env,
      DSH_HOME: runtime.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'),
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb'
    }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE

    if (options.tempDir) {
      await mkdir(options.tempDir, { recursive: true }).catch(() => undefined)
      env.TMP = options.tempDir
      env.TEMP = options.tempDir
      env.TMPDIR = options.tempDir
    }

    this.stopping = false
    this.clearLogs()
    this.status = {
      state: 'starting',
      workspaceId: options.workspaceId,
      startedAt: Date.now()
    }
    this.emitStatus({})

    const logDir = logsDirectory()
    this.logFile = join(logDir, `host-${todayStamp()}.log`)
    void mkdir(logDir, { recursive: true }).catch(() => undefined)

    this.append('sys', `工作目录: ${cwd}`)
    this.append('sys', `DSH_HOME: ${env.DSH_HOME}`)

    try {
      const profile = await prepareProfile(String(env.DSH_HOME), settings.runtime.profile || 'studio')
      this.append(
        'sys',
        profile.cloned
          ? `已从 web 配置创建独立档案: ${profile.profile}`
          : `配置档案: ${profile.profile}${profile.fromDefault ? '（首次启动，将从内置模板创建）' : ''}`
      )

      const args = [runtime.cliPath, '--profile', profile.profile]
      if (profile.fromDefault) args.push('--from-default-profile', 'web')
      args.push('--no-open', '--port', String(port), ...settings.runtime.extraArgs)
      this.append('sys', `$ ${runtime.nodePath} ${args.join(' ')}`)

      const child = spawn(runtime.nodePath, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessWithoutNullStreams
      this.child = child
      this.emitStatus({ pid: child.pid })

      let stdoutBuffer = ''
      let stderrBuffer = ''

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) this.handleOutput('out', line)
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) this.handleOutput('err', line)
      })

      child.on('error', (error) => {
        this.clearReadyTimer()
        this.append('sys', `启动失败: ${error.message}`)
        this.emitStatus({ state: 'error', error: error.message, pid: undefined })
        this.child = null
      })

      child.on('exit', (code, signal) => {
        this.clearReadyTimer()
        const wasStopping = this.stopping
        this.stopping = false
        this.child = null
        if (stdoutBuffer.trim()) this.handleOutput('out', stdoutBuffer)
        if (stderrBuffer.trim()) this.handleOutput('err', stderrBuffer)
        if (wasStopping) {
          this.append('sys', 'Host 已停止。')
          this.emitStatus({ state: 'stopped', url: undefined, port: undefined, pid: undefined, startedAt: undefined, error: undefined })
        } else {
          const locked = this.logs
            .slice(-40)
            .some((line) => line.text.includes('EPERM') && line.text.includes('cordis.yml'))
          const reason = locked
            ? 'Host 无法写入配置档案，可能被另一个 dsh 进程占用。请退出其他 dsh web 实例，或在设置 → 运行时中更换配置档案。'
            : `Host 进程意外退出（${signal ? `信号 ${signal}` : `退出码 ${code ?? '未知'}`}）。`
          this.append('sys', reason)
          this.emitStatus({ state: 'error', error: reason, url: undefined, pid: undefined })
        }
      })

      this.readyTimer = setTimeout(() => {
        if (this.status.state !== 'starting') return
        const error = 'Host 启动超时（150 秒）。请查看日志，或检查模型凭据与端口占用。'
        this.append('sys', error)
        this.emitStatus({ state: 'error', error })
        void this.killTree()
      }, READY_TIMEOUT_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.append('sys', `无法启动 Host: ${message}`)
      this.emitStatus({ state: 'error', error: message })
    }

    void writeLogLine('host', 'info', `start requested (cwd=${cwd}, port=${port})`)
    return this.getStatus()
  }

  private handleOutput(stream: 'out' | 'err', rawLine: string): void {
    const line = stripAnsi(rawLine)
    if (!line.trim()) return
    this.append(stream, maskToken(line))
    const match = line.match(URL_PATTERN)
    if (match && this.status.state === 'starting') {
      const url = match[1].replace(/[),.;]+$/, '')
      this.clearReadyTimer()
      let port: number | undefined
      try {
        port = Number(new URL(url).port) || undefined
      } catch {
        port = undefined
      }
      this.append('sys', `Host 已就绪，监听端口 ${port ?? '未知'}。`)
      this.emitStatus({ state: 'ready', url, port, error: undefined })
    }
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  stop(): Promise<HostStatus> {
    return this.enqueue(() => this.stopInternal())
  }

  private async stopInternal(): Promise<HostStatus> {
    if (!this.child) {
      this.status = { state: 'stopped', startedAt: undefined, url: undefined, port: undefined }
      this.emitStatus({})
      return this.getStatus()
    }
    this.stopping = true
    this.emitStatus({ state: 'stopping' })
    const child = this.child
    const exited = new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve()
      const timer = setTimeout(resolve, STOP_TIMEOUT_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    await this.killTree()
    await exited
    this.clearReadyTimer()
    if (this.child) {
      this.child = null
      this.status = { state: 'stopped', url: undefined, port: undefined, startedAt: undefined }
      this.emitStatus({})
    }
    void writeLogLine('host', 'info', 'host stopped')
    return this.getStatus()
  }

  private async killTree(): Promise<void> {
    const child = this.child
    if (!child?.pid) return
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
      return
    }
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }

  restart(options: StartHostOptions): Promise<HostStatus> {
    return this.enqueue(async () => {
      await this.stopInternal()
      return this.startInternal(options)
    })
  }

  /** Synchronous best-effort termination used on app quit. */
  killNow(): void {
    this.stopping = true
    if (this.child?.pid) {
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          /* ignore */
        }
      } else {
        this.child.kill('SIGKILL')
      }
    }
    this.child = null
  }
}
