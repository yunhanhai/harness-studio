import { t } from '../i18n'
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HostStatus, LogLine, RuntimeInfo, Settings } from '@shared/types'
import { logsDirectory, stripAnsi, writeLogLine } from '../logger'

type StatusListener = (status: HostStatus) => void
type LogListener = (line: LogLine) => void

const URL_PATTERN = /dsh web:\s*(https?:\/\/\S+)/
const MAX_LOG_LINES = 4000
const READY_TIMEOUT_MS = 150_000
const STOP_TIMEOUT_MS = 8_000
/** Backoff between automatic restarts after an unexpected crash. */
const RECOVERY_DELAYS_MS = [2_000, 5_000, 15_000]

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

/** Path-only defaults captured from the process that actually launched. */
export interface SkillsLaunchContext {
  nodePath: string
  cliPath: string
  processCwd: string
  dshHome: string
  agentsHome: string
  bundledSkillDir?: string
  profile: string
  profileDir: string
  /** Explicit CLI overlays, in order; provider configuration can override defaults. */
  patchFiles: string[]
  /** Extra launcher identity flags prevent treating the prepared profile as authoritative. */
  configurationUncertain: boolean
}

function skillsLaunchContext(
  options: StartHostOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
  prepared: PreparedProfile
): SkillsLaunchContext {
  const processCwd = resolve(cwd)
  // Node's home resolver in the child sees its own environment, which may be
  // different from Studio's. These are paths only; credentials stay in env.
  const childHome = process.platform === 'win32'
    ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? env.HOMEDRIVE + env.HOMEPATH : homedir())
    : env.HOME || homedir()
  const root = (value: string | undefined, fallback: string): string => {
    const path = value?.trim() ? value : fallback
    const expanded = path === '~' ? childHome
      : path.startsWith('~/') || path.startsWith('~\\') ? join(childHome, path.slice(2)) : path
    return resolve(processCwd, expanded)
  }
  const dshHome = root(env.DSH_HOME, join(childHome, '.dsh'))
  const patchFiles: string[] = []
  let configurationUncertain = false
  const args = options.settings.runtime.extraArgs
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--') break
    if (/^--(?:profile|from-default-profile)(?:=|$)/.test(arg)) configurationUncertain = true
    if (arg === '--patch') {
      const path = args[index + 1]
      if (path && !path.startsWith('-')) { patchFiles.push(resolve(processCwd, path)); index++ }
      else configurationUncertain = true
    } else if (arg.startsWith('--patch=')) {
      const path = arg.slice('--patch='.length)
      if (path) patchFiles.push(resolve(processCwd, path))
      else configurationUncertain = true
    }
  }
  return {
    nodePath: options.runtime.nodePath!,
    cliPath: options.runtime.cliPath!,
    processCwd,
    dshHome,
    agentsHome: root(env.DSH_AGENTS_HOME, join(childHome, '.agents')),
    bundledSkillDir: env.DSH_BUNDLED_SKILL_DIR === undefined ? undefined : resolve(processCwd, env.DSH_BUNDLED_SKILL_DIR),
    profile: prepared.profile,
    profileDir: join(dshHome, 'profiles', prepared.profile),
    patchFiles,
    configurationUncertain
  }
}

