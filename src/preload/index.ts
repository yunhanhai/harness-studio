import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/channels'
import type { StudioApi } from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StudioApi = {
  app: {
    info: () => invoke(IPC.appInfo),
    minimize: () => ipcRenderer.send(IPC.appMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.appToggleMaximize),
    close: () => ipcRenderer.send(IPC.appClose),
    isMaximized: () => invoke(IPC.appIsMaximized),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    openPath: (path) => invoke(IPC.appOpenPath, path),
    showItemInFolder: (path) => ipcRenderer.send(IPC.appShowItem, path),
    setBadge: (count) => ipcRenderer.send(IPC.appSetBadge, count)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    save: (patch) => invoke(IPC.settingsSave, patch),
    reset: () => invoke(IPC.settingsReset),
    onChange: (cb) => subscribe(IPC.settingsChanged, cb),
    onWindowState: (cb) => subscribe(IPC.windowState, cb)
  },
  runtime: {
    detect: (force) => invoke(IPC.runtimeDetect, force),
    install: () => invoke(IPC.runtimeInstall),
    cancelInstall: () => invoke(IPC.runtimeCancelInstall),
    onInstallProgress: (cb) => subscribe(IPC.runtimeInstallProgress, cb)
  },
  host: {
    start: (workspaceId) => invoke(IPC.hostStart, workspaceId),
    stop: () => invoke(IPC.hostStop),
    restart: (workspaceId) => invoke(IPC.hostRestart, workspaceId),
    status: () => invoke(IPC.hostStatus),
    logs: () => invoke(IPC.hostLogs),
    clearLogs: () => invoke(IPC.hostClearLogs),
    onStatus: (cb) => subscribe(IPC.hostStatusChanged, cb),
    onLog: (cb) => subscribe(IPC.hostLogLine, cb),
    openLogsFolder: () => invoke(IPC.hostOpenLogsFolder)
  },
  workspaces: {
    list: () => invoke(IPC.workspacesList),
    add: (path) => invoke(IPC.workspacesAdd, path),
    remove: (id) => invoke(IPC.workspacesRemove, id),
    update: (id, patch) => invoke(IPC.workspacesUpdate, id, patch),
    touch: (id) => invoke(IPC.workspacesTouch, id),
    pickFolder: () => invoke(IPC.workspacesPick),
    onChange: (cb) => subscribe(IPC.workspacesChanged, cb)
  },
  prompts: {
    list: () => invoke(IPC.promptsList),
    save: (input) => invoke(IPC.promptsSave, input),
    remove: (id) => invoke(IPC.promptsRemove, id),
    use: (id) => invoke(IPC.promptsUse, id),
    onChange: (cb) => subscribe(IPC.promptsChanged, cb)
  },
  insights: {
    scan: (force) => invoke(IPC.insightsScan, force),
    revealSession: (id) => invoke(IPC.insightsReveal, id)
  },
  quickAsk: {
    submit: (text, options) => invoke(IPC.quickAskSubmit, text, options),
    recent: () => invoke(IPC.quickAskRecentList),
    close: () => ipcRenderer.send(IPC.quickAskClose),
    hide: () => ipcRenderer.send(IPC.quickAskHide),
    open: () => ipcRenderer.send(IPC.quickAskOpen),
    onOpen: (cb) => subscribe(IPC.quickAskOpened, cb),
    onResult: (cb) => subscribe(IPC.quickAskResult, cb)
  },
  studio: {
    onAction: (cb) => subscribe(IPC.action, cb),
    onToast: (cb) => subscribe(IPC.toast, cb),
    runAction: (action) => ipcRenderer.send(IPC.runAction, action),
    closePalette: () => ipcRenderer.send(IPC.paletteClose),
    hidePalette: () => ipcRenderer.send(IPC.paletteHide),
    showPalette: () => ipcRenderer.send(IPC.paletteShow),
    toast: (message, kind = 'info') => ipcRenderer.send(IPC.toast, { message, kind }),
    checkUpdates: () => invoke(IPC.checkUpdates),
    downloadUpdate: () => invoke(IPC.downloadUpdate),
    installUpdate: () => ipcRenderer.send(IPC.installUpdate),
    onUpdateProgress: (cb) => subscribe(IPC.updateProgress, cb),
    openReleases: () => invoke(IPC.openReleases),
    quit: () => ipcRenderer.send(IPC.appQuit),
    relaunch: () => ipcRenderer.send(IPC.appRelaunch)
  },
  clipboard: {
    write: (text) => invoke(IPC.clipboardWrite, text),
    read: () => invoke(IPC.clipboardRead)
  },
  zoom: {
    get: () => invoke(IPC.zoomGet),
    set: (factor) => ipcRenderer.send(IPC.zoomSet, factor),
    onChange: (cb) => subscribe(IPC.zoomChanged, cb)
  }
}

contextBridge.exposeInMainWorld('studio', api)
