import { useI18n } from '../lib/i18n'
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  MessagesSquare,
  Moon,
  ScrollText,
  Settings2,
  Sparkles,
  Sun
} from 'lucide-react'
import { GITHUB_URL } from '@shared/defaults'
import { useApp } from '../store'
import { GithubMark } from './GithubMark'
import type { ViewId } from '@shared/types'
import { resolveTheme } from '../lib/theme'

interface RailItem {
  id: ViewId
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  shortcut?: string
}

export function Rail(): React.JSX.Element {
  const { t } = useI18n()
  const ITEMS: RailItem[] = [
    { id: 'home', label: t('shell.home'), icon: LayoutDashboard, shortcut: 'Ctrl 1' },
    { id: 'workspace', label: t('shell.workspace'), icon: MessagesSquare, shortcut: 'Ctrl 2' },
    { id: 'insights', label: t('shell.sessionInsights'), icon: BarChart3, shortcut: 'Ctrl 3' },
    { id: 'prompts', label: t('shell.promptLibrary'), icon: Sparkles, shortcut: 'Ctrl 4' },
    { id: 'logs', label: t('shell.runtimeLogs'), icon: ScrollText, shortcut: 'Ctrl 5' },
    { id: 'skills', label: t('skills.title'), icon: BookOpen, shortcut: 'Ctrl 6' },
    { id: 'settings', label: t('shell.settings'), icon: Settings2, shortcut: 'Ctrl ,' }
  ]
  const view = useApp((state) => state.view)
  const settings = useApp((state) => state.settings)
  const setView = useApp((state) => state.setView)
  const saveSettings = useApp((state) => state.saveSettings)
  const openWorkspace = useApp((state) => state.openWorkspace)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId))

  const theme = settings ? resolveTheme(settings.theme) : 'dark'
  const toggleTheme = (): void => {
    void saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }

  const activate = (id: ViewId): void => {
    if (id === 'workspace') {
      if ((host.state === 'ready' && (activeTab?.guestId !== undefined || activeTab?.path)) ||
        activeTab?.pendingWorkspaceId || activeTab?.pendingWorkspacePath) {
        setView('workspace')
        return
      }
      const target = activeTab?.workspaceId ?? settings?.lastWorkspaceId ?? workspaces[0]?.id
      if (target) void openWorkspace(target)
      else setView('workspace')
      return
    }
    setView(id)
  }

  return (
    <nav className="rail" aria-label={t('shell.mainNavigation')}>
      <div className="rail-items">
        {ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              className={`rail-item ${active ? 'active' : ''}`}
              onClick={() => activate(item.id)}
              data-tip={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={20} strokeWidth={active ? 2.3 : 1.9} />
            </button>
          )
        })}
      </div>
      <div className="rail-bottom">
        <button className="rail-item" onClick={toggleTheme} data-tip={theme === 'dark' ? t('shell.switchToLightTheme') : t('shell.switchToDarkTheme')}>
          {theme === 'dark' ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
        </button>
        <button
          className="rail-item"
          onClick={() => void window.studio.app.openExternal(GITHUB_URL)}
          data-tip={t('shell.githubRepository')}
        >
          <GithubMark size={19} />
        </button>
        <div className="rail-avatar" title={t('shell.localWorkspace')}>
          <span>HS</span>
        </div>
      </div>
    </nav>
  )
}
