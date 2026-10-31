import { create } from 'zustand'
import type {
  AppInfo,
  DshProcessReport,
  HostStatus,
  InsightsData,
  InstallProgress,
  LogLine,
  PromptItem,
  RuntimeInfo,
  Settings,
  StudioAction,
  ViewId,
  Workspace
} from '@shared/types'
import { applyAppearance, resolveTheme, watchSystemTheme } from './lib/theme'

export interface ToastItem {
  id: number
  message: string
  kind: 'info' | 'success' | 'error'
  /** Sticky toasts stay until dismissed, so long error text can be read or copied. */
  sticky?: boolean
  /** Optional one-click recovery action. */
  action?: { label: string; run: () => void }
}

/**
 * One embedded Harness conversation in the workspace view. Every tab is its own
 * <webview> against the same host, so tabs only differ in what the user opened.
 */
export interface WorkspaceTab {
  /** Unique for the renderer's lifetime and used as the React key: a new id means a new webview. */
  id: string
  /** Number shown in the fallback label 会话 N; never reused while the tab is open. */
  seq: number
  /** Session title reported by the guest page, '' until known. */
  title: string
  /** webContents id of the guest, once its page is ready. */
  guestId?: number
  /** The workspace actually open in this guest; never inferred from the Host. */
  workspaceId?: string
  path?: string
  sessionId?: string
  /** A requested workspace stays separate until the guest confirms it. */
  pendingWorkspaceId?: string
  pendingWorkspacePath?: string
}

interface AppState {
  initialized: boolean
  info: AppInfo | null
  settings: Settings | null
  runtime: RuntimeInfo | null
  host: HostStatus
  workspaces: Workspace[]
  prompts: PromptItem[]
  logs: LogLine[]
  insights: InsightsData | null
  insightsLoading: boolean
  insightsError: string | null
  install: InstallProgress | null
  installing: boolean
  toasts: ToastItem[]
  /** Other DeepSeek Harness processes on this machine. */
  instances: DshProcessReport | null
  instancesLoading: boolean
  view: ViewId
  focusMode: boolean
  settingsSection: string
  /** Session tabs in the workspace view; never empty. */
  tabs: WorkspaceTab[]
  activeTabId: string
  init: () => Promise<void>
  setView: (view: ViewId) => void
  setFocusMode: (value: boolean) => void
  setSettingsSection: (section: string) => void
  toast: (message: string, kind?: ToastItem['kind']) => void
  stickyToast: (message: string, kind?: ToastItem['kind'], action?: ToastItem['action']) => void
  dismissToast: (id: number) => void
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  resetSettings: () => Promise<void>
  loadInsights: (force?: boolean) => Promise<void>
  revealSession: (id: string) => Promise<void>
  refreshRuntime: () => Promise<void>
  installRuntime: () => Promise<void>
  cancelInstall: () => Promise<void>
  addWorkspace: () => Promise<Workspace | null>
  removeWorkspace: (id: string) => Promise<void>
  updateWorkspace: (id: string, patch: Partial<Pick<Workspace, 'name' | 'pinned' | 'color'>>) => Promise<void>
  openWorkspace: (id: string) => Promise<void>
  startHost: (workspaceId?: string) => Promise<void>
  stopHost: () => Promise<void>
  restartHost: () => Promise<void>
  savePrompt: (input: Pick<PromptItem, 'title' | 'content' | 'tags'> & { id?: string }) => Promise<boolean>
  deletePrompt: (id: string) => Promise<void>
  usePrompt: (item: PromptItem) => Promise<void>
  clearLogs: () => Promise<void>
  scanInstances: () => Promise<void>
  killInstances: (pids: number[]) => Promise<void>
  killOtherDsh: () => Promise<void>
  newTab: () => void
  /** Closes the active tab by default; the last tab never closes. */
  closeTab: (id?: string) => void
  activateTab: (id: string) => void
  cycleTab: (delta: 1 | -1) => void
  updateTab: (id: string, patch: Partial<Omit<WorkspaceTab, 'id' | 'seq'>>) => void
  handleAction: (action: StudioAction) => void
}

