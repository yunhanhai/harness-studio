import { resolveLanguage, translate, type Locale, type MessageKey, type MessageParams } from '@shared/i18n'

let locale: Locale = 'zh-CN'

export function setMainLanguage(setting: unknown, systemLocale: string): boolean {
  const next = resolveLanguage(setting, systemLocale)
  const changed = next !== locale
  locale = next
  return changed
}

export function getMainLocale(): Locale { return locale }

/** Read the current locale for every operation, including native confirmations. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale, key, params)
}

export function sendConfirmationCopy(queued: number, preview = ''): {
  title: string; message: string; detail: string; buttons: string[]
} {
  const detail: string[] = []
  const trimmed = preview.trim()
  if (trimmed) detail.push(trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed)
  if (queued > 0) {
    detail.push('')
    detail.push(t(queued === 1 ? 'main.sendQueueDetailOne' : 'main.sendQueueDetail', { count: queued }))
  }
  return {
    title: t('main.confirmSend'),
    message: queued > 0
      ? t(queued === 1 ? 'main.sendQueuedOne' : 'main.sendQueued', { count: queued })
      : t('main.sendMessage'),
    detail: detail.join('\n'),
    buttons: [t('main.send'), t('main.cancel')]
  }
}
