import {
  BrowserWindow,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeTheme,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ACCENTS, DEFAULT_SETTINGS, GITHUB_REPO, GITHUB_URL, GITEE_URL, PRODUCT_NAME } from '@shared/defaults'
import { IPC } from '@shared/channels'
import type {
  AppInfo,
  HostStatus,
  InstallProgress,
  LogLine,
  PromptItem,
  RuntimeInfo,
  Settings,
  StudioAction,
  QuickAskResult,
  Workspace
} from '@shared/types'
import { log, logError, logsDirectory } from './logger'
import { createStores, deepMerge, loadStores, mergeSettings, type Stores } from './store'
import { detectRuntime, resolveDshHome } from './runtime/detect'
import { HostManager } from './runtime/host'
import { RuntimeInstaller } from './runtime/installer'
import { createMainWindow, createPaletteWindow, createQuickAskWindow, preloadPath } from './windows'
import { applyTheme } from './windows'
import { injectIntoComposer } from './quickask'
import { registerGlobalShortcuts } from './shortcuts'
import { installApplicationMenu } from './menu'
import { createTray } from './tray'
import { checkForUpdates, downloadUpdate, installUpdate } from './updater'
import { autoUpdater } from 'electron-updater'
import { invalidateSessionCache, scanSessions } from './sessions'

app.setName('Harness Studio')
if (process.env.HARNESS_STUDIO_USER_DATA) {
  app.setPath('userData', resolve(process.env.HARNESS_STUDIO_USER_DATA))
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', join(process.env.PORTABLE_EXECUTABLE_DIR, 'HarnessStudioData'))
}

let mainWindow: BrowserWindow | null = null
let paletteWindow: BrowserWindow | null = null
let quickAskWindow: BrowserWindow | null = null
let stores: Stores
let host: HostManager
let installer: RuntimeInstaller
let runtimeInfo: RuntimeInfo | null = null
let quitting = false
let closeNoticeShown = false
let guestContents: Electron.WebContents | null = null
const guestWaiters: Array<(contents: Electron.WebContents) => void> = []

/** Wait for the embedded Harness webview to attach (after switching to the workspace view). */
function waitForGuest(timeoutMs = 15_000): Promise<Electron.WebContents | null> {
  if (guestContents && !guestContents.isDestroyed()) return Promise.resolve(guestContents)
  return new Promise((resolve) => {
    let settled = false
    const finish = (contents: Electron.WebContents | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(contents)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    guestWaiters.push((contents) => finish(contents))
  })
}

const settings = (): Settings => stores.settings.get()
const workspaceList = (): Workspace[] => stores.workspaces.get()
const promptList = (): PromptItem[] => stores.prompts.get()

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function assertTrusted(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const sender = event.sender
  if (
    mainWindow?.webContents === sender ||
    paletteWindow?.webContents === sender ||
    quickAskWindow?.webContents === sender
  ) {
    return
  }
  throw new Error('IPC request from an untrusted renderer')
}

function sendMain(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function sendPalette(channel: string, payload?: unknown): void {
  if (paletteWindow && !paletteWindow.isDestroyed()) paletteWindow.webContents.send(channel, payload)
}

function sendQuickAsk(channel: string, payload?: unknown): void {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) quickAskWindow.webContents.send(channel, payload)
}

function broadcast(channel: string, payload?: unknown): void {
  sendMain(channel, payload)
  sendPalette(channel, payload)
  sendQuickAsk(channel, payload)
}

function showMain(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleMain(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    return
  }
  showMain()
}

function showPalette(): void {
  if (!paletteWindow) return
  try {
    app.focus({ steal: true })
  } catch {
    /* not supported on every platform */
  }
  paletteWindow.show()
  paletteWindow.focus()
  sendPalette(IPC.paletteShow)
}

function hideQuickAsk(): void {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) quickAskWindow.hide()
}