let toastSeq = 0
let bootstrapped = false
let themeWatcher: (() => void) | null = null
let lastHostError = ''
let tabIdSeq = 0
/** Host URL the current tabs were opened against; '' until a ready host was seen. */
let tabsHostUrl = ''
let resetTabsOnReady = false
let reopenWorkspaceId: string | undefined
let reopenWorkspacePath: string | undefined
let reopenTabId: string | undefined
let hostEpoch = 0
let hostStartRequest: Promise<unknown> | null = null
const workspaceRequests = new Map<string, AbortController>()
type WorkspaceObservation = { guestId: number; sessionId: string; path: string; workspaceId?: string }
const workspaceObservations = new Map<number, WorkspaceObservation>()

function cancelWorkspaceRequest(tabId: string): void {
  const request = workspaceRequests.get(tabId)
  if (!request) return
  const guestId = useApp.getState().tabs.find((tab) => tab.id === tabId)?.guestId
  request.abort()
  workspaceRequests.delete(tabId)
  if (guestId !== undefined) window.studio.tabs.cancelWorkspace(guestId)
}

/** Wait for this tab, never a fallback guest from another tab. */
function waitForTabGuest(tabId: string, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (guestId: number | null, error?: string): void => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(new Error(error))
      else resolve(guestId)
    }
    const onAbort = (): void => finish(null)
    const check = (): void => {
      const { tabs, host } = useApp.getState()
      const tab = tabs.find((item) => item.id === tabId)
      if (signal.aborted || !tab) return finish(null)
      if (host.state === 'ready' && host.url && tab.guestId !== undefined) return finish(tab.guestId)
      if (host.state === 'error' || host.state === 'stopped' || host.state === 'stopping') {
        finish(null, host.error ?? '运行时没有就绪，请重新打开工作区')
      }
    }
    unsubscribe = useApp.subscribe(check)
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(null, '会话界面没有加载完成，请稍后重试'), 90_000)
    check()
  })
}

