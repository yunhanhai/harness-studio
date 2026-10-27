import { execFile } from 'node:child_process'
import type { DshProcess, DshProcessReport } from '@shared/types'

/**
 * DeepSeek Harness serializes writes to a profile and to a single session, so a
 * second `dsh web` — or the official desktop client — can make the embedded host
 * fail with "会话已被占用" or an EPERM on `cordis.yml`. Neither message tells the
 * user *which* process holds the lock, so Studio lists them and can end them.
 *
 * Detection is read-only. It queries every process and filters on the command
 * line, because the command line is what separates `dsh` from any other Node
 * process. Querying by name first would also hide the case below.
 *
 * ## Why the scan verifies itself
 *
 * `Win32_Process` is filtered by the caller's integrity level: a process running
 * with a restricted token (Low integrity, some sandboxed or service contexts)
 * enumerates only a fraction of the machine and receives no error at all. That
 * would turn "I cannot see other DSH instances" into the confident and wrong
 * "there are none", which is exactly the wrong advice for someone whose session
 * is locked. So the scan always looks for *itself* in the results: a process can
 * always see its own entry, therefore a missing self entry proves the result is
 * incomplete and the report is flagged instead of trusted.
 */

const SCAN_TIMEOUT_MS = 15_000

/** `dsh` entries we understand, both `bin.js web` and `--profile x`. */
const DSH_SCRIPT = /@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js|@deepseek-ai[\\/]dsh[\\/]bin[\\/]dsh|\\bdsh\.cmd\b|\bdsh\.exe\b/i

const PROFILE_FLAG = /--profile(?:=|\s+)("[^"]+"|\S+)/i
/** Flags that take a value, so the value is not mistaken for the profile name. */
const VALUE_FLAGS = new Set(['--port', '--host', '--patch', '--from-default-profile', '--cwd', '--data-dir'])
/** Shipped profile templates that boot a non-web surface. */
const CLI_PROFILES = new Set(['headless', 'tui', 'rescue'])

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

/** Arguments after the `dsh` script path, minus the node executable and flags around it. */
function scriptArguments(commandLine: string): string[] {
  const tokens = commandLine.match(/"[^"]*"|\S+/g) ?? []
  const index = tokens.findIndex((token) => DSH_SCRIPT.test(token))
  return (index === -1 ? tokens : tokens.slice(index + 1)).map(unquote)
}

/**
 * Resolve the profile a `dsh` invocation boots. `dsh web` is shorthand for
 * `dsh --profile web`, so a leading positional argument wins when no explicit
 * `--profile` is present — the same rule the CLI applies.
 */
export function profileFromCommandLine(commandLine: string): string {
  const args = scriptArguments(commandLine)
  const explicit = commandLine.match(PROFILE_FLAG)
  if (explicit) return unquote(explicit[1])
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === 'plugin') break
    if (VALUE_FLAGS.has(token)) {
      i += 1
      continue
    }
    if (token.startsWith('-')) continue
    return token
  }
  return 'web'
}

function modeFromCommandLine(commandLine: string): DshProcess['mode'] {
  const args = scriptArguments(commandLine)
  const app = args.find((token) => !token.startsWith('-'))
  if (CLI_PROFILES.has((app ?? '').toLowerCase())) return 'cli'
  // `dsh web` and `dsh --profile <custom> --port 0` both boot the web surface;
  // the port/no-open flags only exist there.
  if (args.some((token) => token === '--no-open' || token === '--port' || token.startsWith('--port='))) return 'web'
  return profileFromCommandLine(commandLine).toLowerCase() === 'web' ? 'web' : 'other'
}

interface CimRow {
  ProcessId?: number
  ParentProcessId?: number
  CommandLine?: string | null
  Name?: string
}

const SCAN_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$ErrorActionPreference = "Stop"',
  '$rows = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine',
  // Integrity level decides how much of the machine this process may enumerate.
  // Low (S-1-16-4096) sees only a slice and reports no error at all.
  '$groups = whoami /groups 2>$null | Out-String',
  '$low = if ($groups -match "S-1-16-4096") { $true } else { $false }',
  '[pscustomobject]@{ processes = @($rows); lowIntegrity = $low } | ConvertTo-Json -Compress -Depth 4'
].join('\n')

function runScan(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCAN_SCRIPT],
      { windowsHide: true, timeout: SCAN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout)))
    )
  })
}

/**
 * List DSH processes. `selfPids` marks the processes this app owns so the UI can
 * exclude them from "quit the other one" advice.
 */
export async function listDshProcesses(selfPids: number[] = []): Promise<DshProcessReport> {
  const scannedAt = Date.now()

  let stdout: string
  try {
    stdout = await runScan()
  } catch (error) {
    const detail = error as { message?: string; stderr?: string }
    return {
      processes: [],
      scannedAt,
      totalProcesses: 0,
      restricted: false,
      error: `${detail.message ?? String(error)}${detail.stderr ? ` :: ${String(detail.stderr).slice(0, 300)}` : ''}`
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim() || '[]')
  } catch {
    return { processes: [], scannedAt, totalProcesses: 0, restricted: false, error: '无法解析进程列表输出' }
  }

  const envelope = parsed as { processes?: CimRow[]; lowIntegrity?: boolean }
  const rows = Array.isArray(envelope?.processes) ? envelope.processes : []
  // Two independent signals that the list is a partial view of the machine:
  // a Low integrity token, or a scan that cannot even see itself.
  const sawSelf = rows.some((row) => Number(row?.ProcessId) === process.pid)
  const owned = new Set([process.pid, ...selfPids])
  const processes: DshProcess[] = []
  for (const row of rows) {
    const pid = Number(row?.ProcessId)
    const commandLine = String(row?.CommandLine ?? '')
    if (!Number.isInteger(pid) || pid <= 0) continue
    if (!DSH_SCRIPT.test(commandLine)) continue
    processes.push({
      pid,
      parentPid: Number(row?.ParentProcessId) || 0,
      profile: profileFromCommandLine(commandLine),
      mode: modeFromCommandLine(commandLine),
      commandLine,
      self: owned.has(pid)
    })
  }

  processes.sort((a, b) => Number(b.self) - Number(a.self) || a.pid - b.pid)
  return {
    processes,
    scannedAt,
    totalProcesses: rows.length,
    restricted: !sawSelf || envelope?.lowIntegrity === true
  }
}

/**
 * End the given processes and their children. The caller is responsible for
 * confirming with the user first; this function never decides on its own.
 */
export async function killProcesses(pids: number[]): Promise<{ killed: number[]; failed: number[] }> {
  const killed: number[] = []
  const failed: number[] = []
  for (const pid of [...new Set(pids)]) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      failed.push(pid)
      continue
    }
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'taskkill',
          ['/PID', String(pid), '/T', '/F'],
          { windowsHide: true, timeout: 8_000 },
          (error) => (error ? reject(error) : resolve())
        )
      })
      killed.push(pid)
    } catch {
      failed.push(pid)
    }
  }
  return { killed, failed }
}