function showQuickAsk(): void {
  if (!quickAskWindow) return
  if (host.getStatus().state !== 'ready') {
    showMain()
    sendMain(IPC.toast, { message: '运行时尚未就绪，无法快速提问', kind: 'error' })
    return
  }
  try {
    app.focus({ steal: true })
  } catch {
    /* not supported on every platform */
  }
  quickAskWindow.show()
  quickAskWindow.focus()
  sendQuickAsk(IPC.quickAskOpened)
}

async function submitQuickAsk(
  text: string,
  options: { autoSend?: boolean; reveal?: boolean } = {}
): Promise<QuickAskResult> {
  const current = settings()
  const autoSend = options.autoSend ?? current.quickAsk.autoSend
  const reveal = options.reveal ?? current.quickAsk.revealAfterSend

  if (!workspaceList().length) {
    return { status: 'no-workspace', message: '还没有工作区' }
  }

  const status = host.getStatus()
  if (status.state !== 'ready') {
    return { status: 'needs-host', message: '运行时尚未就绪，请先打开工作区' }
  }

  // The composer only exists once the workspace view mounted its webview.
  // If the user is on another page, switch there and wait for it.
  let guest = guestContents && !guestContents.isDestroyed() ? guestContents : null
  if (!guest) {
    sendAction({ type: 'open-workspace', id: status.workspaceId })
    hideQuickAsk()
    guest = await waitForGuest()
    if (!guest) return { status: 'needs-host', message: '会话界面没有加载完成，请稍后重试' }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  const result = await injectIntoComposer(guest, text, { autoSend })

  if (result.status === 'sent' || result.status === 'inserted') {
    const limit = Math.max(1, Math.min(20, current.quickAsk.recentLimit))
    const trimmed = text.trim()
    await stores.quickAskRecent
      .update((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, limit))
      .catch(() => undefined)
    if (reveal) showMain()
    hideQuickAsk()
    sendMain(IPC.toast, {
      message: result.status === 'sent' ? '已发送到 Harness' : (result.message ?? '已填入输入框'),
      kind: result.status === 'sent' ? 'success' : 'info'
    })
  } else {
    log('quick-ask', `submit failed: ${result.status} ${result.message ?? ''}`)
  }
  sendQuickAsk(IPC.quickAskResult, result)
  return result
}

function hidePalette(): void {
  if (paletteWindow && !paletteWindow.isDestroyed()) paletteWindow.hide()
  if (mainWindow?.isVisible()) mainWindow.focus()
}

function sendAction(action: StudioAction): void {
  showMain()
  sendMain(IPC.action, action)
  hidePalette()
}

function pickWorkspace(id?: string): Workspace | undefined {
  const list = workspaceList()
  if (id) return list.find((item) => item.id === id)
  const last = settings().lastWorkspaceId
  if (last) {
    const found = list.find((item) => item.id === last)
    if (found) return found
  }
  return list[0]
}

function buildAppInfo(): AppInfo {
  return {
    name: PRODUCT_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    userData: app.getPath('userData'),
    logsDir: logsDirectory(),
    dshHome: resolveDshHome(settings()),
    isPackaged: app.isPackaged,
    repoUrl: GITHUB_URL,
    giteeUrl: GITEE_URL
  }
}

async function ensureRuntime(): Promise<RuntimeInfo> {
  if (runtimeInfo && runtimeInfo.state === 'ready' && Date.now() - runtimeInfo.checkedAt < 30_000) return runtimeInfo
  runtimeInfo = await detectRuntime(settings(), app.getPath('userData'))
  return runtimeInfo
}

async function startHost(workspaceId?: string): Promise<HostStatus> {
  const workspace = pickWorkspace(workspaceId)
  if (!workspace) {
    const status: HostStatus = { state: 'error', error: '还没有工作区。请先选择一个项目文件夹。' }
    sendMain(IPC.hostStatusChanged, status)
    return status
  }
  const info = await ensureRuntime()
  if (info.state !== 'ready') {
    const status: HostStatus = { state: 'error', error: info.error ?? '运行时尚未就绪。' }
    sendMain(IPC.hostStatusChanged, status)
    return status
  }
  const current = host.getStatus()
  if (current.state === 'ready' && current.workspaceId === workspace.id) return current

  await stores.settings.update((value) => ({ ...value, lastWorkspaceId: workspace.id }))
  await stores.workspaces.update((list) =>
    list.map((item) => (item.id === workspace.id ? { ...item, lastOpenedAt: Date.now() } : item))
  )

  const hostOptions = {
    runtime: info,
    settings: settings(),
    workspacePath: workspace.path,
    workspaceId: workspace.id,
    tempDir: join(app.getPath('userData'), 'tmp')
  }

  if (current.state === 'ready' || current.state === 'starting') {
    return host.restart(hostOptions)
  }
  return host.start(hostOptions)
}

async function stopHost(): Promise<HostStatus> {
  return host.stop()
}

function applySettings(next: Settings): void {
  applyTheme(next.theme)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(next.zoomFactor)
  }
  if (app.isPackaged && process.platform !== 'linux') {
    try {
      app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    } catch (error) {
      logError('settings', error)
    }
  }
  const failures = registerGlobalShortcuts(next, {
    toggleWindow: toggleMain,
    palette: showPalette,
    quickAsk: showQuickAsk
  })
  if (guestContents && !guestContents.isDestroyed()) {
    guestContents.send(IPC.guestTheme, {
      theme: next.theme,
      accent: next.accent,
      reduceMotion: next.reduceMotion
    })
  }
  if (failures.length > 0) {
    sendMain(IPC.toast, { message: `全局快捷键被占用：${failures.join('、')}`, kind: 'error' })
  }
  for (const win of [mainWindow, paletteWindow, quickAskWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, next)
  }
}

