import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type {
  DailyBucket,
  InsightsData,
  InsightsSettings,
  ModelBucket,
  SessionSummary,
  TokenBuckets,
  Workspace,
  WorkspaceBucket
} from '@shared/types'
import { logError } from './logger'

const CACHE_TTL_MS = 60_000
const DAY_MS = 86_400_000
const TREND_DAYS = 14

function emptyTokens(): TokenBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Local calendar day key, so trends match what the user sees in their own timezone. */
function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function sessionIdFromFile(file: string): string {
  return basename(file).replace(/\.json$/, '')
}

function workspaceFor(cwd: string, workspaces: Workspace[]): Workspace | undefined {
  const normalized = cwd.toLowerCase().replace(/[\\/]+$/, '')
  return workspaces.find((item) => item.path.toLowerCase().replace(/[\\/]+$/, '') === normalized)
}

interface CacheRecord {
  record?: {
    identity?: { createdAt?: number; cwd?: string }
    rows?: Record<string, { val?: unknown } | undefined>
  }
}

function readCacheValue<T>(rows: Record<string, { val?: unknown } | undefined>, key: string): T | undefined {
  return rows[key]?.val as T | undefined
}

function parseProjectionCache(raw: string, file: string): SessionSummary | null {
  let parsed: CacheRecord
  try {
    parsed = JSON.parse(raw) as CacheRecord
  } catch {
    return null
  }
  const record = parsed.record
  if (!record?.identity) return null
  const rows = record.rows ?? {}
  const identity = record.identity

  const tokenUsage = readCacheValue<{ totals?: Partial<TokenBuckets> }>(rows, 'tokenUsage')
  const totals = tokenUsage?.totals ?? {}
  const stats = readCacheValue<{
    turns?: number
    steps?: number
    llmMs?: number
    toolMs?: number
  }>(rows, 'sessionStats')
  const titleInput = readCacheValue<{ count?: number }>(rows, 'titleInput')
  const listMeta = readCacheValue<{ blank?: boolean; lastPromptAt?: number | null }>(rows, 'sessionListMetadata')
  const model = readCacheValue<{ provider?: string; model?: string }>(rows, 'modelSelection')
  const lastUsed = (model as { lastUsed?: { provider?: string; model?: string } } | undefined)?.lastUsed ?? null
  const title = readCacheValue<string | null>(rows, 'title')
  const preset = readCacheValue<string>(rows, 'agentPreset')
  const timeContext = readCacheValue<{ lastMessageTime?: number | null }>(rows, 'timeContext')

  const cwd = identity.cwd ?? ''
  const createdAt = num(identity.createdAt)
  const lastActiveAt =
    num(listMeta?.lastPromptAt) || num(timeContext?.lastMessageTime) || createdAt || 0

  return {
    id: sessionIdFromFile(file),
    title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
    cwd,
    createdAt,
    lastActiveAt,
    messages: num(titleInput?.count),
    turns: num(stats?.turns),
    steps: num(stats?.steps),
    blank: listMeta?.blank !== false,
    tokens: {
      uncachedInputTokens: num(totals.uncachedInputTokens),
      outputTokens: num(totals.outputTokens),
      cacheReadTokens: num(totals.cacheReadTokens),
      cacheWriteTokens: num(totals.cacheWriteTokens)
    },
    llmMs: num(stats?.llmMs),
    toolMs: num(stats?.toolMs),
    model: lastUsed?.model,
    provider: lastUsed?.provider,
    preset: typeof preset === 'string' ? preset : undefined,
    source: 'cache'
  }
}

/**
 * Fallback for sessions that never reached the projection cache: the first
 * zstd frame of `session.v*.jsonl.zstd` is the session header line.
 */
async function readSessionHeader(file: string): Promise<{ cwd: string; createdAt: number } | null> {
  try {
    const buffer = await readFile(file)
    if (buffer.length === 0) return null
    const raw = zstdDecompressSync(buffer).toString('utf8')
    const firstLine = raw.split('\n').find((line) => line.trim())
    if (!firstLine) return null
    const header = JSON.parse(firstLine) as { type?: string; cwd?: string; createdAt?: number }
    if (header.type !== 'session') return null
    return { cwd: header.cwd ?? '', createdAt: num(header.createdAt) }
  } catch {
    return null
  }
}

async function scanLogFallback(sessionsDir: string, workspaces: Workspace[]): Promise<SessionSummary[]> {
  if (!existsSync(sessionsDir)) return []
  const results: SessionSummary[] = []
  let folders: string[]
  try {
    folders = await readdir(sessionsDir)
  } catch {
    return []
  }
  for (const folder of folders) {
    const sessionDir = join(sessionsDir, folder)
    let entries: string[]
    try {
      entries = await readdir(sessionDir)
    } catch {
      continue
    }
    const logFile = entries.find((name) => name.startsWith('session.') && name.endsWith('.jsonl.zstd'))
    if (!logFile) continue
    const logPath = join(sessionDir, logFile)
    const header = await readSessionHeader(logPath)
    if (!header) continue
    const info = await stat(logPath).catch(() => null)
    const id = (logPath.match(/(session-[0-9a-f-]+)/) ?? [])[1] ?? folder
    results.push({
      id,
      cwd: header.cwd,
      createdAt: header.createdAt,
      lastActiveAt: info?.mtimeMs ?? header.createdAt,
      messages: 0,
      turns: 0,
      steps: 0,
      blank: true,
      tokens: emptyTokens(),
      llmMs: 0,
      toolMs: 0,
      source: 'log'
    })
  }
  return results
}

