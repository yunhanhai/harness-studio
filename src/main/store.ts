import { app } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { CONVERSATION_FONT_SIZES, DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '@shared/defaults'
import { normalizeLanguage } from '@shared/i18n'
import type { PromptItem, Settings, Workspace } from '@shared/types'

type Listener<T> = (value: T) => void

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge persisted settings into defaults so new fields appear after upgrades. */
export function mergeSettings(defaults: Settings, input: unknown): Settings {
  if (!isPlainObject(input)) return structuredClone(defaults)
  const merge = (base: unknown, extra: unknown): unknown => {
    if (Array.isArray(base)) return Array.isArray(extra) ? extra : base
    if (isPlainObject(base)) {
      const result: Record<string, unknown> = { ...base }
      if (isPlainObject(extra)) {
        for (const [key, value] of Object.entries(extra)) {
          result[key] = key in base ? merge(base[key], value) : value
        }
      }
      return result
    }
    return extra === undefined ? base : extra
  }
  const merged = merge(defaults, input) as Settings
  merged.language = normalizeLanguage(merged.language)
  if (typeof input.modelSetupSeen !== 'boolean') {
    merged.modelSetupSeen = typeof input.lastWorkspaceId === 'string' && Boolean(input.lastWorkspaceId)
  }
  merged.zoomFactor = Math.min(2, Math.max(0.5, Number(merged.zoomFactor) || 1))
  if (typeof merged.conversationFontSize !== 'number' || !CONVERSATION_FONT_SIZES.includes(merged.conversationFontSize)) {
    merged.conversationFontSize = defaults.conversationFontSize
  }
  merged.runtime.port = Math.min(65535, Math.max(0, Math.floor(Number(merged.runtime.port) || 0)))
  if (!/^#[0-9a-fA-F]{6}$/.test(merged.accent)) merged.accent = defaults.accent
  if (!Array.isArray(merged.runtime.extraArgs)) merged.runtime.extraArgs = []
  if (!isPlainObject(merged.runtime.env)) merged.runtime.env = {}
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(merged.runtime.profile)) merged.runtime.profile = 'studio'
  const clampPrice = (value: unknown): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 100_000) : 0
  }
  merged.insights.inputPrice = clampPrice(merged.insights.inputPrice)
  merged.insights.outputPrice = clampPrice(merged.insights.outputPrice)
  merged.insights.cacheReadPrice = clampPrice(merged.insights.cacheReadPrice)
  if (merged.insights.currency !== 'USD') merged.insights.currency = 'CNY'
  merged.quickAsk.recentLimit = Math.min(20, Math.max(1, Math.floor(Number(merged.quickAsk.recentLimit) || 6)))
  if (typeof merged.composer?.confirmSend !== 'boolean') merged.composer.confirmSend = defaults.composer.confirmSend
  if (typeof merged.composer?.confirmQueued !== 'boolean') {
    merged.composer.confirmQueued = defaults.composer.confirmQueued
  }
  merged.tabs.limit = Math.min(8, Math.max(1, Math.floor(Number(merged.tabs.limit) || defaults.tabs.limit)))
  return merged
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : (patch as T))
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) ? deepMerge(result[key], value) : value
  }
  return result as T
}

export type StorePersistenceOperation = 'load' | 'save'
export type StorePersistenceReason = 'read' | 'parse' | 'normalize' | 'write' | 'not-loaded'

/** A persistence error that can be shown without exposing the stored contents. */
export class StorePersistenceError extends Error {
  readonly name = 'StorePersistenceError'

  constructor(
    readonly operation: StorePersistenceOperation,
    readonly file: string,
    readonly reason: StorePersistenceReason,
    readonly code?: string
  ) {
    super(`Could not ${operation} local store (${reason}).`)
  }
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

export class JsonStore<T> {
  private value: T
  private listeners = new Set<Listener<T>>()
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    readonly file: string,
    private readonly fallback: () => T,
    private readonly normalize: (input: unknown) => T = (input) => input as T
  ) {
    this.value = cloneValue(fallback())
  }

  async load(): Promise<T> {
    return this.enqueue(async () => {
      // A failed reload locks writes until the file has been read successfully,
      // so a corrupt or inaccessible file can never be silently overwritten.
      this.loaded = false
      let raw: string
      try {
        raw = await readFile(this.file, 'utf8')
      } catch (error) {
        if (!isMissingFile(error)) throw this.persistenceError('load', 'read', error)
        const initial = cloneValue(this.fallback())
        try {
          this.value = cloneValue(await this.createInitial(initial))
        } catch (error) {
          throw this.persistenceError('load', 'write', error)
        }
        this.loaded = true
        return cloneValue(this.value)
      }
      this.value = cloneValue(this.parse(raw))
      this.loaded = true
      return cloneValue(this.value)
    }, 'load')
  }

  get(): T {
    return cloneValue(this.value)
  }

  async set(next: T): Promise<T> {
    let candidate: T
    try {
      candidate = cloneValue(next)
    } catch (error) {
      throw this.persistenceError('save', 'write', error)
    }
    return this.enqueue(async () => {
      this.assertLoaded()
      await this.persist(candidate)
      this.value = candidate
      this.emit()
      return cloneValue(this.value)
    }, 'save')
  }

