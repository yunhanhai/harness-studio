import { globalShortcut } from 'electron'
import type { Settings } from '@shared/types'
import { logWarn } from './logger'

export interface ShortcutHandlers {
  toggleWindow: () => void
  palette: () => void
}

export function registerGlobalShortcuts(settings: Settings, handlers: ShortcutHandlers): string[] {
  globalShortcut.unregisterAll()
  const failures: string[] = []
  const entries: Array<[string, () => void]> = [
    [settings.shortcuts.toggleWindow, handlers.toggleWindow],
    [settings.shortcuts.palette, handlers.palette]
  ]
  for (const [accelerator, handler] of entries) {
    if (!accelerator?.trim()) continue
    try {
      if (!globalShortcut.register(accelerator, handler)) failures.push(accelerator)
    } catch {
      failures.push(accelerator)
    }
  }
  if (failures.length > 0) logWarn('shortcuts', `failed to register: ${failures.join(', ')}`)
  return failures
}
