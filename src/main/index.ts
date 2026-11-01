import { t, setMainLanguage, sendConfirmationCopy } from './i18n'
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
import { basename, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ACCENTS, DEFAULT_SETTINGS, GITHUB_REPO, GITHUB_URL, GITEE_URL, PRODUCT_NAME } from '@shared/defaults'
import { IPC } from '@shared/channels'
import type {
  AppInfo,
  HostStatus,
  InstallProgress,
  LogLine,
  OpenPluginPanelResult,
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
import { WorkspaceNavigator } from './workspace-navigation'
import { openPluginPanel } from './plugin-navigation'
import { SessionTabFocus } from './session-tab-focus'
import { registerGlobalShortcuts } from './shortcuts'
import { installApplicationMenu } from './menu'
import { createTray, updateTrayMenu } from './tray'
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
let workspaceNavigator: WorkspaceNavigator
let installer: RuntimeInstaller
let runtimeInfo: RuntimeInfo | null = null
let quitting = false
let closeNoticeShown = false
let refreshIntegrationLanguage: (() => void) | null = null
/**
 * Every embedded Harness webview, keyed by `webContents.id`. Each session tab is
 * its own guest against the same host; the renderer reports which one is in
 * front (`tabs:active-guest`) so Quick Ask types into the tab the user sees.
 */
const guests = new Map<number, Electron.WebContents>()
const workspaceOpenRequests = new Map<number, number>()
const pluginOpenRequests = new Map<number, { requestId: string; controller: AbortController }>()
let activeGuestId: number | null = null
const guestWaiters: Array<(contents: Electron.WebContents) => void> = []

function liveGuest(id: number | null): Electron.WebContents | null {
  const contents = id === null ? undefined : guests.get(id)
  return contents && !contents.isDestroyed() ? contents : null
}

/** Only the guest the renderer explicitly reported as being in front. */
function activeGuest(): Electron.WebContents | null {
  return liveGuest(activeGuestId)
}

const sessionTabFocus = new SessionTabFocus(() => mainWindow, activeGuest)

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
    sendMain(IPC.toast, { message: t('main.quickAskUnavailable'), kind: 'error' })
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

  if (!workspaceList().length && guests.size === 0) {
    return { status: 'no-workspace', message: t('main.noWorkspace') }
  }

  const status = host.getStatus()
  if (status.state !== 'ready') {
    return { status: 'needs-host', message: t('main.openWorkspaceFirst') }
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
    if (guests.size > 0) sendMain(IPC.action, { type: 'navigate', view: 'workspace' } satisfies StudioAction)
    else sendAction({ type: 'open-workspace' })
    hideQuickAsk()
    guest = await waitForGuest()
    if (!guest) return { status: 'needs-host', message: t('main.guestLoading') }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  if (workspaceNavigator.isBusy(guest)) {
    return { status: 'needs-host', message: t('main.workspaceSwitching') }
  }
  const targetId = guest.id
  const authorization = workspaceNavigator.authorizeInput(guest, () => activeGuest()?.id === targetId)
  const result = await injectIntoComposer(guest, text, { autoSend, isCurrent: authorization.valid, authorizationKey: authorization.key })
    .finally(authorization.release)

  if (result.status === 'sent' || result.status === 'inserted') {
    const limit = Math.max(1, Math.min(20, current.quickAsk.recentLimit))
    const trimmed = text.trim()
    await stores.quickAskRecent
      .update((current) => [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, limit))
      .catch(() => undefined)
    if (reveal) showMain()
    hideQuickAsk()
    sendMain(IPC.toast, {
      message: result.status === 'sent' ? t('main.sentToHarness') : (result.message ?? t('main.inserted')),
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
    systemLocale: app.getLocale(),
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
    const status: HostStatus = { state: 'error', error: t('main.chooseProjectFirst') }
    sendMain(IPC.hostStatusChanged, status)
    return status
  }
  const info = await ensureRuntime()
  if (info.state !== 'ready') {
    const status: HostStatus = { state: 'error', error: info.error ?? t('main.runtimeNotReady') }
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
  if (setMainLanguage(next.language, app.getLocale())) refreshIntegrationLanguage?.()
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
    conversationFontSize: next.conversationFontSize,
    confirmSend: next.composer.confirmSend,
    confirmQueued: next.composer.confirmQueued
  }
  // Every tab, including the ones behind the active one, follows the settings.
  for (const contents of guests.values()) {
    if (!contents.isDestroyed()) contents.send(IPC.guestTheme, guestPayload)
  }
  if (failures.length > 0) {
    sendMain(IPC.toast, { message: t('main.shortcutsOccupied', { shortcuts: failures.join(', ') }), kind: 'error' })
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
      title: t('main.stillRunning'),
      message: t('main.hideOrQuit'),
      detail: t('main.hideDetail'),
      buttons: [t('main.hideToTray'), t('main.quitApp')],
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
    // One guest per session tab. The renderer reports which one is in front.
    const id = contents.id
    guests.set(id, contents)
    workspaceNavigator.track(contents)
    contents.once('destroyed', () => {
      pluginOpenRequests.get(id)?.controller.abort()
      pluginOpenRequests.delete(id)
      guests.delete(id)
      sessionTabFocus.forget(id)
      workspaceOpenRequests.delete(id)
      if (activeGuestId === id) activeGuestId = null
    })
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) pluginOpenRequests.get(id)?.controller.abort()
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
      if (channel === IPC.guestSession) {
        if (typeof payload === 'string' && payload.length > 0 && payload.length < 256) {
          void workspaceNavigator.observe(contents, payload)
        }
        return
      }
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
        conversationFontSize: current.conversationFontSize,
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

  // `confirmSend` covers every send. `confirmQueued` can enable confirmation
  // only for sends that also flush the queue.
  if (isQueuedSend) {
    if (!composer.confirmQueued && !composer.confirmSend) return true
  } else if (!composer.confirmSend) {
    return true
  }

  const preview = (request.preview ?? '').trim()
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined

  const options: Electron.MessageBoxSyncOptions = {
    type: queued > 0 ? 'warning' : 'question',
    ...sendConfirmationCopy(queued, preview),
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
  ipcMain.on(IPC.tabsActiveGuest, (event, id: unknown, options: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents !== event.sender) return
    if (id === null || (typeof id === 'number' && guests.has(id))) {
      if (activeGuestId !== id) {
        for (const [guestId, request] of pluginOpenRequests) {
          if (guestId !== id) request.controller.abort()
        }
      }
      activeGuestId = id
      sessionTabFocus.update(options)
      const front = activeGuest()
      if (front) for (const resolve of guestWaiters.splice(0)) resolve(front)
    }
  })
  ipcMain.handle(IPC.tabsOpenWorkspace, async (event, workspaceId: unknown, guestId: unknown, path: unknown) => {
    if (!mainWindow || mainWindow.webContents !== event.sender) throw new Error('IPC request from an untrusted renderer')
    const guest = typeof guestId === 'number' ? liveGuest(guestId) : null
    if (!guest) return { status: 'cancelled' }
    pluginOpenRequests.get(guest.id)?.controller.abort()
    const startingStatus = host.getStatus()
    const request = (workspaceOpenRequests.get(guest.id) ?? 0) + 1
    workspaceOpenRequests.set(guest.id, request)
    let workspace = typeof workspaceId === 'string' ? workspaceList().find((item) => item.id === workspaceId) : undefined
    if (!workspace && workspaceId === '' && typeof path === 'string' && isAbsolute(path)) {
      const directory = resolve(path)
      try { await readdir(directory) } catch { return { status: 'failed', message: t('main.directoryUnavailable') } }
      workspace = { id: '', name: basename(directory), path: directory, pinned: false, color: ACCENTS[0], createdAt: 0, lastOpenedAt: 0 }
    }
    if (!workspace) return { status: 'failed', message: t('main.workspaceMissing') }
    if (guest.isDestroyed() || workspaceOpenRequests.get(guest.id) !== request) return { status: 'cancelled' }
    const currentStatus = host.getStatus()
    if (currentStatus.state !== 'ready' || currentStatus.url !== startingStatus.url || currentStatus.pid !== startingStatus.pid || currentStatus.startedAt !== startingStatus.startedAt) {
      return { status: 'cancelled' }
    }
    const result = await workspaceNavigator.open(guest, workspace)
    if (result.status === 'opened' && result.workspaceId) {
      const next = await stores.settings.update((value) => ({ ...value, lastWorkspaceId: result.workspaceId! }))
      await stores.workspaces.update((list) => list.map((item) => item.id === result.workspaceId ? { ...item, lastOpenedAt: Date.now() } : item))
      broadcast(IPC.settingsChanged, next)
      broadcast(IPC.workspacesChanged, workspaceList())
    }
    return result
  })
  ipcMain.on(IPC.tabsCancelWorkspace, (event, guestId: unknown) => {
    if (!mainWindow || mainWindow.webContents !== event.sender) return
    const guest = typeof guestId === 'number' ? liveGuest(guestId) : null
    if (!guest) return
    workspaceOpenRequests.set(guest.id, (workspaceOpenRequests.get(guest.id) ?? 0) + 1)
    workspaceNavigator.cancel(guest)
  })
  ipcMain.handle(IPC.tabsOpenPlugins, async (event, guestId: unknown, requestId: unknown): Promise<OpenPluginPanelResult> => {
    if (!mainWindow || mainWindow.webContents !== event.sender) throw new Error('IPC request from an untrusted renderer')
    const guest = typeof guestId === 'number' ? liveGuest(guestId) : null
    if (!guest || activeGuest() !== guest || typeof requestId !== 'string' || !requestId || requestId.length > 128) {
      return { status: 'cancelled' }
    }
    if (host.getStatus().state !== 'ready') return { status: 'failed', message: t('main.pluginsNotReady') }
    pluginOpenRequests.get(guest.id)?.controller.abort()
    const request = { requestId, controller: new AbortController() }
    pluginOpenRequests.set(guest.id, request)
    const authorization = workspaceNavigator.authorizeInput(guest, () =>
      pluginOpenRequests.get(guest.id) === request && !request.controller.signal.aborted && activeGuest() === guest
    )
    try {
      return await openPluginPanel(guest, authorization, { signal: request.controller.signal })
    } finally {
      if (pluginOpenRequests.get(guest.id) === request) pluginOpenRequests.delete(guest.id)
    }
  })
  ipcMain.on(IPC.tabsCancelPlugins, (event, guestId: unknown, requestId: unknown) => {
    if (!mainWindow || mainWindow.webContents !== event.sender || typeof guestId !== 'number' || typeof requestId !== 'string') return
    const request = pluginOpenRequests.get(guestId)
    if (request?.requestId === requestId) request.controller.abort()
  })
  ipcMain.on(IPC.guestWorkspaceCheck, (event, key: unknown) => {
    event.returnValue = guests.get(event.sender.id) === event.sender && typeof key === 'string'
      && workspaceNavigator.authorize(event.sender, key)
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
      sendMain(IPC.toast, { message: t('main.cannotKillOwnHost'), kind: 'error' })
      return { cancelled: true, killed: [], failed: [], report }
    }
    const detail = targets
      .map((item) => t('main.processLine', { pid: item.pid, profile: item.profile, mode: item.mode === 'web' ? 'web' : item.mode === 'cli' ? t('main.cliMode') : t('main.otherMode') }))
      .join('\n')
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: t('main.stopOtherProcesses'),
      message: t('main.forceStopProcesses', { count: targets.length }),
      detail: t('main.forceStopDetail', { processes: detail }),
      buttons: [t('main.stopTheseProcesses'), t('main.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (choice !== 0) return { cancelled: true, killed: [], failed: [], report }

    const { killed, failed } = await killProcesses(targets.map((item) => item.pid))
    log('instances', `killed ${killed.join(',') || '-'} failed ${failed.join(',') || '-'}`)
    if (killed.length > 0) {
      sendMain(IPC.toast, {
        message: t('main.processesStopped', { count: killed.length }),
        kind: 'success'
      })
    }
    if (failed.length > 0) {
      sendMain(IPC.toast, {
        message: t('main.processesNotStopped', { count: failed.length }),
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
        title: t('main.chooseWorkspaceFolder'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      path = result.filePaths[0]
    }
    const normalized = resolve(path)
    if (!existsSync(normalized)) throw new Error(t('main.folderMissing'))
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
      title: t('main.chooseWorkspaceFolder'),
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
    if (!title || !content) throw new Error(t('main.promptRequired'))
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
  mainWindow.on('focus', () => sessionTabFocus.restore())
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
  const trayHandlers = {
    show: showMain,
    toggle: toggleMain,
    openWorkspace: () => sendAction({ type: 'open-workspace' }),
    openSettings: () => sendAction({ type: 'open-settings' }),
    logs: () => sendAction({ type: 'open-logs' }),
    restartHost: () => sendAction({ type: 'restart-host' }),
    checkUpdates: () => sendAction({ type: 'check-updates' }),
    quit: () => void quitApp()
  }
  const tray = createTray(trayHandlers)
  tray.setToolTip(PRODUCT_NAME)

  const menuHandlers = {
    openWorkspace: () => sendAction({ type: 'open-workspace' }),
    openSettings: () => sendAction({ type: 'open-settings' }),
    openLogs: () => sendAction({ type: 'open-logs' }),
    restartHost: () => sendAction({ type: 'restart-host' }),
    checkUpdates: () => sendAction({ type: 'check-updates' }),
    showAbout: () => sendAction({ type: 'show-about' }),
    toggleWindow: toggleMain,
    quit: () => void quitApp()
  }
  refreshIntegrationLanguage = () => {
    updateTrayMenu(tray, trayHandlers)
    installApplicationMenu(menuHandlers)
  }
  installApplicationMenu(menuHandlers)
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId('com.harness.studio')
  stores = createStores(app.getPath('userData'))
  await loadStores(stores)
  setMainLanguage(settings().language, app.getLocale())
  host = new HostManager()
  workspaceNavigator = new WorkspaceNavigator(workspaceList, (contents) => {
    const status = host.getStatus()
    if (status.state !== 'ready' || !status.url || contents.isDestroyed()) return false
    try { return new URL(contents.getURL()).origin === new URL(status.url).origin } catch { return false }
  }, (state) => sendMain(IPC.tabsWorkspaceChanged, state))
  installer = new RuntimeInstaller()

  host.onStatus((status) => {
    if (status.state !== 'ready') {
      workspaceNavigator.cancelAll(guests.values())
      for (const request of pluginOpenRequests.values()) request.controller.abort()
    }
    broadcast(IPC.hostStatusChanged, status)
  })
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
        sendMain(IPC.toast, { message: t('main.newVersion', { version: result.version ?? t('main.unknownVersion') }), kind: 'info' })
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
    dialog.showErrorBox(t('main.startupFailed'), error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