function buildDaily(sessions: SessionSummary[]): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS)
    const key = dayKey(date.getTime())
    buckets.set(key, { date: key, sessions: 0, turns: 0, tokens: 0 })
  }
  for (const session of sessions) {
    const stamp = session.lastActiveAt || session.createdAt
    if (!stamp) continue
    const bucket = buckets.get(dayKey(stamp))
    if (!bucket) continue
    bucket.sessions += 1
    bucket.turns += session.turns
    bucket.tokens +=
      session.tokens.uncachedInputTokens + session.tokens.outputTokens + session.tokens.cacheReadTokens
  }
  return [...buckets.values()]
}

function buildWorkspaces(sessions: SessionSummary[], workspaces: Workspace[]): WorkspaceBucket[] {
  const map = new Map<string, WorkspaceBucket>()
  for (const session of sessions) {
    const key = session.cwd || '（未知目录）'
    const matched = workspaceFor(session.cwd, workspaces)
    const entry = map.get(key) ?? {
      path: key,
      name: matched?.name || basename(session.cwd || '') || key,
      sessions: 0,
      turns: 0,
      tokens: 0
    }
    entry.sessions += 1
    entry.turns += session.turns
    entry.tokens += session.tokens.uncachedInputTokens + session.tokens.outputTokens + session.tokens.cacheReadTokens
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions)
}

function buildModels(sessions: SessionSummary[]): ModelBucket[] {
  const map = new Map<string, ModelBucket>()
  for (const session of sessions) {
    const label = session.model
      ? session.provider
        ? `${session.provider} / ${session.model}`
        : session.model
      : '未记录'
    const entry = map.get(label) ?? { label, sessions: 0, turns: 0, tokens: 0 }
    entry.sessions += 1
    entry.turns += session.turns
    entry.tokens += session.tokens.uncachedInputTokens + session.tokens.outputTokens + session.tokens.cacheReadTokens
    map.set(label, entry)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens)
}

function estimateCost(tokens: TokenBuckets, settings: InsightsSettings): number | undefined {
  const { inputPrice, outputPrice, cacheReadPrice } = settings
  if (!inputPrice && !outputPrice && !cacheReadPrice) return undefined
  const cost =
    (tokens.uncachedInputTokens / 1_000_000) * inputPrice +
    (tokens.outputTokens / 1_000_000) * outputPrice +
    (tokens.cacheReadTokens / 1_000_000) * cacheReadPrice
  return cost
}

export interface ScanOptions {
  dshHome: string
  workspaces: Workspace[]
  insights: InsightsSettings
}

interface CacheEntry {
  at: number
  data: InsightsData
}

let cache: CacheEntry | null = null

export function invalidateSessionCache(): void {
  cache = null
}

export async function scanSessions(options: ScanOptions, force = false): Promise<InsightsData> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  const { dshHome, workspaces, insights } = options
  const sessionsDir = join(dshHome, 'sessions')
  const cacheDir = join(dshHome, 'storages', 'session_projcache', 'sessions')

  let sessions: SessionSummary[] = []
  let source: InsightsData['source'] = 'none'

  if (existsSync(cacheDir)) {
    try {
      const files = (await readdir(cacheDir)).filter((name) => name.endsWith('.json'))
      const results: SessionSummary[] = []
      for (const file of files) {
        try {
          const raw = await readFile(join(cacheDir, file), 'utf8')
          const summary = parseProjectionCache(raw, file)
          if (summary && summary.cwd) results.push(summary)
        } catch (error) {
          logError('insights', error)
        }
      }
      if (results.length > 0) {
        sessions = results
        source = 'projection-cache'
      }
    } catch (error) {
      logError('insights', error)
    }
  }

  if (sessions.length === 0) {
    sessions = await scanLogFallback(sessionsDir, workspaces)
    if (sessions.length > 0) source = 'session-logs'
  }

  for (const session of sessions) {
    const matched = workspaceFor(session.cwd, workspaces)
    if (matched) {
      session.workspaceId = matched.id
      session.workspaceName = matched.name
    }
  }
  sessions.sort((a, b) => (b.lastActiveAt || b.createdAt) - (a.lastActiveAt || a.createdAt))

  const totalsTokens = emptyTokens()
  let messages = 0
  let turns = 0
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let activeSessions = 0
  for (const session of sessions) {
    totalsTokens.uncachedInputTokens += session.tokens.uncachedInputTokens
    totalsTokens.outputTokens += session.tokens.outputTokens
    totalsTokens.cacheReadTokens += session.tokens.cacheReadTokens
    totalsTokens.cacheWriteTokens += session.tokens.cacheWriteTokens
    messages += session.messages
    turns += session.turns
    steps += session.steps
    llmMs += session.llmMs
    toolMs += session.toolMs
    if (!session.blank) activeSessions += 1
  }

  const promptTokens = totalsTokens.uncachedInputTokens + totalsTokens.cacheReadTokens
  const data: InsightsData = {
    sessions,
    totals: {
      sessions: sessions.length,
      activeSessions,
      messages,
      turns,
      steps,
      tokens: totalsTokens,
      totalTokens: promptTokens + totalsTokens.outputTokens,
      cacheHitRate: promptTokens > 0 ? totalsTokens.cacheReadTokens / promptTokens : 0,
      llmMs,
      toolMs
    },
    daily: buildDaily(sessions),
    byWorkspace: buildWorkspaces(sessions, workspaces),
    byModel: buildModels(sessions),
    scannedAt: Date.now(),
    dshHome,
    sessionsDir,
    source,
    costEstimate: estimateCost(totalsTokens, insights),
    currency: insights.currency
  }
  cache = { at: Date.now(), data }
  return data
}
