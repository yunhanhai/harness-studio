import { app, dialog, shell } from 'electron'
import { dirname } from 'node:path'
import { setMainLanguage, t } from './i18n'
import { logError } from './logger'
import { loadStores, StorePersistenceError, type Stores } from './store'

/** Only paths and known failure categories cross IPC, never JSON or raw parser errors. */
export function storeErrorMessage(error: StorePersistenceError): string {
  const reason = error.reason === 'parse' || error.reason === 'normalize'
    ? t('main.storeInvalid')
    : error.reason === 'not-loaded'
      ? t('main.storeNotLoaded')
      : error.code === 'ENOSPC'
        ? t('main.storeNoSpace')
        : error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS'
          ? t('main.storeAccessDenied')
          : error.code === 'EBUSY'
            ? t('main.storeBusy')
            : t('main.storeIoFailed')
  return t(error.operation === 'load' ? 'main.storeLoadFailed' : 'main.storeSaveFailed', {
    file: error.file,
    reason
  })
}

export function storeIpcError(error: unknown): unknown {
  if (!(error instanceof StorePersistenceError)) return error
  const message = storeErrorMessage(error)
  logError('store', new Error(message))
  return new Error(message)
}

/** Keep the application unopened until all user data can be read safely. */
export async function loadStoresWithRecovery(stores: Stores): Promise<boolean> {
  for (;;) {
    try {
      await loadStores(stores)
      return true
    } catch (error) {
      if (!(error instanceof StorePersistenceError)) throw error
      setMainLanguage(stores.settings.get().language, app.getLocale())
      const message = storeErrorMessage(error)
      logError('store-load', new Error(message))
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: t('main.storeRecoveryTitle'),
        message: t('main.storeRecoveryMessage'),
        detail: `${message}\n\n${t('main.storeRecoveryAdvice')}`,
        buttons: [t('main.storeRetry'), t('main.storeOpenFolder'), t('main.quitApp')],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      })
      if (response !== 0 && response !== 1) return false
      if (response === 1) {
        // Opening Explorer may fail too (for example, a disconnected drive).
        // Keep the recovery dialog available without exposing a raw shell error.
        const failure = await shell.openPath(dirname(error.file)).catch(() => 'failed')
        if (failure) dialog.showErrorBox(t('main.storeRecoveryTitle'), t('main.storeFolderFailed', { path: dirname(error.file) }))
      }
    }
  }
}
