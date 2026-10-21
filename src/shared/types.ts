export type ThemeMode = 'system' | 'light' | 'dark'
export type LanguageSetting = 'system' | 'zh-CN' | 'en-US'
export type ViewId = 'home' | 'workspace' | 'prompts' | 'logs' | 'settings'

export type HostState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'
export type RuntimeState = 'unknown' | 'checking' | 'missing' | 'ready' | 'error'

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
  v8: string
  userData: string
  logsDir: string
  dshHome: string
  isPackaged: boolean
  repoUrl: string
  giteeUrl: string
}

export interface RuntimeSettings {
  mode: 'auto' | 'custom'
  /** Explicit path to a dsh CLI entry (bin.js), a dsh package directory, or a dsh executable. */
  customPath: string
  /** Explicit path to a node executable. Empty means auto-detect. */
  nodePath: string
  /** DSH home directory. Empty means the default (~/.dsh). */
  dshHome: string
  /** Profile used by the embedded host. Studio clones `web` into an isolated profile by default. */
  profile: string
  /** 0 asks the operating system for a free port. */
  port: number
  extraArgs: string[]
  env: Record<string, string>
  autoStart: boolean
  registry: string
  /** Mirror used when downloading the portable Node.js runtime. */
  nodeMirror: string
}

export interface ShortcutSettings {
  toggleWindow: string
  palette: string
}

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export interface Settings {
  version: number
  language: LanguageSetting
  theme: ThemeMode
  accent: string
  reduceMotion: boolean
  zoomFactor: number
  closeToTray: boolean
  minimizeToTray: boolean
  launchAtLogin: boolean
  startMinimized: boolean
  checkUpdatesOnStart: boolean
  runtime: RuntimeSettings
  shortcuts: ShortcutSettings
  lastWorkspaceId: string
  window: WindowBounds
}

export interface Workspace {
  id: string
  name: string
  path: string
  color: string
  pinned: boolean
  createdAt: number
  lastOpenedAt: number
}

export interface PromptItem {
  id: string
  title: string
  content: string
  tags: string[]
  builtin: boolean
  usageCount: number
  createdAt: number
  updatedAt: number
}

export interface RuntimeInfo {
  state: RuntimeState
  source: 'portable' | 'custom' | 'npm-global' | 'path' | 'bundled' | null
  version?: string
  nodePath?: string
  cliPath?: string
  dshHome?: string
  nodeVersion?: string
  error?: string
  checkedAt: number
}

export interface HostStatus {
  state: HostState
  url?: string
  port?: number
  pid?: number
  workspaceId?: string
  startedAt?: number
  error?: string
}

export type LogStream = 'out' | 'err' | 'sys'

export interface LogLine {
  id: number
  ts: number
  stream: LogStream
  text: string
}

export interface InstallProgress {
  phase: 'idle' | 'download-node' | 'extract' | 'install-dsh' | 'verify' | 'done' | 'error'
  percent: number
  message: string
  detail?: string
}

export interface UpdateResult {
  status: 'dev' | 'checking' | 'available' | 'latest' | 'error'
  version?: string
  url?: string
  message?: string
  canDownload?: boolean
  downloaded?: boolean
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}

export type StudioAction =
  | { type: 'navigate'; view: ViewId }
  | { type: 'open-workspace'; id?: string; path?: string }
  | { type: 'start-host' }
  | { type: 'stop-host' }
  | { type: 'restart-host' }
  | { type: 'open-settings'; section?: string }
  | { type: 'open-logs' }
  | { type: 'toggle-theme' }
  | { type: 'check-updates' }
  | { type: 'show-about' }

export interface StudioApi {
  app: {
    info(): Promise<AppInfo>
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    openExternal(url: string): Promise<boolean>
    openPath(path: string): Promise<boolean>
    showItemInFolder(path: string): void
    setBadge(count: number): void
  }
  settings: {
    get(): Promise<Settings>
    save(patch: Partial<Settings>): Promise<Settings>
    reset(): Promise<Settings>
    onChange(cb: (settings: Settings) => void): () => void
    onWindowState(cb: (state: WindowState) => void): () => void
  }
  runtime: {
    detect(force?: boolean): Promise<RuntimeInfo>
    install(): Promise<InstallProgress>
    cancelInstall(): Promise<void>
    onInstallProgress(cb: (progress: InstallProgress) => void): () => void
  }
  host: {
    start(workspaceId?: string): Promise<HostStatus>
    stop(): Promise<HostStatus>
    restart(workspaceId?: string): Promise<HostStatus>
    status(): Promise<HostStatus>
    logs(): Promise<LogLine[]>
    clearLogs(): Promise<void>
    onStatus(cb: (status: HostStatus) => void): () => void
    onLog(cb: (line: LogLine) => void): () => void
    openLogsFolder(): Promise<void>
  }
  workspaces: {
    list(): Promise<Workspace[]>
    add(path?: string): Promise<Workspace | null>
    remove(id: string): Promise<Workspace[]>
    update(id: string, patch: Partial<Pick<Workspace, 'name' | 'pinned' | 'color'>>): Promise<Workspace[]>
    touch(id: string): Promise<Workspace[]>
    pickFolder(): Promise<string | null>
    onChange(cb: (items: Workspace[]) => void): () => void
  }
  prompts: {
    list(): Promise<PromptItem[]>
    save(input: Pick<PromptItem, 'title' | 'content' | 'tags'> & { id?: string }): Promise<PromptItem[]>
    remove(id: string): Promise<PromptItem[]>
    use(id: string): Promise<PromptItem[]>
    onChange(cb: (items: PromptItem[]) => void): () => void
  }
  studio: {
    onAction(cb: (action: StudioAction) => void): () => void
    onToast(cb: (payload: { message: string; kind?: 'info' | 'success' | 'error' }) => void): () => void
    runAction(action: StudioAction): void
    closePalette(): void
    hidePalette(): void
    showPalette(): void
    toast(message: string, kind?: 'info' | 'success' | 'error'): void
    checkUpdates(): Promise<UpdateResult>
    downloadUpdate(): Promise<UpdateResult>
    installUpdate(): void
    onUpdateProgress(cb: (progress: UpdateProgress) => void): () => void
    openReleases(): Promise<void>
    quit(): void
    relaunch(): void
  }
  clipboard: {
    write(text: string): Promise<void>
    read(): Promise<string>
  }
  zoom: {
    get(): Promise<number>
    set(factor: number): void
    onChange(cb: (factor: number) => void): () => void
  }
}
