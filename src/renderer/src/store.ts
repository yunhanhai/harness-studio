import { create } from 'zustand'
import type {
  AppInfo,
  HostStatus,
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
  install: InstallProgress | null
  installing: boolean
  toasts: ToastItem[]
  view: ViewId
  focusMode: boolean
  settingsSection: string
  init: () => Promise<void>
  setView: (view: ViewId) => void
  setFocusMode: (value: boolean) => void
  setSettingsSection: (section: string) => void
  toast: (message: string, kind?: ToastItem['kind']) => void
  dismissToast: (id: number) => void
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  resetSettings: () => Promise<void>
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
  handleAction: (action: StudioAction) => void
}

let toastSeq = 0
let bootstrapped = false
let themeWatcher: (() => void) | null = null
let lastHostError = ''

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
  install: null,
  installing: false,
  toasts: [],
  view: 'home',
  focusMode: false,
  settingsSection: 'general',

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
    set({ info, settings, workspaces, prompts, host, logs, initialized: true })
    const params = new URLSearchParams(window.location.search)
    const requestedView = params.get('view')
    const views: ViewId[] = ['home', 'workspace', 'prompts', 'logs', 'settings']
    if (requestedView && views.includes(requestedView as ViewId)) {
      set({ view: requestedView as ViewId })
    }
    const requestedSection = params.get('section')
    if (requestedSection) set({ settingsSection: requestedSection })
    refreshDocumentTheme(settings)

    api.settings.onChange((next) => {
      set({ settings: next })
      refreshDocumentTheme(next)
    })
    api.workspaces.onChange((next) => set({ workspaces: next }))
    api.prompts.onChange((next) => set({ prompts: next }))
    api.host.onStatus((status) => {
      set({ host: status })
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
    api.studio.onToast((payload) => get().toast(payload.message, payload.kind ?? 'info'))

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
    try {
      const workspace = await window.studio.workspaces.add()
      if (workspace) {
        get().toast(`已添加工作区「${workspace.name}」`, 'success')
        await get().openWorkspace(workspace.id)
      }
      return workspace
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), 'error')
      return null
    }
  },
  removeWorkspace: async (id) => {
    await window.studio.workspaces.remove(id)
    if (get().host.workspaceId === id) await window.studio.host.stop()
  },
  updateWorkspace: async (id, patch) => {
    await window.studio.workspaces.update(id, patch)
  },
  openWorkspace: async (id) => {
    set({ view: 'workspace' })
    await get().startHost(id)
  },
  startHost: async (workspaceId) => {
    const target = workspaceId ?? get().settings?.lastWorkspaceId ?? get().workspaces[0]?.id
    if (!target) {
      set({ view: 'workspace' })
      get().toast('请先添加一个工作区', 'info')
      return
    }
    const current = get().host
    if (
      (current.state === 'ready' || current.state === 'starting') &&
      (!workspaceId || current.workspaceId === workspaceId)
    ) {
      set({ view: 'workspace' })
      return
    }
    await window.studio.host.start(target)
  },
  stopHost: async () => {
    await window.studio.host.stop()
  },
  restartHost: async () => {
    await window.studio.host.restart(get().host.workspaceId ?? get().settings?.lastWorkspaceId)
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

  handleAction: (action) => {
    const state = get()
    switch (action.type) {
      case 'navigate':
        state.setView(action.view)
        break
      case 'open-workspace':
        if (action.id) void state.openWorkspace(action.id)
        else if (state.workspaces.length === 0) void state.addWorkspace()
        else void state.openWorkspace(state.host.workspaceId ?? state.settings?.lastWorkspaceId ?? state.workspaces[0].id)
        break
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
      case 'check-updates':
        void window.studio.studio.checkUpdates().then((result) => {
          state.toast(result.message ?? '检查完成', result.status === 'error' ? 'error' : 'info')
        })
        break
      case 'show-about':
        state.setSettingsSection('about')
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
