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
  const menu = Menu.buildFromTemplate([
    { label: '打开 Harness Studio', click: handlers.show },
    { type: 'separator' },
    { label: '打开工作区', click: handlers.openWorkspace },
    { label: '重启运行时', click: handlers.restartHost },
    { label: '运行日志', click: handlers.logs },
    { type: 'separator' },
    { label: '设置…', click: handlers.openSettings },
    { label: '检查更新…', click: handlers.checkUpdates },
    { label: 'GitHub 仓库', click: () => void shell.openExternal(GITHUB_URL) },
    { label: 'Gitee 仓库', click: () => void shell.openExternal(GITEE_URL) },
    { type: 'separator' },
    { label: '退出', click: handlers.quit }
  ])
  tray.setContextMenu(menu)
  tray.on('click', handlers.toggle)
  tray.on('double-click', handlers.show)
  return tray
}
