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
        { label: `关于 ${PRODUCT_NAME}`, click: handlers.showAbout },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Command+,', click: handlers.openSettings },
        { label: '检查更新…', click: handlers.checkUpdates },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${PRODUCT_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { label: `退出 ${PRODUCT_NAME}`, accelerator: 'Command+Q', click: handlers.quit }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '打开工作区…', accelerator: 'Command+O', click: handlers.openWorkspace },
        { label: '运行日志', accelerator: 'Command+Shift+L', click: handlers.openLogs },
        { type: 'separator' },
        { label: '隐藏窗口', accelerator: 'Command+W', click: handlers.toggleWindow }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载界面' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '运行时',
      submenu: [{ label: '重启 Harness 运行时', click: handlers.restartHost }]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: 'GitHub 仓库', click: () => void shell.openExternal(GITHUB_URL) },
        { label: 'Gitee 仓库', click: () => void shell.openExternal(GITEE_URL) },
        { type: 'separator' },
        { label: `版本 ${app.getVersion()}`, enabled: false }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