function handleClose(event: Electron.Event): void {
  if (quitting) return
  event.preventDefault()
  const current = settings()
  if (!current.closeToTray) {
    void quitApp()
    return
  }
  const marker = join(app.getPath('userData'), 'close-notice-shown')
  if (!closeNoticeShown && !existsSync(marker)) {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      title: 'Harness Studio 仍在运行',
      message: '要隐藏到系统托盘，还是退出应用？',
      detail: '隐藏后，正在运行的会话和任务不会中断。可以从托盘图标或全局快捷键重新打开。',
      buttons: ['隐藏到托盘', '退出应用'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (choice === 1) {
      void quitApp()
      return
    }
    closeNoticeShown = true
    try {
      writeFileSync(marker, new Date().toISOString(), 'utf8')
    } catch {
      /* non-fatal */
    }
  }
  mainWindow?.hide()
}

async function quitApp(): Promise<void> {
  if (quitting) return
  quitting = true
  try {
    await Promise.race([host.stop(), new Promise((resolve) => setTimeout(resolve, 4000))])
  } catch (error) {
    logError('quit', error)
  }
  globalShortcut.unregisterAll()
  app.quit()
}

function configureWebviewSecurity(window: BrowserWindow): void {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const status = host.getStatus()
    let allowed = false
    try {
      allowed = Boolean(status.url) && new URL(params.src).origin === new URL(status.url!).origin
    } catch {
      allowed = false
    }
    if (!allowed) {
      event.preventDefault()
      return
    }
    webPreferences.preload = preloadPath('workspace')
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.partition = 'persist:harness-studio'
    try {
      params.partition = 'persist:harness-studio'
    } catch {
      /* older Electron exposes a frozen params object */
    }
  })

  window.webContents.on('did-attach-webview', (_event, contents) => {
    guestContents = contents
    for (const resolve of guestWaiters.splice(0)) resolve(contents)
    contents.once('destroyed', () => {
      if (guestContents === contents) guestContents = null
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttp(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const status = host.getStatus()
      try {
        if (url === 'about:blank') return
        if (status.url && new URL(url).origin === new URL(status.url).origin) return
      } catch {
        /* fall through */
      }
      event.preventDefault()
      if (isHttp(url)) void shell.openExternal(url)
    })
    contents.on('before-input-event', (event, input) => handleShortcut(event, input))
    contents.on('dom-ready', () => {
      contents.send(IPC.guestTheme, {
        theme: settings().theme,
        accent: settings().accent,
        reduceMotion: settings().reduceMotion
      })
    })
  })

  const harnessSession = session.fromPartition('persist:harness-studio')
  const allowedPermissions = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
    'media',
    'fullscreen'
  ])
  harnessSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })
  harnessSession.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission))
}

