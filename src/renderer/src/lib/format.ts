import { getLocale, t } from './i18n'

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return t('core.neverOpened')
  const diff = Date.now() - timestamp
  if (diff < 60_000) return t('core.justNow')
  const formatter = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always' })
  if (diff < 3_600_000) return formatter.format(-Math.floor(diff / 60_000), 'minute')
  if (diff < 86_400_000) return formatter.format(-Math.floor(diff / 3_600_000), 'hour')
  if (diff < 7 * 86_400_000) return formatter.format(-Math.floor(diff / 86_400_000), 'day')
  return new Date(timestamp).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })
}

/** Compact token/byte style numbers: 1234 → 1.2K, 1_500_000 → 1.50M. */
export function compactTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getLocale(), { hour12: false })
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return t('core.lateNight')
  if (hour < 11) return t('core.morning')
  if (hour < 14) return t('core.noon')
  if (hour < 18) return t('core.afternoon')
  return t('core.evening')
}

export function shortPath(path: string, max = 46): string {
  if (path.length <= max) return path
  const parts = path.split(/[\\/]/)
  const tail = parts.slice(-2).join('\\')
  return `…\\${tail}`
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'H'
  return trimmed.slice(0, 1).toUpperCase()
}

export function hostStateLabel(state: string): string {
  switch (state) {
    case 'ready':
      return t('core.hostReady')
    case 'starting':
      return t('core.hostStarting')
    case 'stopping':
      return t('core.hostStopping')
    case 'error':
      return t('core.hostError')
    default:
      return t('core.hostStopped')
  }
}

export function sourceLabel(source?: string | null): string {
  switch (source) {
    case 'portable':
      return t('core.sourcePortable')
    case 'custom':
      return t('core.sourceCustom')
    case 'npm-global':
      return t('core.sourceNpm')
    case 'path':
      return t('core.sourcePath')
    case 'bundled':
      return t('core.sourceBundled')
    default:
      return t('core.sourceMissing')
  }
}
