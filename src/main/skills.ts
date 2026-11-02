import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { CORE_SCHEMA, DEFAULT_SCHEMA, Type, load } from 'js-yaml'
import type { LocalSkill, SkillBackup, SkillPreview, SkillSource, SkillsInventory, SkillWriteResult } from '@shared/skills'

export interface SkillFilesystemConfiguration {
  verified: boolean
  includeDefaultRoots?: boolean
  customSkillDirs?: string[]
  dshHome?: string
  agentsHome?: string
  bundledSkillDir?: string
}

/** Supplied by the main process, never by renderer path arguments. */
export interface SkillsContext {
  cwd?: string
  sessionId?: string
  presetId?: string
  dshHome: string
  home: string
  agentsHome?: string
  cliPath?: string
  processCwd?: string
  profile: string
  profileDir?: string
  patchFiles?: string[]
  bundledSkillDir?: string
  configuration?: SkillFilesystemConfiguration
  /** Explicitly manage the standard DSH roots even if live profile composition is unknown. */
  allowUnverifiedDefaults?: boolean
}

const MAX_TEXT_BYTES = 1024 * 1024
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_RESOURCES = 2000
const MAX_ROOT_ENTRIES = 2000
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const key = (prefix: string, path: string): string => `${prefix}-${digest(process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)).slice(0, 24)}`
const absent = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

function within(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path))
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
}

function assertWithin(root: string, path: string, allowRoot = false): void {
  if (!within(root, path) || (!allowRoot && relative(resolve(root), resolve(path)) === '')) {
    throw new Error('Skill path is outside its managed directory.')
  }
}

/** Check every existing path component: junctions and symlinks never authorize traversal. */
async function assertNoLinks(path: string, allowMissing = false): Promise<void> {
  const absolute = resolve(path)
  const pathRoot = parse(absolute).root
  let current = pathRoot
  for (const part of absolute.slice(pathRoot.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('Linked skill paths are read-only and cannot be traversed.')
    } catch (error) {
      if (allowMissing && absent(error)) return
      throw error
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (absent(error)) return false; throw error }
}

async function textFile(path: string): Promise<string> {
  await assertNoLinks(path)
  const info = await lstat(path)
  if (!info.isFile() || info.size > MAX_TEXT_BYTES || info.nlink > 1) throw new Error('Skill instruction file is not a regular, unlinked text file within 1 MiB.')
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await descriptor.stat()
    if (stat.size > MAX_TEXT_BYTES || !stat.isFile() || stat.nlink > 1) throw new Error('Skill file changed while reading.')
    const buffer = await descriptor.readFile()
    if (buffer.length > MAX_TEXT_BYTES || buffer.includes(0)) throw new Error('Skill instruction file is not valid text.')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } finally { await descriptor.close() }
}

function booleanField(data: Record<string, unknown>, name: string): boolean | undefined {
  if (!Object.hasOwn(data, name)) return undefined
  const value = data[name]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    if (['true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['false', 'no', 'off'].includes(value.toLowerCase())) return false
  }
  throw new Error(`Frontmatter "${name}" must be a boolean.`)
}

/** Matches the rc.2 instruction/frontmatter boundaries and invocation grammar. */
export function parseSkillContent(content: string): Pick<LocalSkill, 'name' | 'description' | 'whenToUse' | 'modelInvocable' | 'userInvocable'> {
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES || content.includes('\0')) throw new Error('Skill instruction file exceeds 1 MiB or contains binary data.')
  const lines = content.split('\n')
  if (lines[0]?.replace(/\r$/, '') !== '---') throw new Error('Missing YAML frontmatter. Begin the file with --- and provide name and description.')
  const end = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === '---')
  if (end < 0) throw new Error('YAML frontmatter has no closing ---.')
  const data = load(lines.slice(1, end).join('\n'), { schema: CORE_SCHEMA })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a YAML mapping.')
  const record = data as Record<string, unknown>
  if (typeof record.name !== 'string' || !SKILL_NAME.test(record.name)) throw new Error('Frontmatter name must contain lowercase letters, numbers and single hyphens.')
  if (typeof record.description !== 'string' || record.description.length === 0) throw new Error('Frontmatter description is required.')
  for (const legacy of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(record, legacy)) throw new Error(`Unsupported frontmatter field "${legacy}". Use disable-model-invocation or user-invocable.`)
  }
  return {
    name: record.name,
    description: record.description,
    whenToUse: typeof record.whenToUse === 'string' && record.whenToUse.length > 0 ? record.whenToUse : undefined,
    modelInvocable: booleanField(record, 'disable-model-invocation') !== true,
    userInvocable: booleanField(record, 'user-invocable') !== false
  }
}

