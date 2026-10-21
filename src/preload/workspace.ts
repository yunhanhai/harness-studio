import { ipcRenderer } from 'electron'

interface ThemePayload {
  theme: 'system' | 'light' | 'dark'
  accent: string
  reduceMotion: boolean
}

function resolvedTheme(theme: ThemePayload['theme']): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

let styleElement: HTMLStyleElement | null = null

function apply(payload: ThemePayload): void {
  const theme = resolvedTheme(payload.theme)
  const root = document.documentElement
  root.style.colorScheme = theme
  root.dataset.hsTheme = theme
  root.style.setProperty('--hs-accent', payload.accent)
  root.dataset.hsMotion = payload.reduceMotion ? 'reduce' : 'full'

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.dataset.hsInjected = 'theme'
    styleElement.textContent = `
      :root { --hs-accent: ${payload.accent}; }
      ::selection { background: color-mix(in srgb, var(--hs-accent) 38%, transparent); }
      * { scrollbar-color: color-mix(in srgb, currentColor 22%, transparent) transparent; }
      *::-webkit-scrollbar { width: 10px; height: 10px; }
      *::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, currentColor 18%, transparent);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, currentColor 30%, transparent);
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-track { background: transparent; }
      html[data-hs-motion="reduce"] *, html[data-hs-motion="reduce"] *::before, html[data-hs-motion="reduce"] *::after {
        animation-duration: 0.001ms !important;
        transition-duration: 0.001ms !important;
      }
    `
    document.head.append(styleElement)
  }
}

ipcRenderer.on('guest:theme', (_event, payload: ThemePayload) => apply(payload))

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.hsSurface = 'harness'
})