async function openWorkspaceInTab(workspaceId: string, tabId: string, reveal = true, path?: string): Promise<void> {
  const state = useApp.getState()
  if (!state.tabs.some((tab) => tab.id === tabId)) return
  if (workspaceId && !state.workspaces.some((workspace) => workspace.id === workspaceId)) return
  if (!workspaceId && !path) return
  cancelWorkspaceRequest(tabId)
  const request = new AbortController()
  const epoch = hostEpoch
  workspaceRequests.set(tabId, request)
  state.updateTab(tabId, { pendingWorkspaceId: workspaceId || undefined, pendingWorkspacePath: path })
  if (reveal) state.setView('workspace')
  const current = (): WorkspaceTab | undefined => {
    if (request.signal.aborted || hostEpoch !== epoch || workspaceRequests.get(tabId) !== request) return undefined
    return useApp.getState().tabs.find((tab) => tab.id === tabId)
  }
  try {
    await state.startHost(workspaceId || undefined)
    if (!current()) return
    const guestId = await waitForTabGuest(tabId, request.signal)
    if (guestId === null || current()?.guestId !== guestId) return
    const result = await window.studio.tabs.openWorkspace(workspaceId, guestId, path)
    if (current()?.guestId !== guestId) return
    if (result.status === 'opened') {
      const confirmedId = result.workspaceId || workspaceId
      useApp.getState().updateTab(tabId, {
        workspaceId: useApp.getState().workspaces.some((item) => item.id === confirmedId) ? confirmedId : undefined,
        path: result.path,
        sessionId: result.sessionId,
        pendingWorkspaceId: undefined,
        pendingWorkspacePath: undefined
      })
    } else if (result.status === 'failed') {
      useApp.getState().toast(result.message ?? '工作区没有打开，请重试', 'error')
    }
  } catch (error) {
    if (current()) useApp.getState().toast(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    if (workspaceRequests.get(tabId) === request) {
      workspaceRequests.delete(tabId)
      useApp.getState().updateTab(tabId, { pendingWorkspaceId: undefined, pendingWorkspacePath: undefined })
    }
  }
}

function createTab(seq: number): WorkspaceTab {
  return { id: `tab-${++tabIdSeq}`, seq, title: '' }
}

const firstTab = createTab(1)

export function tabLimitMessage(limit: number): string {
  return `最多同时打开 ${limit} 个会话标签页，可在「设置 → 通用 → 会话标签页」调整`
}

function refreshDocumentTheme(settings: Settings): void {
  applyAppearance(settings)
  themeWatcher?.()
  themeWatcher = null
  if (settings.theme === 'system') {
    themeWatcher = watchSystemTheme(() => applyAppearance(settings))
  }
}

export const useApp = create<AppState>((set, get) => ({
  initialized: false,
  info: null,
  settings: null,
  runtime: null,
  host: { state: 'stopped' },
  workspaces: [],
  prompts: [],
  logs: [],
  insights: null,
  insightsLoading: false,
  insightsError: null,
  install: null,
  installing: false,
  toasts: [],
  instances: null,
  instancesLoading: false,
  view: 'home',
  focusMode: false,
  settingsSection: 'general',
  tabs: [firstTab],
  activeTabId: firstTab.id,

  init: async () => {
    if (bootstrapped) return
    bootstrapped = true
    const api = window.studio
    const [info, settings, workspaces, prompts, host, logs] = await Promise.all([
      api.app.info(),
      api.settings.get(),
      api.workspaces.list(),
      api.prompts.list(),
      api.host.status(),
      api.host.logs()
    ])
    tabsHostUrl = host.state === 'ready' && host.url ? host.url : ''
    set({ info, settings, workspaces, prompts, host, logs, initialized: true })
    const params = new URLSearchParams(window.location.search)
    const requestedView = params.get('view')
    const views: ViewId[] = ['home', 'workspace', 'insights', 'prompts', 'logs', 'settings']
    if (requestedView && views.includes(requestedView as ViewId)) {
      set({ view: requestedView as ViewId })
    }
    const requestedSection = params.get('section')
    if (requestedSection) set({ settingsSection: requestedSection })
    // Browser preview aid: ?tabs=N opens N session tabs, so the tab strip can be
    // screenshotted without Electron.
    const requestedTabs = Number(params.get('tabs'))
    if (Number.isInteger(requestedTabs) && requestedTabs >= 1 && requestedTabs <= 8) {
      const tabs = Array.from({ length: requestedTabs }, (_, index) => createTab(index + 1))
      set({ tabs, activeTabId: tabs[0].id })
    }
    refreshDocumentTheme(settings)

    api.settings.onChange((next) => {
      set({ settings: next })
      refreshDocumentTheme(next)
    })
    api.workspaces.onChange((next) => {
      const ids = new Set(next.map((workspace) => workspace.id))
      for (const tab of get().tabs) {
        if (tab.pendingWorkspaceId && !ids.has(tab.pendingWorkspaceId)) cancelWorkspaceRequest(tab.id)
      }
      set((state) => ({
        workspaces: next,
        tabs: state.tabs.map((tab) => ({
          ...tab,
          workspaceId: tab.workspaceId && ids.has(tab.workspaceId) ? tab.workspaceId : undefined,
          pendingWorkspaceId: tab.pendingWorkspaceId && ids.has(tab.pendingWorkspaceId) ? tab.pendingWorkspaceId : undefined
        }))
      }))
    })
    api.prompts.onChange((next) => set({ prompts: next }))
    api.tabs.onWorkspaceChanged((observation) => {
      if (get().host.state !== 'ready') return
      workspaceObservations.set(observation.guestId, observation)
      const tab = get().tabs.find((item) => item.guestId === observation.guestId)
      if (!tab) return
      get().updateTab(tab.id, {
        workspaceId: get().workspaces.some((item) => item.id === observation.workspaceId) ? observation.workspaceId : undefined,
        path: observation.path,
        sessionId: observation.sessionId
      })
    })
    api.host.onStatus((status) => {
      // A stop invalidates old guests even when the next process reuses its port.
      const previous = get().host
      const nextUrl = status.state === 'ready' && status.url ? status.url : ''
      const replaced = Boolean(nextUrl && tabsHostUrl && (
        nextUrl !== tabsHostUrl ||
        (previous.state === 'ready' && status.pid !== previous.pid) ||
        (previous.state === 'ready' && status.startedAt !== previous.startedAt)
      ))
      if ((previous.state === 'ready' && status.state !== 'ready') || replaced) {
        const active = get().tabs.find((tab) => tab.id === get().activeTabId)
        reopenTabId = active?.id
        reopenWorkspaceId = active?.pendingWorkspaceId ?? active?.workspaceId ?? get().settings?.lastWorkspaceId
        reopenWorkspacePath = active?.pendingWorkspacePath ?? (!active?.workspaceId ? active?.path : undefined)
        if (reopenWorkspacePath) reopenWorkspaceId = active?.pendingWorkspaceId
        hostEpoch++
        resetTabsOnReady = true
        for (const id of workspaceRequests.keys()) cancelWorkspaceRequest(id)
        workspaceObservations.clear()
      }
      const restarted = Boolean(nextUrl && resetTabsOnReady)
      if (nextUrl) tabsHostUrl = nextUrl
      if (restarted) {
        const active = get().tabs.find((tab) => tab.id === get().activeTabId)
        const restoreActive = active && (
          active.id !== reopenTabId || active.pendingWorkspaceId || active.pendingWorkspacePath
        )
        const target = restoreActive ? active.pendingWorkspaceId ?? active.workspaceId : reopenWorkspaceId
        const path = restoreActive
          ? active.pendingWorkspacePath ?? (!target ? active.path : undefined)
          : reopenWorkspacePath
        const tab = createTab(1)
        resetTabsOnReady = false
        reopenWorkspaceId = undefined
        reopenWorkspacePath = undefined
        reopenTabId = undefined
        set({ host: status, tabs: [tab], activeTabId: tab.id })
        if (target || path) void openWorkspaceInTab(target ?? '', tab.id, false, path)
      } else {
        set((state) => ({
          host: status,
          ...(status.state !== 'ready' && previous.state === 'ready'
            ? { tabs: state.tabs.map((tab) => ({ ...tab, guestId: undefined, pendingWorkspaceId: undefined, pendingWorkspacePath: undefined })) }
            : {})
        }))
      }
      if (status.state === 'error' && status.error && status.error !== lastHostError) {
        lastHostError = status.error
        get().toast(status.error, 'error')
      }
      if (status.state === 'ready') lastHostError = ''
    })
    api.host.onLog((line) => {
      set((state) => ({ logs: [...state.logs.slice(-2999), line] }))
    })
    api.runtime.onInstallProgress((progress) => {
      set({ install: progress, installing: progress.phase !== 'done' && progress.phase !== 'error' })
    })
    api.studio.onAction((action) => get().handleAction(action))
    api.studio.onToast((payload) => {
      if (payload.sticky) {
        const action =
          payload.action === 'kill-other-dsh'
            ? { label: '结束其他 DSH 进程', run: () => void get().killOtherDsh() }
            : undefined
        get().stickyToast(payload.message, payload.kind ?? 'error', action)
      } else {
        get().toast(payload.message, payload.kind ?? 'info')
      }
    })

    void api.runtime.detect().then((runtime) => set({ runtime }))
  },

  setView: (view) => set({ view }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setSettingsSection: (settingsSection) => set({ settingsSection, view: 'settings' }),

  toast: (message, kind = 'info') => {
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6500 : 3800)
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),

  /** A toast that waits for the user: long errors and mirrored Harness notices. */
  stickyToast: (message, kind = 'error', action) => {
    // Harness can repeat the same failure on every send attempt; one copy is
    // enough, otherwise the toast stack fills with identical text.
    const existing = get().toasts.find((item) => item.sticky && item.message === message)
    if (existing) return
    const id = ++toastSeq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind, sticky: true, action }] }))
  },

  saveSettings: async (patch) => {
    const current = get().settings
    if (!current) return
    try {
      const next = await window.studio.settings.save(patch)
      set({ settings: next })
      refreshDocumentTheme(next)
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), 'error')
    }
  },
  resetSettings: async () => {
    const next = await window.studio.settings.reset()
    set({ settings: next })
    refreshDocumentTheme(next)
    get().toast('设置已恢复默认值', 'success')
  },

  loadInsights: async (force = false) => {
    if (get().insightsLoading) return
    set({ insightsLoading: true, insightsError: null })
    try {
      const data = await window.studio.insights.scan(force)
      set({ insights: data, insightsLoading: false })
    } catch (error) {
      set({
        insightsLoading: false,
        insightsError: error instanceof Error ? error.message : String(error)
      })
    }
  },
  revealSession: async (id) => {
    const ok = await window.studio.insights.revealSession(id)
    if (!ok) get().toast('找不到该会话目录', 'error')
  },

  refreshRuntime: async () => {
    const runtime = await window.studio.runtime.detect(true)
    set({ runtime })
  },
  installRuntime: async () => {
    if (get().installing) return
    set({ installing: true, install: { phase: 'download-node', percent: 0, message: '准备安装…' } })
    try {
      const result = await window.studio.runtime.install()
      const runtime = await window.studio.runtime.detect(true)
      set({ runtime, installing: false, install: result })
      if (result.phase === 'done') get().toast('便携运行时安装完成', 'success')
      else get().toast(result.message, 'error')
    } catch (error) {
      set({ installing: false })
      get().toast(error instanceof Error ? error.message : String(error), 'error')
    }
  },
  cancelInstall: async () => {
    await window.studio.runtime.cancelInstall()
  },

  addWorkspace: async () => {
    const tabId = get().activeTabId
    cancelWorkspaceRequest(tabId)
    const request = new AbortController()
    workspaceRequests.set(tabId, request)
    get().updateTab(tabId, { pendingWorkspaceId: undefined, pendingWorkspacePath: undefined })
    try {
      const workspace = await window.studio.workspaces.add()
      if (workspace) {
        get().toast(`已添加工作区「${workspace.name}」`, 'success')
        if (!request.signal.aborted && workspaceRequests.get(tabId) === request) {
          await openWorkspaceInTab(workspace.id, tabId)
        }
      }
      return workspace
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), 'error')
      return null
    } finally {
      if (workspaceRequests.get(tabId) === request) workspaceRequests.delete(tabId)
    }
  },
  removeWorkspace: async (id) => {
    await window.studio.workspaces.remove(id)
    for (const tab of get().tabs) {
      if (tab.pendingWorkspaceId === id) cancelWorkspaceRequest(tab.id)
    }
    set((state) => ({ tabs: state.tabs.map((tab) => ({
      ...tab,
      workspaceId: tab.workspaceId === id ? undefined : tab.workspaceId,
      pendingWorkspaceId: tab.pendingWorkspaceId === id ? undefined : tab.pendingWorkspaceId
    })) }))
  },
  updateWorkspace: async (id, patch) => {
    await window.studio.workspaces.update(id, patch)
  },
  openWorkspace: async (id) => {
    await openWorkspaceInTab(id, get().activeTabId)
  },
  startHost: async (workspaceId) => {
    const current = get().host
    if (current.state === 'ready' || current.state === 'starting') return
    const target = workspaceId ?? get().settings?.lastWorkspaceId ?? get().workspaces[0]?.id
    if (!target) {
      get().toast('请先添加一个工作区', 'info')
      return
    }
    // Starting the shared process never opens or changes a guest page. Multiple
    // selections during a cold start share one launch instead of restarting it.
    if (!hostStartRequest) {
      hostStartRequest = window.studio.host.start(target).finally(() => { hostStartRequest = null })
    }
    await hostStartRequest
  },
  stopHost: async () => {
    await window.studio.host.stop()
  },
  restartHost: async () => {
    const active = get().tabs.find((tab) => tab.id === get().activeTabId)
    await window.studio.host.restart(active?.pendingWorkspaceId ?? active?.workspaceId ?? get().settings?.lastWorkspaceId)
  },

  savePrompt: async (input) => {
    try {
      await window.studio.prompts.save(input)
      get().toast(input.id ? '提示词已更新' : '提示词已创建', 'success')
      return true
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), 'error')
      return false
    }
  },
  deletePrompt: async (id) => {
    await window.studio.prompts.remove(id)
    get().toast('提示词已删除', 'success')
  },
  usePrompt: async (item) => {
    await window.studio.clipboard.write(item.content)
    await window.studio.prompts.use(item.id)
    get().toast('已复制到剪贴板，粘贴到会话即可发送', 'success')
  },
  clearLogs: async () => {
    await window.studio.host.clearLogs()
    set({ logs: [] })
  },

  scanInstances: async () => {
    if (get().instancesLoading) return
    set({ instancesLoading: true })
    try {
      const report = await window.studio.host.instances()
      set({ instances: report, instancesLoading: false })
    } catch (error) {
      set({ instancesLoading: false })
      get().toast(error instanceof Error ? error.message : String(error), 'error')
    }
  },
  killInstances: async (pids) => {
    const result = await window.studio.host.killInstances(pids)
    set({ instances: result.report })
  },
  killOtherDsh: async () => {
    const report = await window.studio.host.instances()
    set({ instances: report })
    if (report.restricted) {
      get().stickyToast(
        '无法枚举本机进程（Studio 当前权限受限），不能确认是哪个进程占用了会话。请手动退出其他 dsh web 或桌面端，或在「设置 → 运行时」更换配置档案。',
        'error'
      )
      return
    }
    const targets = report.processes.filter((item) => !item.self)
    if (targets.length === 0) {
      get().toast('没有发现其他正在运行的 DSH 进程', 'info')
      return
    }
    await get().killInstances(targets.map((item) => item.pid))
  },

  newTab: () => {
    const { initialized, tabs, settings, workspaces } = get()
    // Workspaces are unknown until init has loaded them.
    if (!initialized) return
    const source = tabs.find((tab) => tab.id === get().activeTabId)
    // Without a workspace the view is onboarding and has no tab strip, so a
    // tab opened now would only appear later, unasked for.
    if (workspaces.length === 0 && !source?.path) {
      set({ view: 'workspace' })
      get().toast('请先添加一个工作区', 'info')
      return
    }
    // A tab opened while the host is down has no page and would only appear
    // later, unasked for; the "+" button is disabled for the same reason.
    const host = get().host
    if (host.state !== 'ready' || !host.url) {
      set({ view: 'workspace' })
      get().toast('运行时还没就绪，就绪后再新建标签页', 'info')
      return
    }
    const limit = settings?.tabs.limit ?? 4
    if (tabs.length >= limit) {
      get().toast(tabLimitMessage(limit), 'info')
      return
    }
    const seq = tabs.reduce((max, tab) => Math.max(max, tab.seq), 0) + 1
    const target = source?.workspaceId ?? source?.pendingWorkspaceId
    const path = source?.path ?? source?.pendingWorkspacePath
    const tab = createTab(seq)
    set({ tabs: [...tabs, tab], activeTabId: tab.id, view: 'workspace' })
    if (target) {
      void openWorkspaceInTab(target, tab.id, false)
    } else if (path) {
      void openWorkspaceInTab('', tab.id, false, path)
    } else {
      const fallback = settings?.lastWorkspaceId || workspaces[0]?.id
      if (fallback) void openWorkspaceInTab(fallback, tab.id, false)
    }
  },
  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const target = id ?? activeTabId
    const index = tabs.findIndex((tab) => tab.id === target)
    if (index === -1 || tabs.length <= 1) return
    cancelWorkspaceRequest(target)
    const guestId = tabs[index].guestId
    if (guestId !== undefined) workspaceObservations.delete(guestId)
    const rest = tabs.filter((tab) => tab.id !== target)
    // Like a browser: the right neighbour takes over, or the left one at the end.
    const nextActive = target === activeTabId ? rest[Math.min(index, rest.length - 1)].id : activeTabId
    set({ tabs: rest, activeTabId: nextActive })
  },
  activateTab: (id) => {
    const { tabs, activeTabId } = get()
    if (id !== activeTabId && tabs.some((tab) => tab.id === id)) set({ activeTabId: id })
  },
  cycleTab: (delta) => {
    const { tabs, activeTabId } = get()
    if (tabs.length < 2) return
    const index = tabs.findIndex((tab) => tab.id === activeTabId)
    set({ activeTabId: tabs[(index + delta + tabs.length) % tabs.length].id })
  },
  updateTab: (id, patch) => {
    const current = get().tabs.find((tab) => tab.id === id)
    if (!current) return
    if ('guestId' in patch && patch.guestId !== current.guestId && current.guestId !== undefined) {
      cancelWorkspaceRequest(id)
      workspaceObservations.delete(current.guestId)
      patch = { ...patch, pendingWorkspaceId: undefined, pendingWorkspacePath: undefined }
    }
    if (patch.guestId !== undefined) {
      const observed = workspaceObservations.get(patch.guestId)
      if (observed) {
        patch = {
          ...patch,
          workspaceId: get().workspaces.some((workspace) => workspace.id === observed.workspaceId) ? observed.workspaceId : undefined,
          path: observed.path,
          sessionId: observed.sessionId
        }
      }
    }
    const keys = Object.keys(patch) as Array<keyof typeof patch>
    // Guests repeat dom-ready and title events; skip updates that change nothing.
    if (keys.every((key) => current[key] === patch[key])) return
    set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }))
  },

  handleAction: (action) => {
    const state = get()
    switch (action.type) {
      case 'navigate':
        state.setView(action.view)
        break
      case 'open-workspace': {
        const active = state.tabs.find((tab) => tab.id === state.activeTabId)
        if (action.id) void state.openWorkspace(action.id)
        else if (active?.pendingWorkspaceId || active?.pendingWorkspacePath || (state.host.state === 'ready' && active?.guestId !== undefined)) {
          state.setView('workspace')
        } else if (active?.path && !active.workspaceId) {
          state.setView('workspace')
          void state.startHost()
        } else if (state.workspaces.length === 0) void state.addWorkspace()
        else {
          void state.openWorkspace(active?.workspaceId ?? state.settings?.lastWorkspaceId ?? state.workspaces[0].id)
        }
        break
      }
      case 'start-host':
        void state.startHost()
        break
      case 'stop-host':
        void state.stopHost()
        break
      case 'restart-host':
        void state.restartHost()
        break
      case 'open-settings':
        if (action.section) state.setSettingsSection(action.section)
        else state.setView('settings')
        break
      case 'open-logs':
        state.setView('logs')
        break
      case 'open-insights':
        state.setView('insights')
        void state.loadInsights()
        break
      case 'check-updates':
        void window.studio.studio.checkUpdates().then((result) => {
          state.toast(result.message ?? '检查完成', result.status === 'error' ? 'error' : 'info')
        })
        break
      case 'show-about':
        state.setSettingsSection('about')
        break
      case 'new-tab':
        state.newTab()
        break
      // Keys only send these while the workspace is on screen; from another page
      // only the palette can, so switch over and let the user see what closed.
      case 'close-tab':
        if (state.view !== 'workspace') state.setView('workspace')
        state.closeTab()
        break
      // Switching acts on the visible tab strip, so it only applies in the workspace view.
      case 'next-tab':
        if (state.view === 'workspace') state.cycleTab(1)
        break
      case 'prev-tab':
        if (state.view === 'workspace') state.cycleTab(-1)
        break
      default:
        break
    }
  }
}))

export function currentThemeMode(): 'light' | 'dark' {
  const settings = useApp.getState().settings
  return settings ? resolveTheme(settings.theme) : 'dark'
}