function assertName(name: string): void {
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || name.length > 100 || WINDOWS_RESERVED.test(name)) {
    throw new Error('Choose a skill name of at most 100 lowercase letters, numbers and hyphens; reserved Windows names are unavailable.')
  }
}

async function projectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  const original = current
  await assertNoLinks(current)
  while (true) {
    if (await exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return original
    current = parent
  }
}

interface BundleFiles { resources: string[]; directories: string[]; revision: string; bytes: number }

/** Content hashes protect delete/restore against external edits to any attached resource. */
async function filesAt(path: string, format: LocalSkill['format']): Promise<BundleFiles> {
  await assertNoLinks(path)
  const resourceRoot = format === 'bundle' ? path : dirname(path)
  const resources: string[] = []
  const directories: string[] = []
  const hashes: string[] = []
  let bytes = 0
  const visit = async (current: string): Promise<void> => {
    assertWithin(resourceRoot, current, true)
    await assertNoLinks(current)
    const info = await lstat(current)
    if (info.isDirectory()) {
      const part = relative(resourceRoot, current).split(sep).join('/')
      if (part) {
        if (directories.length >= MAX_RESOURCES || part.split('/').length > 64) throw new Error('Bundle has too many or too deeply nested directories.')
        directories.push(part)
        hashes.push(`${part}\0directory`)
      }
      const entries = await readdir(current)
      for (const entry of entries.sort()) await visit(join(current, entry))
      return
    }
    if (!info.isFile() || info.nlink > 1) throw new Error('Bundle resources must be regular files, without links or special devices.')
    bytes += info.size
    if (bytes > MAX_BUNDLE_BYTES || resources.length >= MAX_RESOURCES) throw new Error('Bundle exceeds the management limit of 64 MiB or 2,000 files.')
    const descriptor = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stable = await descriptor.stat()
      if (!stable.isFile() || stable.nlink > 1 || stable.size !== info.size) throw new Error('Bundle changed while reading. Refresh and try again.')
      const buffer = await descriptor.readFile()
      if (buffer.length !== info.size) throw new Error('Bundle changed while reading. Refresh and try again.')
      const part = relative(resourceRoot, current).split(sep).join('/')
      resources.push(part)
      hashes.push(`${format === 'file' ? '<instruction>' : part}\0${digest(buffer)}`)
    } finally { await descriptor.close() }
  }
  await visit(path)
  return { resources, directories, revision: digest(hashes.join('\n')), bytes }
}

/** Copy only a previously checked regular-file tree; no symlinks are followed. */
async function copyChecked(source: string, destination: string, format: LocalSkill['format']): Promise<void> {
  await assertNoLinks(source)
  await assertNoLinks(destination, true)
  if (await exists(destination)) throw new Error('Destination already exists. No file was replaced.')
  if (format === 'file') {
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    return
  }
  await mkdir(destination)
  const snapshot = await filesAt(source, 'bundle')
  for (const part of snapshot.directories) {
    const to = join(destination, ...part.split('/'))
    assertWithin(destination, to)
    await assertNoLinks(to, true)
    await mkdir(to, { recursive: true })
  }
  for (const part of snapshot.resources) {
    const from = join(source, ...part.split('/'))
    const to = join(destination, ...part.split('/'))
    assertWithin(source, from)
    assertWithin(destination, to)
    await assertNoLinks(from)
    await assertNoLinks(to, true)
    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to, constants.COPYFILE_EXCL)
  }
  if ((await filesAt(destination, 'bundle')).revision !== snapshot.revision) throw new Error('Bundle changed during import or backup. The source was left untouched.')
}

// Loader expressions are retained as inert objects, never evaluated.
const configSchema = DEFAULT_SCHEMA.extend([new Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: (value) => ({ studioInertExpression: value })
})])

/**
 * Inspect only selected patch files for additional local directory candidates.
 * This cannot compose all bundle/preset layers or evaluate !!js. It deliberately
 * does not certify a live session catalog, and never reads .env/credential files.
 */
