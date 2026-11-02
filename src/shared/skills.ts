/** Local DSH filesystem skills. This is a disk inventory, not the live session catalog. */
export type SkillSourceKind = 'project-dsh' | 'project-agents' | 'custom' | 'user-dsh' | 'user-agents' | 'bundled'

export interface SkillSource {
  id: string
  kind: SkillSourceKind
  path: string
  rank: number
  scope: 'project' | 'user' | 'custom' | 'bundled'
  writable: boolean
  exists: boolean
  diagnostic?: string
}

export interface LocalSkill {
  id: string
  sourceId: string
  path: string
  directory: string
  format: 'bundle' | 'file'
  name: string
  description: string
  whenToUse?: string
  valid: boolean
  diagnostic?: string
  modelInvocable: boolean
  userInvocable: boolean
  /** Winning local file among the scanned roots; live providers may differ. */
  shadowedBy?: string
  writable: boolean
  revision: string
  resourceCount: number
}

export interface SkillsInventory {
  cwd?: string
  projectRoot?: string
  dshHome: string
  profile: string
  configurationVerified: boolean
  /** No virtual/remote/runtime skill providers are included. */
  catalogKind: 'filesystem'
  sources: SkillSource[]
  skills: LocalSkill[]
  warnings: string[]
}

export interface SkillPreview {
  skill: LocalSkill
  content: string
  /** Paths relative to the bundle. Flat skills only list their instruction file. */
  resources: string[]
}

export interface SkillBackup {
  id: string
  createdAt: number
  operation: 'edit' | 'delete' | 'import'
  name: string
  sourcePath: string
  restored: boolean
}

export interface SkillWriteResult {
  skill?: LocalSkill
  backup?: SkillBackup
}

export interface SkillsAPI {
  list(): Promise<SkillsInventory>
  preview(skillId: string): Promise<SkillPreview>
  create(sourceId: string, name: string, content: string): Promise<SkillWriteResult>
  save(skillId: string, revision: string, content: string): Promise<SkillWriteResult>
  /** Opens a native picker. A cancelled picker returns undefined. No replacement is performed. */
  import(sourceId: string): Promise<SkillWriteResult | undefined>
  remove(skillId: string, revision: string): Promise<SkillWriteResult>
  backups(): Promise<SkillBackup[]>
  /** Restore requires an empty original destination or an unchanged post-edit revision. */
  restore(backupId: string): Promise<SkillWriteResult>
}
