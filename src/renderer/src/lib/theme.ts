import type { Settings } from '@shared/types'

export function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyAppearance(settings: Settings): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(settings.theme)
  root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full'
  root.style.setProperty('--accent', settings.accent)
  root.style.setProperty('--accent-strong', settings.accent)
  root.style.setProperty('--zoom', String(settings.zoomFactor))
}

export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => onChange()
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
