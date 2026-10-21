import { app } from 'electron'
import { GITHUB_REPO, RELEASES_URL } from '@shared/defaults'
import type { UpdateResult } from '@shared/types'
import { logError } from './logger'

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

export async function checkForUpdates(): Promise<UpdateResult> {
  if (!app.isPackaged) {
    return { status: 'dev', message: '开发模式下不检查更新；打包后会自动连接发布源。' }
  }
  if (GITHUB_REPO.startsWith('REPLACE_ME')) {
    return { status: 'dev', message: '尚未配置发布仓库（src/shared/defaults.ts 中的 GITHUB_REPO）。' }
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `HarnessStudio/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) {
      return { status: 'error', message: `检查更新失败：HTTP ${response.status}` }
    }
    const data = (await response.json()) as { tag_name?: string; html_url?: string }
    const latest = normalize(data.tag_name ?? '')
    if (!latest) return { status: 'error', message: '发布源未返回版本号。' }
    if (compareVersions(latest, app.getVersion()) > 0) {
      return {
        status: 'available',
        version: latest,
        url: data.html_url || RELEASES_URL,
        message: `发现新版本 ${latest}`
      }
    }
    return { status: 'latest', version: latest, message: '已经是最新版本。' }
  } catch (error) {
    logError('updater', error)
    return { status: 'error', message: `检查更新失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
