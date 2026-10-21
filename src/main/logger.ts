import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ANSI = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

let logDir = ''
let ready: Promise<void> | null = null
const MAX_LOG_BYTES = 4 * 1024 * 1024

async function ensureDir(): Promise<void> {
  if (!logDir) logDir = join(app.getPath('userData'), 'logs')
  if (!ready) {
    ready = mkdir(logDir, { recursive: true }).then(() => undefined)
  }
  await ready
}

async function rotate(file: string): Promise<void> {
  try {
    const info = await stat(file)
    if (info.size > MAX_LOG_BYTES) {
      await rename(file, file.replace(/\.log$/, `.${Date.now()}.log`)).catch(() => undefined)
    }
  } catch {
    /* file does not exist yet */
  }
}

export function logsDirectory(): string {
  return logDir || join(app.getPath('userData'), 'logs')
}

export async function writeLogLine(scope: string, level: LogLevel, message: string): Promise<void> {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${stripAnsi(message)}\n`
  if (level === 'error') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  try {
    await ensureDir()
    const file = join(logsDirectory(), 'studio.log')
    await rotate(file)
    await appendFile(file, line, 'utf8')
  } catch {
    /* logging must never take the app down */
  }
}

export function log(scope: string, message: string): void {
  void writeLogLine(scope, 'info', message)
}

export function logError(scope: string, error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  void writeLogLine(scope, 'error', message)
}

export function logWarn(scope: string, message: string): void {
  void writeLogLine(scope, 'warn', message)
}