function handleShortcut(event: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown') return
  const mod = process.platform === 'darwin' ? input.meta : input.control
  if (!mod) return
  const key = input.key.toLowerCase()
  if (key === 'k' && !input.shift) {
    event.preventDefault()
    if (paletteWindow?.isVisible()) hidePalette()
    else showPalette()
    return
  }
  if (key === ',') {
    event.preventDefault()
    sendAction({ type: 'open-settings' })
    return
  }
  if (key === 'l' && input.shift) {
    event.preventDefault()
    sendAction({ type: 'open-logs' })
    return
  }
  if (key === 'i' && input.shift) {
    event.preventDefault()
    BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools()
  }
}

function registerIpc(): void {
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrusted(event)
      return fn(...(args as never[]))
    })
  }
  const on = (channel: string, fn: (...args: never[]) => void): void => {
    ipcMain.on(channel, (event, ...args) => {
      assertTrusted(event)
      fn(...(args as never[]))
    })
  }

  handle(IPC.appInfo, () => buildAppInfo())
  on(IPC.appMinimize, () => mainWindow?.minimize())
  on(IPC.appToggleMaximize, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  on(IPC.appClose, () => mainWindow?.close())
  handle(IPC.appIsMaximized, () => mainWindow?.isMaximized() ?? false)
  handle(IPC.appOpenExternal, async (url: string) => {
    if (!isHttp(url) && !url.startsWith('mailto:')) return false
    await shell.openExternal(url)
    return true
  })
  handle(IPC.appOpenPath, async (path: string) => {
    const error = await shell.openPath(path)
    return error === ''
  })
  on(IPC.appShowItem, (path: string) => shell.showItemInFolder(path))
  on(IPC.appSetBadge, (count: number) => {
    if (process.platform === 'darwin') app.setBadgeCount(count)
  })
  on(IPC.appQuit, () => void quitApp())
  on(IPC.appRelaunch, () => {
    app.relaunch()
    void quitApp()
  })

  handle(IPC.settingsGet, () => settings())
  handle(IPC.settingsSave, async (patch: Partial<Settings>) => {
    const next = mergeSettings(DEFAULT_SETTINGS, deepMerge(settings(), patch))
    await stores.settings.set(next)
    applySettings(next)
    return next
  })
  handle(IPC.settingsReset, async () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { window: settings().window })
    await stores.settings.set(next)
    applySettings(next)
    return next
  })

  handle(IPC.runtimeDetect, async () => {
    runtimeInfo = await detectRuntime(settings(), app.getPath('userData'))
    return runtimeInfo
  })
  handle(IPC.runtimeInstall, async () => {
    const progress: InstallProgress = await installer.install(
      app.getPath('userData'),
      settings(),
      (value) => broadcast(IPC.runtimeInstallProgress, value)
    )
    runtimeInfo = await detectRuntime(settings(), app.getPath('userData'))
    return progress
  })
  handle(IPC.runtimeCancelInstall, () => installer.cancel())

  handle(IPC.hostStart, (workspaceId?: string) => startHost(workspaceId))
  handle(IPC.hostStop, () => stopHost())
  handle(IPC.hostRestart, async (workspaceId?: string) => {
    await host.stop()
    return startHost(workspaceId)
  })
  handle(IPC.hostStatus, () => host.getStatus())
  handle(IPC.hostLogs, () => host.getLogs())
  handle(IPC.hostClearLogs, () => host.clearLogs())
  handle(IPC.hostOpenLogsFolder, () => shell.openPath(logsDirectory()))

  handle(IPC.workspacesList, () => workspaceList())
  handle(IPC.workspacesAdd, async (pathArg?: string) => {
    let path = pathArg?.trim()
    if (!path) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: '选择工作区文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      path = result.filePaths[0]
    }
    const normalized = resolve(path)
    if (!existsSync(normalized)) throw new Error('文件夹不存在')
    const existing = workspaceList().find((item) => item.path.toLowerCase() === normalized.toLowerCase())
    if (existing) return existing
    const workspace: Workspace = {
      id: `ws_${randomUUID()}`,
      name: basename(normalized) || normalized,
      path: normalized,
      color: ACCENTS[workspaceList().length % ACCENTS.length],
      pinned: false,
      createdAt: Date.now(),
      lastOpenedAt: 0
    }
    await stores.workspaces.update((list) => [workspace, ...list])
    const nextSettings = await stores.settings.update((value) =>
      value.lastWorkspaceId ? value : { ...value, lastWorkspaceId: workspace.id }
    )
    broadcast(IPC.workspacesChanged, workspaceList())
    broadcast(IPC.settingsChanged, nextSettings)
    return workspace
  })
  handle(IPC.workspacesRemove, async (id: string) => {
    await stores.workspaces.update((list) => list.filter((item) => item.id !== id))
    const nextSettings = await stores.settings.update((value) => {
      const remaining = workspaceList()
      return {
        ...value,
        lastWorkspaceId:
          value.lastWorkspaceId === id ? (remaining[0]?.id ?? '') : value.lastWorkspaceId
      }
    })
    if (host.getStatus().workspaceId === id) await host.stop()
    broadcast(IPC.workspacesChanged, workspaceList())
    broadcast(IPC.settingsChanged, nextSettings)
    return workspaceList()
  })
  handle(IPC.workspacesUpdate, async (id: string, patch: Partial<Pick<Workspace, 'name' | 'pinned' | 'color'>>) => {
    await stores.workspaces.update((list) =>
      list.map((item) => (item.id === id ? { ...item, ...patch, name: patch.name?.trim() || item.name } : item))
    )
    broadcast(IPC.workspacesChanged, workspaceList())
    return workspaceList()
  })
  handle(IPC.workspacesTouch, async (id: string) => {
    await stores.workspaces.update((list) =>
      list.map((item) => (item.id === id ? { ...item, lastOpenedAt: Date.now() } : item))
    )
    broadcast(IPC.workspacesChanged, workspaceList())
    return workspaceList()
  })
  handle(IPC.workspacesPick, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择工作区文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.quickAskRecentList, () => stores.quickAskRecent.get())
  handle(IPC.quickAskSubmit, (text: string, options?: { autoSend?: boolean; reveal?: boolean }) =>
    submitQuickAsk(text, options ?? {})
  )
  on(IPC.quickAskClose, () => hideQuickAsk())
  on(IPC.quickAskHide, () => hideQuickAsk())
  on(IPC.quickAskOpen, () => showQuickAsk())

  handle(IPC.insightsScan, (force?: boolean) =>
    scanSessions(
      {
        dshHome: resolveDshHome(settings()),
        workspaces: workspaceList(),
        insights: settings().insights
      },
      Boolean(force)
    )
  )
  handle(IPC.insightsReveal, async (id: string) => {
    const home = resolveDshHome(settings())
    const sessionDir = join(home, 'sessions')
    if (!existsSync(sessionDir)) return false
    const folders = await readdir(sessionDir).catch(() => [] as string[])
    for (const folder of folders) {
      if (!folder.includes(id)) continue
      await shell.openPath(join(sessionDir, folder))
      return true
    }
    return false
  })

  handle(IPC.promptsList, () => promptList())
  handle(IPC.promptsSave, async (input: Pick<PromptItem, 'title' | 'content' | 'tags'> & { id?: string }) => {
    const title = input.title.trim()
    const content = input.content.trim()
    if (!title || !content) throw new Error('标题和内容不能为空')
    const now = Date.now()
    if (input.id) {
      await stores.prompts.update((list) =>
        list.map((item) =>
          item.id === input.id
            ? { ...item, title, content, tags: input.tags, builtin: false, updatedAt: now }
            : item
        )
      )
    } else {
      const item: PromptItem = {
        id: `p_${randomUUID()}`,
        title,
        content,
        tags: input.tags,
        builtin: false,
        usageCount: 0,
        createdAt: now,
        updatedAt: now
      }
      await stores.prompts.update((list) => [item, ...list])
    }
    broadcast(IPC.promptsChanged, promptList())
    return promptList()
  })
  handle(IPC.promptsRemove, async (id: string) => {
    await stores.prompts.update((list) => list.filter((item) => item.id !== id))
    broadcast(IPC.promptsChanged, promptList())
    return promptList()
  })
  handle(IPC.promptsUse, async (id: string) => {
    await stores.prompts.update((list) =>
      list.map((item) => (item.id === id ? { ...item, usageCount: item.usageCount + 1 } : item))
    )
    broadcast(IPC.promptsChanged, promptList())
    return promptList()
  })

  on(IPC.runAction, (action: StudioAction) => {
    if (action.type === 'toggle-theme') {
      const nextTheme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
      void stores.settings
        .update((value) => ({ ...value, theme: nextTheme }))
        .then((value) => applySettings(value))
      return
    }
    sendAction(action)
  })
  on(IPC.paletteClose, () => hidePalette())
  on(IPC.paletteHide, () => hidePalette())
  on(IPC.paletteShow, () => showPalette())
  on(IPC.toast, (payload: { message: string; kind?: string }) => sendMain(IPC.toast, payload))

  handle(IPC.checkUpdates, () => checkForUpdates())
  handle(IPC.downloadUpdate, () => downloadUpdate())
  on(IPC.installUpdate, () => {
    quitting = true
    void host.stop().finally(() => installUpdate())
  })
  handle(IPC.openReleases, async () => {
    await shell.openExternal(GITHUB_REPO.startsWith('REPLACE_ME') ? GITHUB_URL : `${GITHUB_URL}/releases`)
  })

  handle(IPC.clipboardWrite, (text: string) => clipboard.writeText(text))
  handle(IPC.clipboardRead, () => clipboard.readText())

  handle(IPC.zoomGet, () => mainWindow?.webContents.getZoomFactor() ?? 1)
  on(IPC.zoomSet, (factor: number) => {
    const clamped = Math.min(2, Math.max(0.5, factor))
    mainWindow?.webContents.setZoomFactor(clamped)
    void stores.settings.update((value) => ({ ...value, zoomFactor: clamped }))
    sendMain(IPC.zoomChanged, clamped)
  })
}