/** The parts of the environment that a running host cannot be talked out of. */
function processIdentity(options: StartHostOptions): string {
  const { runtime, settings } = options
  return JSON.stringify([
    runtime.nodePath ?? '',
    runtime.cliPath ?? '',
    runtime.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'),
    settings.runtime.profile || 'studio',
    settings.runtime.port || 0,
    settings.runtime.extraArgs,
    settings.runtime.env
  ])
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
  /** Options from the last successful start, reused when recovering. */
  private lastOptions: StartHostOptions | null = null
  /** Retained across workspace adoption; paths are relative to the original spawn cwd. */
  private skillsContext: SkillsLaunchContext | null = null
  /** How many automatic restarts we have attempted for the current outage. */
  private recoveryAttempt = 0
  private recoveryTimer: NodeJS.Timeout | null = null
  /** Set when recovery must stop (manual stop, restart, or app quit). */
  private recoveryCancelled = false

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

  getSkillsLaunchContext(): SkillsLaunchContext | null {
    if (!this.child || this.status.state !== 'ready' || !this.skillsContext) return null
    return { ...this.skillsContext, patchFiles: this.skillsContext.patchFiles.slice() }
  }

  getLogs(): LogLine[] {
    return this.logs.slice()
  }

  clearLogs(): void {
    this.logs = []
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
  }

  /** Reset recovery bookkeeping; called on any deliberate state change. */
  private resetRecovery(): void {
    this.clearRecoveryTimer()
    this.recoveryAttempt = 0
    this.recoveryCancelled = true
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

  /**
   * Whether a running host can serve a different workspace without being
   * restarted.
   *
   * DSH is a multi-workspace service: workspaces are registered with
   * `ctx.workspaceRegistry` and every session carries its own `cwd`, so the
   * process's own working directory is only a default. Restarting it to change
   * that default would make each workspace switch pay the full boot cost
   * (~10s, measured to be launcher-bound rather than plugin- or network-bound).
   *
   * The host cannot be talked out of its runtime, home, profile, port or extra
   * arguments, so any change there still requires a real restart.
   */
  canAdoptWorkspace(options: StartHostOptions): boolean {
    if (this.status.state !== 'ready' || !this.child) return false
    if (!this.lastOptions) return false
    if (!options.workspacePath?.trim()) return false
    return processIdentity(this.lastOptions) === processIdentity(options)
  }

  /**
   * Point the status at another workspace without touching the process. The
   * embedded UI opens the workspace through the host's own workspace registry,
   * so all this has to do is record which workspace the shell is showing.
   */
  adoptWorkspace(options: StartHostOptions): boolean {
    if (!this.canAdoptWorkspace(options)) return false
    this.lastOptions = options
    this.emitStatus({ workspaceId: options.workspaceId, error: undefined })
    this.append('sys', t('main.workspaceAdoptedLog', { path: options.workspacePath ?? t('main.unknown') }))
    return true
  }

  private async startInternal(options: StartHostOptions): Promise<HostStatus> {
    const { runtime, settings } = options
    if (this.status.state === 'ready' || this.status.state === 'starting') return this.getStatus()
    this.skillsContext = null
    if (!runtime.nodePath || !runtime.cliPath) {
      this.emitStatus({ state: 'error', error: t('main.runtimePartsMissing') })
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
    this.lastOptions = options
    this.recoveryCancelled = false
    this.clearRecoveryTimer()
    this.clearLogs()
    this.status = {
      state: 'starting',
      workspaceId: options.workspaceId,
      startedAt: Date.now()
    }
    this.emitStatus({ recovery: undefined })

    const logDir = logsDirectory()
    this.logFile = join(logDir, `host-${todayStamp()}.log`)
    void mkdir(logDir, { recursive: true }).catch(() => undefined)

    this.append('sys', t('main.workingDirectoryLog', { path: cwd }))
    this.append('sys', `DSH_HOME: ${env.DSH_HOME}`)

    try {
      const profile = await prepareProfile(String(env.DSH_HOME), settings.runtime.profile || 'studio')
      this.append(
        'sys',
        profile.cloned
          ? t('main.profileCreatedLog', { profile: profile.profile })
          : t('main.profileLog', { profile: profile.profile, note: profile.fromDefault ? t('main.profileTemplateNote') : '' })
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
      this.skillsContext = skillsLaunchContext(options, env, cwd, profile)
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
        this.skillsContext = null
        this.clearReadyTimer()
        this.append('sys', t('main.hostLaunchFailedLog', { message: error.message }))
        this.emitStatus({ state: 'error', error: error.message, pid: undefined })
        this.child = null
      })

      child.on('exit', (code, signal) => {
        this.skillsContext = null
        this.clearReadyTimer()
        const wasStopping = this.stopping
        this.stopping = false
        this.child = null
        if (stdoutBuffer.trim()) this.handleOutput('out', stdoutBuffer)
        if (stderrBuffer.trim()) this.handleOutput('err', stderrBuffer)
        if (wasStopping) {
          this.append('sys', t('main.hostStopped'))
          this.emitStatus({ state: 'stopped', url: undefined, port: undefined, pid: undefined, startedAt: undefined, error: undefined, recovery: undefined })
        } else {
          const locked = this.logs
            .slice(-40)
            .some((line) => line.text.includes('EPERM') && line.text.includes('cordis.yml'))
          const reason = locked
            ? t('main.hostProfileLocked')
            : t('main.hostExited', { reason: signal ? t('main.hostSignal', { signal }) : t('main.hostExitCode', { code: code ?? t('main.unknown') }) })
          this.append('sys', reason)
          this.emitStatus({ state: 'error', error: reason, url: undefined, port: undefined, pid: undefined })

          // A locked profile will stay locked on retry, so fail fast with the
          // actionable message above instead of looping.
          if (locked) {
            this.append('sys', t('main.profileRecoverySkipped'))
            this.resetRecovery()
          } else {
            this.scheduleRecovery(reason)
          }
        }
      })

      this.readyTimer = setTimeout(() => {
        if (this.status.state !== 'starting') return
        const error = t('main.hostStartupTimeout')
        this.append('sys', error)
        this.emitStatus({ state: 'error', error })
        void this.killTree()
        if (this.recoveryAttempt > 0) this.scheduleRecovery(error)
      }, READY_TIMEOUT_MS)
    } catch (error) {
      this.skillsContext = null
      const message = error instanceof Error ? error.message : String(error)
      this.append('sys', t('main.hostStartFailedLog', { message }))
      this.emitStatus({ state: 'error', error: message })
      // A retry that fails to even spawn should keep backing off, unless the
      // failure is a permission problem that will not resolve by waiting.
      const permissionDenied = /EPERM|EACCES|operation not permitted/i.test(message)
      if (this.recoveryAttempt > 0) {
        if (permissionDenied) {
          this.append('sys', t('main.permissionRecoverySkipped'))
          this.resetRecovery()
        } else {
          this.scheduleRecovery(message)
        }
      }
    }

    void writeLogLine('host', 'info', `start requested (cwd=${cwd}, port=${port})`)
    return this.getStatus()
  }

  /**
   * Schedule an automatic restart after an unexpected exit.
   * Backs off 2s → 5s → 15s, then gives up and leaves the error visible.
   */
  private scheduleRecovery(reason: string): void {
    const options = this.lastOptions
    if (this.recoveryCancelled || !options) return

    const attempt = this.recoveryAttempt + 1
    if (attempt > RECOVERY_DELAYS_MS.length) {
      this.append('sys', t('main.recoveryExhaustedLog', { count: RECOVERY_DELAYS_MS.length }))
      this.emitStatus({ recovery: undefined })
      return
    }

    const delay = RECOVERY_DELAYS_MS[attempt - 1]
    this.recoveryAttempt = attempt
    this.clearRecoveryTimer()

    this.emitStatus({
      recovery: {
        attempt,
        maxAttempts: RECOVERY_DELAYS_MS.length,
        nextAttemptAt: Date.now() + delay,
        reason
      }
    })
    this.append('sys', t('main.recoveryScheduledLog', { seconds: Math.round(delay / 1000), attempt, total: RECOVERY_DELAYS_MS.length }))

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (this.recoveryCancelled || !this.lastOptions) return
      this.append('sys', t('main.hostRestarting'))
      void this.enqueue(async () => {
        if (this.recoveryCancelled || !this.lastOptions) return
        // Clear the terminal error so startInternal is allowed to run again.
        this.status = { ...this.status, state: 'stopped', error: undefined, recovery: undefined }
        await this.startInternal(this.lastOptions)
      })
    }, delay)
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
      this.append('sys', t('main.hostReadyLog', { port: port ?? t('main.unknown') }))
      if (this.recoveryAttempt > 0) {
        this.append('sys', t('main.recoverySucceededLog', { attempt: this.recoveryAttempt }))
        this.recoveryAttempt = 0
      }
      this.emitStatus({ state: 'ready', url, port, error: undefined, recovery: undefined })
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
    // A deliberate stop always wins over a pending automatic restart.
    this.resetRecovery()
    this.skillsContext = null
    if (!this.child) {
      this.status = { state: 'stopped', startedAt: undefined, url: undefined, port: undefined, error: undefined, recovery: undefined }
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
    this.resetRecovery()
    this.skillsContext = null
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
