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
  TabCommand,
  QuickAskResult,
  Workspace
} from '@shared/types'
import { log, logError, logsDirectory } from './logger'
import { listDshProcesses, killProcesses } from './instances'
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
/**
 * Every embedded Harness webview, keyed by `webContents.id`. Each session tab is
 * its own guest against the same host; the renderer reports which one is in
 * front (`tabs:active-guest`) so Quick Ask types into the tab the user sees.
 */
const guests = new Map<number, Electron.WebContents>()
let activeGuestId: number | null = null
const guestWaiters: Array<(contents: Electron.WebContents) => void> = []

function liveGuest(id: number | null): Electron.WebContents | null {
  const contents = id === null ? undefined : guests.get(id)
  return contents && !contents.isDestroyed() ? contents : null
}

/** The guest in front, else the most recently attached live one. */
function activeGuest(): Electron.WebContents | null {
  const front = liveGuest(activeGuestId)
  if (front) return front
  // A Map iterates in insertion order, so the newest guest is last.
  return [...guests.values()].reverse().find((contents) => !contents.isDestroyed()) ?? null
}

/** Wait for the embedded Harness webview to attach (after switching to the workspace view). */
function waitForGuest(timeoutMs = 15_000): Promise<Electron.WebContents | null> {
  const ready = activeGuest()
  if (ready) return Promise.resolve(ready)
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

/** Tab commands the workspace preload may forward over `guest:shortcut`. */
const TAB_COMMANDS: Record<TabCommand, true> = {
  'new-tab': true,
  'close-tab': true,
  'next-tab': true,
  'prev-tab': true
}

function isTabCommand(value: unknown): value is TabCommand {
  return typeof value === 'string' && Object.hasOwn(TAB_COMMANDS, value)
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
  // If it has not yet, open the workspace and wait for a guest to attach.
  let guest = activeGuest()
  if (guest) {
    // The workspace view stays mounted (hidden) behind other pages, so a live
    // guest may be off screen. Bring it forward so the conversation receiving
    // the text is the one the user sees.
    sendMain(IPC.action, { type: 'navigate', view: 'workspace' } satisfies StudioAction)
  } else {
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

  // Booting the host costs ~10s in the launcher itself (measured: the cost is
  // independent of plugin count and not network-bound). Restarting it just to
  // change the default working directory would make every workspace switch pay
  // that again, so keep the process and tell it about the new workspace instead
  // when the runtime, home and profile are unchanged.
  if (current.state === 'ready' && host.canAdoptWorkspace(hostOptions)) {
    const adopted = host.adoptWorkspace(hostOptions)
    if (adopted) {
      log('host', `adopted existing host for workspace ${workspace.id}`)
      return host.getStatus()
    }
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
  const guestPayload = {
    theme: next.theme,
    accent: next.accent,
    reduceMotion: next.reduceMotion,
    confirmSend: next.composer.confirmSend,
    confirmQueued: next.composer.confirmQueued
  }
  // Every tab, including the ones behind the active one, follows the settings.
  for (const contents of guests.values()) {
    if (!contents.isDestroyed()) contents.send(IPC.guestTheme, guestPayload)
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
    // One guest per session tab. The renderer reports which one is in front;
    // until it does, a new guest takes Quick Ask only if no live guest has it.
    const id = contents.id
    guests.set(id, contents)
    if (!liveGuest(activeGuestId)) activeGuestId = id
    for (const resolve of guestWaiters.splice(0)) resolve(contents)
    contents.once('destroyed', () => {
      guests.delete(id)
      if (activeGuestId === id) activeGuestId = activeGuest()?.id ?? null
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
    contents.on('ipc-message', (_ipcEvent, channel, payload) => {
      if (channel === IPC.guestShortcut) {
        // A tab key pressed inside the embedded UI. The workspace preload decides
        // which keys are ours (it can see whether the terminal has focus); the
        // renderer owns the tab list, so hand the command over as an action.
        const action = (payload as { action?: unknown } | undefined)?.action
        if (isTabCommand(action)) sendMain(IPC.action, { type: action } satisfies StudioAction)
        return
      }
      if (channel !== IPC.guestNotice) return
      const notice = payload as { text?: unknown; code?: unknown } | undefined
      const text = typeof notice?.text === 'string' ? notice.text.trim() : ''
      if (!text) return
      const code = typeof notice?.code === 'string' ? notice.code : undefined
      // Harness only uses this channel for transient failure toasts; surface the
      // text where it can be selected, copied, and closed.
      sendMain(IPC.toast, {
        message: text,
        kind: 'error',
        sticky: true,
        code,
        action: code === 'session/writer-held' || code === 'profile/locked' ? 'kill-other-dsh' : undefined
      })
    })
    contents.on('dom-ready', () => {
      const current = settings()
      contents.send(IPC.guestTheme, {
        theme: current.theme,
        accent: current.accent,
        reduceMotion: current.reduceMotion,
        confirmSend: current.composer.confirmSend,
        confirmQueued: current.composer.confirmQueued
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

/**
 * Ask the user before a composer send goes out.
 *
 * The embedded UI submits immediately, so this is the only place a stray Enter —
 * or queued messages riding along with an unrelated send — can still be stopped.
 * A native modal is used rather than an in-page prompt because the caller is a
 * capture-phase event handler that must answer synchronously.
 */
function confirmSend(request: { kind?: string; preview?: string; queued?: number }): boolean {
  const composer = settings().composer
  const queued = Number(request.queued) || 0
  const isQueuedSend = request.kind === 'queued'

  // `confirmQueued` guards the narrower case: this send will also flush the queue.
  if (isQueuedSend) {
    if (!composer.confirmQueued) return true
  } else if (!composer.confirmSend) {
    return true
  }

  const preview = (request.preview ?? '').trim()
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined

  const detailLines: string[] = []
  if (preview) detailLines.push(preview.length > 160 ? `${preview.slice(0, 160)}…` : preview)
  if (queued > 0) {
    detailLines.push('')
    detailLines.push(
      `注意：队列里还有 ${queued} 条消息，本次发送会连同它们一起提交。` +
        '如果不想一起发出，先取消，在队列面板里删除或插话发送。'
    )
  }

  const options: Electron.MessageBoxSyncOptions = {
    type: queued > 0 ? 'warning' : 'question',
    title: '确认发送',
    message: queued > 0 ? `发送这条消息，并连同 ${queued} 条排队消息？` : '发送这条消息？',
    detail: detailLines.join('\n'),
    buttons: ['发送', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }

  const choice = window
    ? dialog.showMessageBoxSync(window, options)
    : dialog.showMessageBoxSync(options)
  return choice === 0
}

function registerIpc(): void {  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
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
  /**
   * Synchronous ask-and-answer used by the composer guard. The webview has to
   * decide inside a capture-phase keydown/click handler, where a promise cannot
   * hold the event back, so the reply must arrive before the handler returns.
   */
  ipcMain.on(IPC.guestConfirmSend, (event, payload: unknown) => {
    const request = payload as { kind?: string; preview?: string; queued?: number } | undefined
    // A settings query has to stay answerable even before a window exists.
    if (request?.kind === 'settings') {
      const current = settings().composer
      event.returnValue = { confirmSend: current.confirmSend, confirmQueued: current.confirmQueued }
      return
    }
    if (mainWindow?.webContents !== event.sender && guests.get(event.sender.id) !== event.sender) {
      event.returnValue = true
      return
    }
    event.returnValue = confirmSend(request ?? {})
  })
  /**
   * The renderer reports which tab is in front so Quick Ask types into the
   * conversation the user is looking at. Only the main window may say so, and
   * only about a guest it attached; anything else is dropped without an error.
   */
  ipcMain.on(IPC.tabsActiveGuest, (event, id: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) return
    if (id === null || (typeof id === 'number' && guests.has(id))) activeGuestId = id
  })

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
  handle(IPC.hostInstances, () => listDshProcesses(host.getStatus().pid ? [host.getStatus().pid!] : []))
  handle(IPC.hostKillInstances, async (pids: number[]) => {
    const report = await listDshProcesses(host.getStatus().pid ? [host.getStatus().pid!] : [])
    const requested = new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))
    const targets = report.processes.filter((item) => requested.has(item.pid))
    if (targets.length === 0) {
      return { cancelled: false, killed: [], failed: [], report }
    }
    const selfHost = targets.find((item) => item.self)
    if (selfHost) {
      sendMain(IPC.toast, { message: '不能在这里结束 Studio 自己的运行时，请使用「重启运行时」。', kind: 'error' })
      return { cancelled: true, killed: [], failed: [], report }
    }
    const detail = targets
      .map((item) => `· PID ${item.pid}（profile: ${item.profile}，${item.mode === 'web' ? 'web' : item.mode === 'cli' ? '命令行' : '其他'}）`)
      .join('\n')
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: '结束其他 DSH 进程',
      message: `将强制结束 ${targets.length} 个 DeepSeek Harness 进程。`,
      detail: `${detail}\n\n这些进程里正在运行的会话会被中断。若只是想避免「会话已被占用」，结束后回到会话界面重试即可。`,
      buttons: ['结束这些进程', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (choice !== 0) return { cancelled: true, killed: [], failed: [], report }

    const { killed, failed } = await killProcesses(targets.map((item) => item.pid))
    log('instances', `killed ${killed.join(',') || '-'} failed ${failed.join(',') || '-'}`)
    if (killed.length > 0) {
      sendMain(IPC.toast, {
        message: `已结束 ${killed.length} 个 DSH 进程，回到会话界面重试即可。`,
        kind: 'success'
      })
    }
    if (failed.length > 0) {
      sendMain(IPC.toast, {
        message: `${failed.length} 个进程无法结束（可能权限不足或已退出）。`,
        kind: 'error'
      })
    }
    return { cancelled: false, killed, failed, report: await listDshProcesses(host.getStatus().pid ? [host.getStatus().pid!] : []) }
  })

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

  // Booting the host is the slowest part of a cold start (~10s, dominated by the
  // launcher itself). Start the runtime probe as soon as the shell exists — in
  // parallel with the renderer loading and with update checks — so the wait
  // overlaps the window coming up instead of following it.
  const warmup = (async () => {
    runtimeInfo = await detectRuntime(settings(), app.getPath('userData'))
    log('runtime', `detected: ${runtimeInfo.state} ${runtimeInfo.version ?? ''} ${runtimeInfo.cliPath ?? ''}`)
    if (settings().runtime.autoStart && runtimeInfo.state === 'ready') {
      const workspace = pickWorkspace()
      if (workspace) await startHost(workspace.id)
    }
    return runtimeInfo
  })()

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
    // The runtime probe and autostart already run as `warmup`; just wait for it
    // rather than detecting a second time.
    await warmup

    // `--open-workspace` jumps straight into the chat view, which is what the
    // desktop shortcut and shell aliases use for everyday use.
    if (process.argv.includes('--open-workspace') && pickWorkspace()) {
      const openWhenReady = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const snapshot = host.getStatus()
        if (snapshot.state === 'ready') {
          clearInterval(openWhenReady)
          sendAction({ type: 'open-workspace' })
        }
      }, 350)
      setTimeout(() => clearInterval(openWhenReady), 90_000)
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