function createShellWindows(): void {
  mainWindow = createMainWindow({
    width: settings().window.width,
    height: settings().window.height,
    x: settings().window.x,
    y: settings().window.y,
    maximized: settings().window.maximized,
    startMinimized: settings().startMinimized,
    onBounds: (bounds) => {
      void stores.settings.updateSilent((value) => ({ ...value, window: { ...value.window, ...bounds } }))
    },
    onClose: handleClose,
    onState: (state) => sendMain(IPC.windowState, state)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    sendMain(IPC.settingsChanged, settings())
  })
  configureWebviewSecurity(mainWindow)
  mainWindow.on('minimize', () => {
    if (!settings().minimizeToTray) return
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.on('before-input-event', (event, input) => handleShortcut(event, input))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file:')) return
    event.preventDefault()
    if (isHttp(url)) void shell.openExternal(url)
  })

  paletteWindow = createPaletteWindow({ onHide: () => hidePalette() })
  paletteWindow.webContents.on('did-finish-load', () => {
    sendPalette(IPC.settingsChanged, settings())
  })
  paletteWindow.on('closed', () => {
    paletteWindow = null
  })
  paletteWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      hidePalette()
    }
  })

  quickAskWindow = createQuickAskWindow({ onHide: () => hideQuickAsk() })
  quickAskWindow.webContents.on('did-finish-load', () => {
    sendQuickAsk(IPC.settingsChanged, settings())
  })
  quickAskWindow.on('closed', () => {
    quickAskWindow = null
  })
  quickAskWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      hideQuickAsk()
    }
  })
}

