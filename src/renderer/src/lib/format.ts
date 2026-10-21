export function relativeTime(timestamp?: number): string {
  if (!timestamp) return '从未打开'
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
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
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

export function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
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
      return '运行中'
    case 'starting':
      return '启动中'
    case 'stopping':
      return '正在停止'
    case 'error':
      return '需要处理'
    default:
      return '未启动'
  }
}

export function sourceLabel(source?: string | null): string {
  switch (source) {
    case 'portable':
      return '内置便携运行时'
    case 'custom':
      return '自定义路径'
    case 'npm-global':
      return 'npm 全局安装'
    case 'path':
      return 'PATH 中的 dsh'
    case 'bundled':
      return '应用内置'
    default:
      return '未检测到'
  }
}
