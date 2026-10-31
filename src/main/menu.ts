import { t } from './i18n'
import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron'
import { GITHUB_URL, GITEE_URL, PRODUCT_NAME } from '@shared/defaults'

export interface MenuHandlers {
  openWorkspace: () => void
  openSettings: () => void
  openLogs: () => void
  restartHost: () => void
  checkUpdates: () => void
  showAbout: () => void
  toggleWindow: () => void
  quit: () => void
}

export function installApplicationMenu(handlers: MenuHandlers): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: PRODUCT_NAME,
      submenu: [
        { label: t('main.aboutProductMenu', { product: PRODUCT_NAME }), click: handlers.showAbout },
        { type: 'separator' },
        { label: t('main.settingsMenu'), accelerator: 'Command+,', click: handlers.openSettings },
        { label: t('main.checkUpdatesMenu'), click: handlers.checkUpdates },
        { type: 'separator' },
        { role: 'hide', label: t('main.hideProductMenu', { product: PRODUCT_NAME }) },
        { role: 'hideOthers', label: t('main.hideOthersMenu') },
        { role: 'unhide', label: t('main.showAllMenu') },
        { type: 'separator' },
        { label: t('main.quitProductMenu', { product: PRODUCT_NAME }), accelerator: 'Command+Q', click: handlers.quit }
      ]
    },
    {
      label: t('main.fileMenu'),
      submenu: [
        { label: t('main.openWorkspaceMenu'), accelerator: 'Command+O', click: handlers.openWorkspace },
        { label: t('main.logsMenu'), accelerator: 'Command+Shift+L', click: handlers.openLogs },
        { type: 'separator' },
        { label: t('main.hideWindowMenu'), accelerator: 'Command+W', click: handlers.toggleWindow }
      ]
    },
    {
      label: t('main.editMenu'),
      submenu: [
        { role: 'undo', label: t('main.undoMenu') },
        { role: 'redo', label: t('main.redoMenu') },
        { type: 'separator' },
        { role: 'cut', label: t('main.cutMenu') },
        { role: 'copy', label: t('main.copyMenu') },
        { role: 'paste', label: t('main.pasteMenu') },
        { role: 'selectAll', label: t('main.selectAllMenu') }
      ]
    },
    {
      label: t('main.viewMenu'),
      submenu: [
        { role: 'reload', label: t('main.reloadMenu') },
        { role: 'toggleDevTools', label: t('main.devToolsMenu') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('main.actualSizeMenu') },
        { role: 'zoomIn', label: t('main.zoomInMenu') },
        { role: 'zoomOut', label: t('main.zoomOutMenu') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('main.fullscreenMenu') }
      ]
    },
    {
      label: t('main.runtimeMenu'),
      submenu: [{ label: t('main.restartHarnessMenu'), click: handlers.restartHost }]
    },
    {
      label: t('main.windowMenu'),
      submenu: [
        { role: 'minimize', label: t('main.minimizeMenu') },
        { role: 'zoom', label: t('main.zoomMenu') },
        { role: 'front', label: t('main.frontMenu') }
      ]
    },
    {
      label: t('main.helpMenu'),
      submenu: [
        { label: t('main.githubMenu'), click: () => void shell.openExternal(GITHUB_URL) },
        { label: t('main.giteeMenu'), click: () => void shell.openExternal(GITEE_URL) },
        { type: 'separator' },
        { label: t('main.versionMenu', { version: app.getVersion() }), enabled: false }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
