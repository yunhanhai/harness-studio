import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/channels'
import { SkillsService, type SkillsContext } from './skills'
import { t } from './i18n'

export function registerSkillsIpc(options: {
  window: () => BrowserWindow | null
  context: () => SkillsContext
  backupRoot: string
}): void {
  const service = new SkillsService(options.backupRoot)
  const handle = (channel: string, action: (context: SkillsContext, ...args: string[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (options.window()?.webContents !== event.sender) throw new Error('Skill request from an untrusted renderer')
      if (args.some(arg => typeof arg !== 'string' || arg.length > 1_048_576)) throw new Error('Invalid skill request')
      return action(options.context(), ...(args as string[]))
    })
  }
  handle(IPC.skillsList, context => service.list(context))
  handle(IPC.skillsPreview, (context, id) => service.preview(context, id))
  handle(IPC.skillsCreate, (context, sourceId, name, content) => service.create(context, sourceId, name, content))
  handle(IPC.skillsSave, (context, id, revision, content) => service.save(context, id, revision, content))
  handle(IPC.skillsRemove, (context, id, revision) => service.remove(context, id, revision))
  handle(IPC.skillsBackups, context => service.backups(context))
  handle(IPC.skillsRestore, (context, id) => service.restore(context, id))
  handle(IPC.skillsImport, async (context, sourceId) => {
    const source = (await service.list(context)).sources.find(item => item.id === sourceId && item.writable)
    if (!source) throw new Error('Choose an editable DSH source')
    const window = options.window()
    if (!window) return undefined
    const choice = await dialog.showMessageBox(window, {
      type: 'question', title: t('skills.import'), message: source.path,
      buttons: [t('skills.importFile'), t('skills.importFolder'), t('skills.cancel')], cancelId: 2, defaultId: 0
    })
    if (choice.response === 2) return undefined
    const selection = await dialog.showOpenDialog(window, {
      title: `${t('skills.import')} → ${source.path}`,
      properties: choice.response === 1 ? ['openDirectory'] : ['openFile'],
      ...(choice.response === 0 ? { filters: [{ name: 'Markdown', extensions: ['md'] }] } : {})
    })
    if (selection.canceled || !selection.filePaths[0]) return undefined
    const latest = options.context()
    if (JSON.stringify(latest) !== JSON.stringify(context)) throw new Error('Skill scope changed. Reopen the import dialog.')
    return service.import(context, sourceId, selection.filePaths[0])
  })
}
