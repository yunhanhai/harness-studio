import { useMemo, useSyncExternalStore } from 'react'
import { createTranslator, resolveLanguage, translate, type Locale, type MessageKey, type MessageParams, type Translator } from '@shared/i18n'
import type { LanguageSetting } from '@shared/types'

let locale = resolveLanguage('system', navigator.language)
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getLocale(): Locale { return locale }

export function applyLanguage(setting: LanguageSetting, systemLocale = navigator.language): void {
  const next = resolveLanguage(setting, systemLocale)
  document.documentElement.lang = next
  if (next === locale) return
  locale = next
  for (const listener of listeners) listener()
}

/** For store actions and formatting helpers; components subscribe with useI18n. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(locale, key, params)
}

export function useI18n(): { locale: Locale; t: Translator } {
  const current = useSyncExternalStore(subscribe, getLocale, getLocale)
  const translator = useMemo(() => createTranslator(current), [current])
  return { locale: current, t: translator }
}
