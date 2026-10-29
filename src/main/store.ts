import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DEFAULT_PROMPTS, DEFAULT_SETTINGS } from '@shared/defaults'
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
  merged.zoomFactor = Math.min(2, Math.max(0.5, Number(merged.zoomFactor) || 1))
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

export class JsonStore<T> {
  private value: T
  private listeners = new Set<Listener<T>>()
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly file: string,
    private readonly fallback: () => T,
    private readonly normalize: (input: unknown) => T = (input) => input as T
  ) {
    this.value = fallback()
  }

  async load(): Promise<T> {
    try {
      const raw = await readFile(this.file, 'utf8')
      this.value = this.normalize(JSON.parse(raw))
    } catch {
      this.value = this.fallback()
      await this.persist()
    }
    return this.value
  }

  get(): T {
    return this.value
  }

  async set(next: T): Promise<T> {
    this.value = next
    await this.persist()
    this.emit()
    return this.value
  }

  async update(mutator: (current: T) => T): Promise<T> {
    const next = mutator(structuredClone(this.value))
    this.value = next
    await this.persist()
    this.emit()
    return this.value
  }

  /** Persist without notifying subscribers (used for window bounds and other noisy state). */
  async updateSilent(mutator: (current: T) => T): Promise<T> {
    const next = mutator(structuredClone(this.value))
    this.value = next
    await this.persist()
    return this.value
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.value)
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.value, null, 2)
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
        await writeFile(tmp, snapshot, 'utf8')
        await rename(tmp, this.file)
      })
      .catch(() => undefined)
    return this.writing
  }
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
    (input) => mergeSettings(DEFAULT_SETTINGS, input)
  )
  const workspaces = new JsonStore<Workspace[]>(
    join(userData, 'workspaces.json'),
    () => [],
    (input) => (Array.isArray(input) ? (input as Workspace[]).filter((item) => typeof item?.path === 'string') : [])
  )
  const prompts = new JsonStore<PromptItem[]>(
    join(userData, 'prompts.json'),
    () => structuredClone(DEFAULT_PROMPTS),
    (input) => (Array.isArray(input) ? (input as PromptItem[]).filter((item) => typeof item?.content === 'string') : [])
  )
  const quickAskRecent = new JsonStore<string[]>(
    join(userData, 'quickask-recent.json'),
    () => [],
    (input) =>
      Array.isArray(input) ? input.filter((item) => typeof item === 'string' && item.trim()).slice(0, 20) : []
  )
  return { settings, workspaces, prompts, quickAskRecent }
}

export async function loadStores(stores: Stores): Promise<void> {
  await Promise.all([
    stores.settings.load(),
    stores.workspaces.load(),
    stores.prompts.load(),
    stores.quickAskRecent.load()
  ])
}

export function dataDir(): string {
  return app.getPath('userData')
}