export async function readSkillConfiguration(context: SkillsContext): Promise<{ customSkillDirs: string[]; warnings: string[] }> {
  const files = [
    join(context.profileDir ?? join(context.dshHome, 'profiles', context.profile), 'cordis.patch.yml'),
    join(context.dshHome, 'cordis.patch.yml'),
    ...(context.patchFiles ?? [])
  ]
  const custom = new Set<string>()
  const warnings: string[] = []
  const launchCwd = context.processCwd ?? context.cwd ?? context.home
  const seen = new Set<object>()
  let inspectedObjects = 0
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (++inspectedObjects > 10000) throw new Error('Patch structure is too large to inspect.')
    if (Array.isArray(value)) { for (const child of value) inspect(child); return }
    const row = value as Record<string, unknown>
    if (row.id === 'skill-filesystem' || row.name === '@deepseek-ai/dsh-skill-filesystem') {
      const config = row.config
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        const dirs = (config as Record<string, unknown>).customSkillDirs
        if (Array.isArray(dirs)) {
          for (const path of dirs) if (typeof path === 'string' && path.trim()) custom.add(resolve(launchCwd, path))
        }
      }
    }
    // Only descend into structural patch rows and preset plugin declarations.
    for (const prop of ['insert', 'plugins', 'config', 'patch', 'entries']) if (row[prop]) inspect(row[prop])
  }
  for (const path of [...new Set(files)]) {
    if (!/\.ya?ml$/i.test(path) || /(?:^|[\\/])\.(?:env|credentials)(?:\.|$)/i.test(path)) {
      warnings.push('A non-YAML launch overlay was not inspected.')
      continue
    }
    try {
      if (!await exists(path)) continue
      inspect(load(await textFile(path), { schema: configSchema }))
    } catch {
      warnings.push('A profile patch could not be inspected; its additional skill sources may be absent from this list.')
    }
  }
  return { customSkillDirs: [...custom], warnings }
}

interface BackupRecord extends SkillBackup {
  format: LocalSkill['format']
  sourceId: string
  targetPath: string
  payloadName: string
  profile: string
  dshHome: string
  beforeRevision: string
  afterRevision?: string
}

