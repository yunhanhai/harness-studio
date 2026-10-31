import { t } from './i18n'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { GITHUB_REPO, RELEASES_URL } from '@shared/defaults'
import type { UpdateResult } from '@shared/types'
import { log, logError } from './logger'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('error', (error) => {
  logError('updater', error)
})

let pendingVersion: string | undefined

function normalize(version: string): string {
  return version.replace(/^v/i, '').trim()
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): Array<number | string> =>
    normalize(value)
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index]
    const y = right[index]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    if (typeof x === 'number') return 1
    if (typeof y === 'number') return -1
    return String(x) > String(y) ? 1 : -1
  }
  return 0
}

async function checkViaApi(): Promise<UpdateResult> {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `HarnessStudio/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return { status: 'error', message: t('main.updateCheckHttpFailed', { status: response.status }) }
    const data = (await response.json()) as { tag_name?: string; html_url?: string }
    const latest = normalize(data.tag_name ?? '')
    if (!latest) return { status: 'error', message: t('main.releaseVersionMissing') }
    if (compareVersions(latest, app.getVersion()) > 0) {
      pendingVersion = latest
      return {
        status: 'available',
        version: latest,
        url: data.html_url || RELEASES_URL,
        canDownload: false,
        message: t('main.newVersion', { version: latest })
      }
    }
    return { status: 'latest', version: latest, message: t('main.latestVersion') }
  } catch (error) {
    logError('updater', error)
    return { status: 'error', message: t('main.updateCheckFailed', { message: error instanceof Error ? error.message : String(error) }) }
  }
}

export async function checkForUpdates(): Promise<UpdateResult> {
  if (!app.isPackaged) {
    return { status: 'dev', message: t('main.updatesDevelopment') }
  }
  if (GITHUB_REPO.startsWith('REPLACE_ME')) {
    return { status: 'dev', message: t('main.releaseNotConfigured') }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version ? normalize(result.updateInfo.version) : ''
    if (!latest) return { status: 'latest', version: app.getVersion(), message: t('main.latestVersion') }
    if (compareVersions(latest, app.getVersion()) > 0) {
      pendingVersion = latest
      log('updater', `update available: ${latest}`)
      return {
        status: 'available',
        version: latest,
        canDownload: true,
        message: t('main.newVersion', { version: latest })
      }
    }
    return { status: 'latest', version: latest, message: t('main.latestVersion') }
  } catch (error) {
    logError('updater', error)
    return checkViaApi()
  }
}

export async function downloadUpdate(): Promise<UpdateResult> {
  if (!app.isPackaged) {
    return { status: 'dev', message: t('main.downloadUpdateDevelopment') }
  }
  try {
    log('updater', `downloading update ${pendingVersion ?? ''}`)
    await autoUpdater.downloadUpdate()
    return {
      status: 'available',
      version: pendingVersion,
      downloaded: true,
      message: t('main.updateDownloaded')
    }
  } catch (error) {
    logError('updater', error)
    return {
      status: 'error',
      version: pendingVersion,
      message: t('main.updateDownloadFailed', { message: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function installUpdate(): void {
  try {
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    logError('updater', error)
  }
}