function createIntegrations(): void {
  const tray = createTray({
    show: showMain,
    toggle: toggleMain,
    openWorkspace: () => sendAction({ type: 'open-workspace' }),
    openSettings: () => sendAction({ type: 'open-settings' }),
    logs: () => sendAction({ type: 'open-logs' }),
    restartHost: () => sendAction({ type: 'restart-host' }),
    checkUpdates: () => sendAction({ type: 'check-updates' }),
    quit: () => void quitApp()
  })
  tray.setToolTip(PRODUCT_NAME)

  installApplicationMenu({
    openWorkspace: () => sendAction({ type: 'open-workspace' }),
    openSettings: () => sendAction({ type: 'open-settings' }),
    openLogs: () => sendAction({ type: 'open-logs' }),
    restartHost: () => sendAction({ type: 'restart-host' }),
    checkUpdates: () => sendAction({ type: 'check-updates' }),
    showAbout: () => sendAction({ type: 'show-about' }),
    toggleWindow: toggleMain,
    quit: () => void quitApp()
  })
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId('com.harness.studio')
  stores = createStores(app.getPath('userData'))
  await loadStores(stores)
  host = new HostManager()
  installer = new RuntimeInstaller()

  host.onStatus((status) => broadcast(IPC.hostStatusChanged, status))
  host.onLog((line) => sendMain(IPC.hostLogLine, line))
  autoUpdater.on('download-progress', (progress) => {
    sendMain(IPC.updateProgress, {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  registerIpc()
  createShellWindows()
  createIntegrations()
  applyTheme(settings().theme)
  applySettings(settings())

  app.on('second-instance', () => showMain())
  app.on('activate', () => showMain())

  const screenshotPath = process.env.HARNESS_STUDIO_SMOKE_SCREENSHOT
  if (screenshotPath && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        const window = mainWindow
        if (!window || window.isDestroyed()) return
        void window.webContents
          .capturePage()
          .then((image) => writeFile(screenshotPath, image.toPNG()))
          .finally(() => {
            quitting = true
            host.killNow()
            app.quit()
          })
      }, 2500)
    })
  }

  void (async () => {
    runtimeInfo = await detectRuntime(settings(), app.getPath('userData'))
    log('runtime', `detected: ${runtimeInfo.state} ${runtimeInfo.version ?? ''} ${runtimeInfo.cliPath ?? ''}`)
    if (settings().runtime.autoStart && runtimeInfo.state === 'ready') {
      const workspace = pickWorkspace()
      if (workspace) void startHost(workspace.id)
    }
  })()

  if (settings().checkUpdatesOnStart) {
    void checkForUpdates().then((result) => {
      if (result.status === 'available') {
        sendMain(IPC.toast, { message: `发现新版本 ${result.version}`, kind: 'info' })
      }
    })
  }
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  void quitApp()
})

app.on('window-all-closed', () => {
  if (quitting) return
  if (process.platform !== 'darwin') void quitApp()
})

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

process.on('uncaughtException', (error) => {
  logError('uncaught', error)
})
process.on('unhandledRejection', (reason) => {
  logError('unhandled-rejection', reason)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void bootstrap().catch((error) => {
    logError('bootstrap', error)
    dialog.showErrorBox('Harness Studio 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