  async update(mutator: (current: T) => T): Promise<T> {
    return this.enqueue(async () => {
      this.assertLoaded()
      const next = mutator(cloneValue(this.value))
      const candidate = cloneValue(next)
      await this.persist(candidate)
      this.value = candidate
      this.emit()
      return cloneValue(this.value)
    }, 'save')
  }

  /** Persist without notifying subscribers (used for window bounds and other noisy state). */
  async updateSilent(mutator: (current: T) => T): Promise<T> {
    return this.enqueue(async () => {
      this.assertLoaded()
      const candidate = cloneValue(mutator(cloneValue(this.value)))
      await this.persist(candidate)
      this.value = candidate
      return cloneValue(this.value)
    }, 'save')
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(cloneValue(this.value))
      } catch {
        // A subscriber must not turn a successful disk commit into a failed
        // persistence operation or prevent later subscribers from observing it.
        console.error('A local store subscriber failed after a successful save.')
      }
    }
  }

  private enqueue<R>(task: () => Promise<R>, operation: StorePersistenceOperation): Promise<R> {
    const run = this.queue.then(task)
    this.queue = run.then(() => undefined, () => undefined)
    return run.catch((error) => {
      if (error instanceof StorePersistenceError) throw error
      throw this.persistenceError(operation, operation === 'load' ? 'read' : 'write', error)
    })
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new StorePersistenceError('save', this.file, 'not-loaded')
  }

  private parse(raw: string): T {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw this.persistenceError('load', 'parse', error)
    }
    try {
      return this.normalize(parsed)
    } catch (error) {
      throw this.persistenceError('load', 'normalize', error)
    }
  }

  private persistenceError(operation: StorePersistenceOperation, reason: StorePersistenceReason, error?: unknown): StorePersistenceError {
    if (error instanceof StorePersistenceError) return error
    return new StorePersistenceError(operation, this.file, reason, errorCode(error))
  }

  private async persist(value: T): Promise<void> {
    let snapshot: string
    try {
      snapshot = JSON.stringify(value, null, 2)
      if (typeof snapshot !== 'string') throw new TypeError('Store value is not JSON serializable')
    } catch (error) {
      throw this.persistenceError('save', 'write', error)
    }
    const temporary = `${this.file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(temporary, snapshot, { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, this.file)
    } catch (error) {
      throw this.persistenceError('save', 'write', error)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private async createInitial(value: T): Promise<T> {
    let snapshot: string
    try {
      snapshot = JSON.stringify(value, null, 2)
      if (typeof snapshot !== 'string') throw new TypeError('Store value is not JSON serializable')
    } catch (error) {
      throw this.persistenceError('load', 'write', error)
    }
    await mkdir(dirname(this.file), { recursive: true })
    try {
      // Exclusive creation works on portable FAT/exFAT storage as well as
      // NTFS. A failed initial write is retained for recovery, never deleted
      // or replaced by a later fallback write.
      await writeFile(this.file, snapshot, { encoding: 'utf8', flag: 'wx' })
      return value
    } catch (error) {
      if (!isExistingFile(error)) throw error
      // Another process won initialization; never replace its file. If it is
      // still incomplete, parsing fails safely and a later load can retry.
      let raw: string
      try {
        raw = await readFile(this.file, 'utf8')
      } catch (readError) {
        throw this.persistenceError('load', 'read', readError)
      }
      return this.parse(raw)
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function isExistingFile(error: unknown): boolean {
  return errorCode(error) === 'EEXIST'
}

export interface Stores {
  settings: JsonStore<Settings>
  workspaces: JsonStore<Workspace[]>
  prompts: JsonStore<PromptItem[]>
  quickAskRecent: JsonStore<string[]>
}

export function createStores(userData: string): Stores {
  const settings = new JsonStore<Settings>(
    join(userData, 'settings.json'),
    () => structuredClone(DEFAULT_SETTINGS),
    (input) => {
      if (!isPlainObject(input)) throw new TypeError('Settings must be an object')
      return mergeSettings(DEFAULT_SETTINGS, input)
    }
  )
  const workspaces = new JsonStore<Workspace[]>(
    join(userData, 'workspaces.json'),
    () => [],
    (input) => {
      if (!Array.isArray(input)) throw new TypeError('Workspaces must be an array')
      return (input as Workspace[]).filter((item) => typeof item?.path === 'string')
    }
  )
  const prompts = new JsonStore<PromptItem[]>(
    join(userData, 'prompts.json'),
    () => structuredClone(DEFAULT_PROMPTS),
    (input) => {
      if (!Array.isArray(input)) throw new TypeError('Prompts must be an array')
      return (input as PromptItem[]).filter((item) => typeof item?.content === 'string')
    }
  )
  const quickAskRecent = new JsonStore<string[]>(
    join(userData, 'quickask-recent.json'),
    () => [],
    (input) => {
      if (!Array.isArray(input)) throw new TypeError('Recent quick asks must be an array')
      return input.filter((item) => typeof item === 'string' && item.trim()).slice(0, 20)
    }
  )
  return { settings, workspaces, prompts, quickAskRecent }
}

export async function loadStores(stores: Stores): Promise<void> {
  const results = await Promise.allSettled([
    stores.settings.load(),
    stores.workspaces.load(),
    stores.prompts.load(),
    stores.quickAskRecent.load()
  ])
  // Finish every load before offering retry or exit; initialization must not
  // keep writing in the background after a different file failed to load.
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

export function dataDir(): string {
  return app.getPath('userData')
}
