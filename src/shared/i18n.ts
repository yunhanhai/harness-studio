import type { LanguageSetting } from './types'
import { coreMessages } from './locales/core'
import { pageMessages } from './locales/pages'
import { shellMessages } from './locales/shell'
import { mainMessages } from './locales/main'
import { skillMessages } from './locales/skills'
import { modelMessages } from './locales/models'

export type Locale = 'zh-CN' | 'en-US'
export const messages = { ...coreMessages, ...pageMessages, ...shellMessages, ...mainMessages, ...skillMessages, ...modelMessages } as const
export type MessageKey = keyof typeof messages
export type MessageParams = Record<string, string | number>
export type Translator = (key: MessageKey, params?: MessageParams) => string

export function normalizeLanguage(value: unknown): LanguageSetting {
  return value === 'zh-CN' || value === 'en-US' ? value : 'system'
}

export function resolveLanguage(setting: unknown, systemLocale: string): Locale {
  const normalized = normalizeLanguage(setting)
  if (normalized !== 'system') return normalized
  return /^zh(?:[-_]|$)/i.test(systemLocale) ? 'zh-CN' : 'en-US'
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const entry = messages[key] as readonly [string, string]
  return entry[locale === 'zh-CN' ? 0 : 1].replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

export function createTranslator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params)
}
