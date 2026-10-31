import { t } from './i18n'
import { Menu, Tray, app, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { GITHUB_URL, GITEE_URL, PRODUCT_NAME } from '@shared/defaults'

export interface TrayHandlers {
  show: () => void
  toggle: () => void
  openWorkspace: () => void
  openSettings: () => void
  logs: () => void
  restartHost: () => void
  checkUpdates: () => void
  quit: () => void
}

export function createTray(handlers: TrayHandlers): Tray {
  const iconFile = join(app.getAppPath(), 'resources', 'tray.png')
  let image = nativeImage.createFromPath(iconFile)
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
  }
  if (process.platform === 'win32') image = image.resize({ width: 16, height: 16 })

  const tray = new Tray(image)
  tray.setToolTip(PRODUCT_NAME)
  updateTrayMenu(tray, handlers)
  tray.on('click', handlers.toggle)
  tray.on('double-click', handlers.show)
  return tray
}

/** Update labels in place; event handlers and the tray icon remain attached. */
export function updateTrayMenu(tray: Tray, handlers: TrayHandlers): void {
  const menu = Menu.buildFromTemplate([
    { label: t('main.openStudioMenu'), click: handlers.show },
    { type: 'separator' },
    { label: t('main.openWorkspaceTray'), click: handlers.openWorkspace },
    { label: t('main.restartRuntimeTray'), click: handlers.restartHost },
    { label: t('main.logsMenu'), click: handlers.logs },
    { type: 'separator' },
    { label: t('main.settingsMenu'), click: handlers.openSettings },
    { label: t('main.checkUpdatesMenu'), click: handlers.checkUpdates },
    { label: t('main.githubMenu'), click: () => void shell.openExternal(GITHUB_URL) },
    { label: t('main.giteeMenu'), click: () => void shell.openExternal(GITEE_URL) },
    { type: 'separator' },
    { label: t('main.quitMenu'), click: handlers.quit }
  ])
  tray.setContextMenu(menu)
}
