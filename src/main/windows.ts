import { BrowserWindow, app, nativeTheme, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

export function preloadPath(name: 'index' | 'workspace'): string {
  return join(__dirname, '../preload', `${name}.js`)
}

export function rendererFile(): string {
  return join(__dirname, '../renderer/index.html')
}

export function loadRenderer(window: BrowserWindow, hash = ''): Promise<void> {
  if (RENDERER_URL) return window.loadURL(`${RENDERER_URL}${hash}`)
  return window.loadFile(rendererFile(), hash ? { hash } : undefined)
}

export function iconPath(): string {
  return join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

function isVisibleOnSomeDisplay(bounds: Partial<Rectangle>): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return false
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x! >= area.x - 40 &&
      bounds.y! >= area.y - 40 &&
      bounds.x! + (bounds.width ?? 0) <= area.x + area.width + 40 &&
      bounds.y! + 40 <= area.y + area.height + 40
    )
  })
}

export interface MainWindowOptions {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
  startMinimized: boolean
  onBounds: (bounds: Rectangle & { maximized: boolean }) => void
  onClose: (event: Electron.Event) => void
  onState: (state: { maximized: boolean; fullscreen: boolean }) => void
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const bounds: Rectangle = {
    width: Math.max(1080, options.width || 1360),
    height: Math.max(700, options.height || 860),
    x: options.x ?? 0,
    y: options.y ?? 0
  }
  const usePosition = options.x !== undefined && options.y !== undefined && isVisibleOnSomeDisplay(bounds)

  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(usePosition ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0b10' : '#f5f6fa',
    title: 'Harness Studio',
    icon: iconPath(),
    thickFrame: true,
    roundedCorners: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  if (options.maximized) window.maximize()

  window.once('ready-to-show', () => {
    if (options.startMinimized) return
    window.show()
    window.focus()
  })

  let timer: NodeJS.Timeout | null = null
  const report = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (window.isDestroyed()) return
      const current = window.getBounds()
      options.onBounds({ ...current, maximized: window.isMaximized() })
    }, 400)
  }
  window.on('resize', report)
  window.on('move', report)
  window.on('maximize', () => options.onState({ maximized: true, fullscreen: window.isFullScreen() }))
  window.on('unmaximize', () => options.onState({ maximized: false, fullscreen: window.isFullScreen() }))
  window.on('enter-full-screen', () => options.onState({ maximized: window.isMaximized(), fullscreen: true }))
  window.on('leave-full-screen', () => options.onState({ maximized: window.isMaximized(), fullscreen: false }))
  window.on('close', options.onClose)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  void loadRenderer(window)
  return window
}

export interface PaletteWindowOptions {
  onHide: () => void
}

export function createPaletteWindow(options: PaletteWindowOptions): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 720
  const height = 480
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height * 0.18)

  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('blur', () => {
    if (!window.isDestroyed()) options.onHide()
  })
  void loadRenderer(window, '#palette')
  return window
}

export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}

export interface QuickAskWindowOptions {
  onHide: () => void
}

/** Compact always-on-top prompt box summoned by the global Quick Ask shortcut. */
export function createQuickAskWindow(options: QuickAskWindowOptions): BrowserWindow {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = 640
  const height = 210
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height * 0.22)

  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('blur', () => {
    if (!window.isDestroyed()) options.onHide()
  })
  void loadRenderer(window, '#quickask')
  return window
}