export class SkillsService {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly backupRoot: string) {}

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const promise = this.queue.then(operation, operation)
    this.queue = promise.catch(() => undefined)
    return promise
  }

  async list(context: SkillsContext): Promise<SkillsInventory> {
    const configured = context.configuration
    const verified = configured?.verified === true
    const useDefaults = verified ? configured.includeDefaultRoots !== false : true
    const managementAllowed = verified || context.allowUnverifiedDefaults === true || !context.cliPath
    const launchCwd = context.processCwd ?? context.cwd ?? context.home
    const dshHome = resolve(launchCwd, verified && configured.dshHome ? configured.dshHome : context.dshHome)
    const agentsHome = resolve(launchCwd, verified && configured.agentsHome ? configured.agentsHome : context.agentsHome ?? join(context.home, '.agents'))
    const root = context.cwd ? await projectRoot(context.cwd) : undefined
    const warnings: string[] = []
    if (!verified) warnings.push('Default filesystem directories are shown. The current profile/preset configuration and live invocation catalog have not been verified.')
    warnings.push('This is a local file inventory. Virtual and remote providers are not included; an open session may cache its /skill menu until the preset or connection changes.')
    const partial = !verified && context.cliPath ? await readSkillConfiguration(context) : { customSkillDirs: [], warnings: [] }
    warnings.push(...partial.warnings)
    const sources: SkillSource[] = []
    const add = (kind: SkillSource['kind'], path: string, rank: number, scope: SkillSource['scope'], writable = false): void => {
      const normalized = resolve(path)
      // A duplicate path is scanned once, at its strongest root priority.
      if (sources.some((source) => key('source', source.path) === key('source', normalized))) return
      sources.push({ id: key('source', normalized), kind, path: normalized, rank, scope, writable, exists: false })
    }
    if (useDefaults && root) {
      add('project-dsh', join(root, '.dsh', 'skills'), 100, 'project', managementAllowed)
      add('project-agents', join(root, '.agents', 'skills'), 200, 'project')
    }
    for (const path of verified ? configured.customSkillDirs ?? [] : partial.customSkillDirs) add('custom', resolve(context.processCwd ?? context.cwd ?? context.home, path), 300, 'custom')
    if (useDefaults) {
      add('user-dsh', join(dshHome, 'skills'), 400, 'user', managementAllowed)
      add('user-agents', join(agentsHome, 'skills'), 500, 'user')
    }
    const bundled = verified ? configured.bundledSkillDir ?? (useDefaults ? context.bundledSkillDir : undefined) : context.bundledSkillDir
    if (bundled) add('bundled', resolve(context.processCwd ?? context.cwd ?? context.home, bundled), 600, 'bundled')
    const skills: LocalSkill[] = []
    for (const source of sources) {
      try {
        await assertNoLinks(source.path, true)
        if (!await exists(source.path)) continue
        const stat = await lstat(source.path)
        if (!stat.isDirectory()) throw new Error('Skill source is not a directory.')
        source.exists = true
        const entries = (await readdir(source.path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
        if (entries.length > MAX_ROOT_ENTRIES) warnings.push('A skill source exceeds 2,000 direct entries; the inventory is incomplete.')
        for (const entry of entries.slice(0, MAX_ROOT_ENTRIES)) {
          if (source.kind === 'user-dsh' && entry.name === '.system') continue
          if (entry.name.startsWith('.studio-')) continue
          const path = join(source.path, entry.name)
          let format: LocalSkill['format'] | undefined
          if (entry.isDirectory() || entry.isSymbolicLink()) format = 'bundle'
          else if (entry.isFile() && entry.name.endsWith('.md')) format = 'file'
          if (!format) continue
          const instructionPath = format === 'bundle' ? join(path, 'SKILL.md') : path
          if (!entry.isSymbolicLink() && !await exists(instructionPath)) continue
          skills.push(await this.describe(source, path, instructionPath, format))
        }
      } catch (error) {
        source.writable = false
        source.diagnostic = message(error)
      }
    }
    const winners = new Map<string, LocalSkill>()
    for (const skill of skills) {
      if (!skill.valid) continue
      const winner = winners.get(skill.name)
      if (winner) skill.shadowedBy = winner.id
      else winners.set(skill.name, skill)
    }
    return { cwd: context.cwd, projectRoot: root, dshHome, profile: context.profile, configurationVerified: verified, catalogKind: 'filesystem', sources, skills, warnings }
  }

  private async describe(source: SkillSource, targetPath: string, instructionPath: string, format: LocalSkill['format']): Promise<LocalSkill> {
    const skill: LocalSkill = {
      id: key('skill', instructionPath), sourceId: source.id, path: instructionPath,
      directory: format === 'bundle' ? targetPath : source.path, format,
      name: basename(targetPath).replace(/\.md$/, ''), description: '', valid: false,
      modelInvocable: false, userInvocable: false, writable: source.writable, revision: '', resourceCount: 0
    }
    try {
      assertWithin(source.path, targetPath)
      const content = await textFile(instructionPath)
      try { Object.assign(skill, parseSkillContent(content)); skill.valid = true }
      catch (error) { skill.diagnostic = message(error) }
      const files = await filesAt(targetPath, format)
      skill.revision = files.revision
      skill.resourceCount = files.resources.length
    } catch (error) {
      skill.writable = false
      skill.diagnostic = message(error)
    }
    return skill
  }

  private async locate(context: SkillsContext, id: string, writable = false): Promise<{ skill: LocalSkill; source: SkillSource; targetPath: string }> {
    if (typeof id !== 'string') throw new Error('Invalid skill reference.')
    const inventory = await this.list(context)
    const skill = inventory.skills.find((item) => item.id === id)
    const source = skill && inventory.sources.find((item) => item.id === skill.sourceId)
    if (!skill || !source) throw new Error('Skill no longer belongs to the current workspace. Refresh the list.')
    if (writable && (!skill.writable || !source.writable)) throw new Error('This skill source is read-only.')
    const targetPath = skill.format === 'bundle' ? skill.directory : skill.path
    assertWithin(source.path, targetPath)
    await assertNoLinks(targetPath)
    return { skill, source, targetPath }
  }

  async preview(context: SkillsContext, id: string): Promise<SkillPreview> {
    const { skill, targetPath } = await this.locate(context, id)
    const content = await textFile(skill.path)
    const files = await filesAt(targetPath, skill.format)
    if (files.revision !== skill.revision) throw new Error('Skill changed on disk. Refresh its preview.')
    return { skill, content, resources: files.resources }
  }

  private async writeSource(context: SkillsContext, sourceId: string): Promise<SkillSource> {
    const source = (await this.list(context)).sources.find((item) => item.id === sourceId)
    if (!source?.writable) throw new Error('Choose a writable DSH skill directory in the current workspace.')
    if (source.kind !== 'project-dsh' && source.kind !== 'user-dsh') throw new Error('Only standard DSH skill directories can be modified.')
    await assertNoLinks(source.path, true)
    await mkdir(source.path, { recursive: true })
    await assertNoLinks(source.path)
    return source
  }

  async create(context: SkillsContext, sourceId: string, name: string, content: string): Promise<SkillWriteResult> {
    return this.serial(async () => {
      assertName(name)
      const parsed = parseSkillContent(content)
      if (parsed.name !== name) throw new Error('Frontmatter name must match the new skill name.')
      const source = await this.writeSource(context, sourceId)
      return this.installNew(source, name, async (staging) => {
        await mkdir(staging)
        await writeFile(join(staging, 'SKILL.md'), content, { flag: 'wx', encoding: 'utf8' })
      })
    })
  }

  private async installNew(source: SkillSource, name: string, populate: (staging: string) => Promise<void>, allowInvalid = false): Promise<SkillWriteResult> {
    const target = join(source.path, name)
    const flat = join(source.path, `${name}.md`)
    assertWithin(source.path, target)
    if (await exists(target) || await exists(flat)) throw new Error('A skill with this destination name already exists. No files were replaced.')
    const staging = join(source.path, `.studio-${randomUUID()}`)
    const ownedFiles: Array<{ path: string; hash: string }> = []
    const ownedDirectories: string[] = []
    const ensureDirectory = async (path: string): Promise<void> => {
      if (path === source.path) return
      assertWithin(source.path, path)
      await assertNoLinks(path, true)
      if (await exists(path)) return
      await ensureDirectory(dirname(path))
      try { await mkdir(path); ownedDirectories.push(path) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await assertNoLinks(path) }
    }
    try {
      await populate(staging)
      await assertNoLinks(source.path)
      // mkdir is an exclusive reservation. rename only a contained staging tree
      // into the empty directory we just created; do not replace other skills.
      await mkdir(target)
      ownedDirectories.push(target)
      if (await exists(flat)) throw new Error('A skill with this destination name was created concurrently.')
      const files = await filesAt(staging, 'bundle')
      for (const part of files.directories) await ensureDirectory(join(target, ...part.split('/')))
      for (const part of files.resources) {
        const destination = join(target, ...part.split('/'))
        assertWithin(target, destination)
        await assertNoLinks(destination, true)
        await ensureDirectory(dirname(destination))
        await copyFile(join(staging, ...part.split('/')), destination, constants.COPYFILE_EXCL)
        ownedFiles.push({ path: destination, hash: digest(await readFile(destination)) })
      }
      const skill = await this.describe(source, target, join(target, 'SKILL.md'), 'bundle')
      if ((!allowInvalid && !skill.valid) || !skill.writable || skill.revision !== files.revision) throw new Error('Imported skill changed while installing.')
      return { skill }
    } catch (error) {
      // Roll back only unchanged files created by this operation. A concurrent
      // writer's file is preserved, even if that leaves a partial destination.
      for (const file of ownedFiles.reverse()) {
        try {
          assertWithin(target, file.path)
          await assertNoLinks(file.path)
          if (digest(await readFile(file.path)) === file.hash) await rm(file.path)
        } catch { /* Preserve any externally changed path. */ }
      }
      for (const directory of ownedDirectories.reverse()) {
        try { assertWithin(source.path, directory); await assertNoLinks(directory); await rmdir(directory) }
        catch { /* Non-empty or externally replaced directories are preserved. */ }
      }
      if (await exists(staging)) {
        await assertNoLinks(staging)
        assertWithin(source.path, staging)
        await rm(staging, { recursive: true, force: true })
      }
      throw error
    } finally {
      if (await exists(staging)) {
        assertWithin(source.path, staging)
        await assertNoLinks(staging)
        await rm(staging, { recursive: true, force: true })
      }
    }
  }

  async import(context: SkillsContext, sourceId: string, inputPath: string): Promise<SkillWriteResult> {
    return this.serial(async () => {
      if (!isAbsolute(inputPath)) throw new Error('Import requires a file or folder chosen by the native picker.')
      await assertNoLinks(inputPath)
      const info = await lstat(inputPath)
      const format = info.isDirectory() ? 'bundle' : 'file'
      const instruction = format === 'bundle' ? join(inputPath, 'SKILL.md') : inputPath
      const content = await textFile(instruction)
      const parsed = parseSkillContent(content)
      assertName(parsed.name)
      await filesAt(inputPath, format)
      const source = await this.writeSource(context, sourceId)
      if (format === 'bundle' && within(inputPath, source.path)) throw new Error('Import destination cannot be inside the imported folder.')
      return this.installNew(source, parsed.name, async (staging) => {
        if (format === 'bundle') await copyChecked(inputPath, staging, 'bundle')
        else {
          await mkdir(staging)
          await copyFile(inputPath, join(staging, 'SKILL.md'), constants.COPYFILE_EXCL)
        }
      })
    })
  }

  private async backup(context: SkillsContext, source: SkillSource, skill: LocalSkill, targetPath: string, operation: SkillBackup['operation']): Promise<BackupRecord> {
    await assertNoLinks(this.backupRoot, true)
    await mkdir(this.backupRoot, { recursive: true })
    const id = randomUUID()
    const directory = join(this.backupRoot, id)
    assertWithin(this.backupRoot, directory)
    await mkdir(directory)
    const payloadName = skill.format === 'bundle' ? 'payload' : 'payload.md'
    const record: BackupRecord = {
      id, createdAt: Date.now(), operation, name: skill.name, sourcePath: skill.path, restored: false,
      format: skill.format, sourceId: source.id, targetPath, payloadName,
      profile: context.profile, dshHome: resolve(context.dshHome), beforeRevision: skill.revision
    }
    try {
      await copyChecked(targetPath, join(directory, payloadName), skill.format)
      if ((await filesAt(join(directory, payloadName), skill.format)).revision !== skill.revision) throw new Error('Skill changed while backing up. No source files were modified.')
      await writeFile(join(directory, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' })
      return record
    } catch (error) {
      assertWithin(this.backupRoot, directory)
      await assertNoLinks(directory)
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  private async updateRecord(record: BackupRecord): Promise<void> {
    const path = join(this.backupRoot, record.id, 'record.json')
    assertWithin(this.backupRoot, path)
    await textFile(path)
    const temporary = join(dirname(path), `.record-${randomUUID()}.tmp`)
    assertWithin(this.backupRoot, temporary)
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' })
      await assertNoLinks(path)
      await rename(temporary, path)
    } finally { if (await exists(temporary)) { await assertNoLinks(temporary); await rm(temporary) } }
  }

  async save(context: SkillsContext, id: string, revision: string, content: string): Promise<SkillWriteResult> {
    return this.serial(async () => {
      parseSkillContent(content)
      const { skill, source, targetPath } = await this.locate(context, id, true)
      if (typeof revision !== 'string' || skill.revision !== revision) throw new Error('Skill changed on disk. Refresh before saving; your draft was not written.')
      const backup = await this.backup(context, source, skill, targetPath, 'edit')
      if ((await filesAt(targetPath, skill.format)).revision !== revision) throw new Error('Skill changed during backup. Refresh before saving.')
      const temporary = join(source.path, `.studio-${randomUUID()}.tmp`)
      assertWithin(source.path, temporary)
      try {
        await writeFile(temporary, content, { flag: 'wx', encoding: 'utf8' })
        await assertNoLinks(skill.path)
        if ((await filesAt(targetPath, skill.format)).revision !== revision) throw new Error('Skill changed while saving. Refresh before saving.')
        await rename(temporary, skill.path)
      } finally {
        if (await exists(temporary)) { await assertNoLinks(temporary); await rm(temporary) }
      }
      const updated = await this.describe(source, targetPath, skill.path, skill.format)
      backup.afterRevision = updated.revision
      await this.updateRecord(backup)
      return { skill: updated, backup }
    })
  }

  async remove(context: SkillsContext, id: string, revision: string): Promise<SkillWriteResult> {
    return this.serial(async () => {
      const { skill, source, targetPath } = await this.locate(context, id, true)
      if (skill.revision !== revision) throw new Error('Skill changed on disk. Refresh before deleting.')
      const backup = await this.backup(context, source, skill, targetPath, 'delete')
      await assertNoLinks(targetPath)
      assertWithin(source.path, targetPath)
      if ((await filesAt(targetPath, skill.format)).revision !== revision) throw new Error('Skill changed during backup. Nothing was deleted.')
      await rm(targetPath, { recursive: skill.format === 'bundle' })
      return { backup }
    })
  }

  private async records(context: SkillsContext): Promise<BackupRecord[]> {
    await assertNoLinks(this.backupRoot, true)
    if (!await exists(this.backupRoot)) return []
    const result: BackupRecord[] = []
    for (const entry of (await readdir(this.backupRoot)).slice(0, 5000)) {
      if (!/^[0-9a-f-]{36}$/.test(entry)) continue
      const path = join(this.backupRoot, entry, 'record.json')
      try {
        const value = JSON.parse(await textFile(path)) as BackupRecord
        if (value.id === entry && value.profile === context.profile && key('home', value.dshHome) === key('home', context.dshHome) && ['bundle', 'file'].includes(value.format) && ['edit', 'delete', 'import'].includes(value.operation)) result.push(value)
      } catch { /* Corrupt/linked metadata never authorizes a restore. */ }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  async backups(context: SkillsContext): Promise<SkillBackup[]> {
    return (await this.records(context)).map(({ id, createdAt, operation, name, sourcePath, restored }) => ({ id, createdAt, operation, name, sourcePath, restored }))
  }

  async restore(context: SkillsContext, id: string): Promise<SkillWriteResult> {
    return this.serial(async () => {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid backup reference.')
      const record = (await this.records(context)).find((value) => value.id === id)
      if (!record || record.restored) throw new Error('Backup is unavailable or has already been restored.')
      const inventory = await this.list(context)
      const source = inventory.sources.find((value) => value.id === record.sourceId && value.writable)
      if (!source) throw new Error('The original DSH skill directory is not writable in the current workspace.')
      assertWithin(source.path, record.targetPath)
      if (dirname(record.targetPath) !== source.path) throw new Error('Invalid backup destination.')
      const directory = join(this.backupRoot, id)
      const payload = join(directory, record.format === 'bundle' ? 'payload' : 'payload.md')
      assertWithin(this.backupRoot, payload)
      const files = await filesAt(payload, record.format)
      if (files.revision !== record.beforeRevision) throw new Error('Backup contents changed. Restore was refused.')
      await assertNoLinks(record.targetPath, true)
      const existsNow = await exists(record.targetPath)
      let inverseBackup: BackupRecord | undefined
      if (existsNow) {
        if (record.operation !== 'edit' || !record.afterRevision || (await filesAt(record.targetPath, record.format)).revision !== record.afterRevision) {
          throw new Error('Restore would overwrite changed files. Keep or move the current skill before restoring.')
        }
        const instruction = record.format === 'bundle' ? join(record.targetPath, 'SKILL.md') : record.targetPath
        const current = await this.describe(source, record.targetPath, instruction, record.format)
        inverseBackup = await this.backup(context, source, current, record.targetPath, 'edit')
        // Editing only changes SKILL.md; restore only that file, preserving all
        // resource paths. The full revision above proves resources unchanged.
        const restoreFile = record.format === 'bundle' ? join(payload, 'SKILL.md') : payload
        const temporary = join(source.path, `.studio-${randomUUID()}.tmp`)
        try {
          await copyFile(restoreFile, temporary, constants.COPYFILE_EXCL)
          await assertNoLinks(instruction)
          if ((await filesAt(record.targetPath, record.format)).revision !== record.afterRevision) throw new Error('Skill changed during restore. Nothing was overwritten.')
          await rename(temporary, instruction)
        } finally { if (await exists(temporary)) { await assertNoLinks(temporary); await rm(temporary) } }
      } else {
        await mkdir(source.path, { recursive: true })
        if (record.format === 'bundle') {
          await this.installNew(source, basename(record.targetPath), async (staging) => copyChecked(payload, staging, 'bundle'), true)
        } else {
          const temporary = join(source.path, `.studio-${randomUUID()}.tmp`)
          try {
            await copyFile(payload, temporary, constants.COPYFILE_EXCL)
            await assertNoLinks(record.targetPath, true)
            await copyFile(temporary, record.targetPath, constants.COPYFILE_EXCL)
          } finally { if (await exists(temporary)) { await assertNoLinks(temporary); await rm(temporary) } }
        }
      }
      const instruction = record.format === 'bundle' ? join(record.targetPath, 'SKILL.md') : record.targetPath
      const skill = await this.describe(source, record.targetPath, instruction, record.format)
      if (inverseBackup) { inverseBackup.afterRevision = skill.revision; await this.updateRecord(inverseBackup) }
      record.restored = true
      await this.updateRecord(record)
      return { skill, backup: record }
    })
  }
}
