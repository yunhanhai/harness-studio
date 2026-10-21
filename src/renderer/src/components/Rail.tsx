import { LayoutDashboard, MessagesSquare, Moon, ScrollText, Settings2, Sparkles, Sun } from 'lucide-react'
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

const ITEMS: RailItem[] = [
  { id: 'home', label: '启动台', icon: LayoutDashboard, shortcut: 'Ctrl 1' },
  { id: 'workspace', label: '工作区', icon: MessagesSquare, shortcut: 'Ctrl 2' },
  { id: 'prompts', label: '提示词库', icon: Sparkles, shortcut: 'Ctrl 3' },
  { id: 'logs', label: '运行日志', icon: ScrollText, shortcut: 'Ctrl 4' },
  { id: 'settings', label: '设置', icon: Settings2, shortcut: 'Ctrl ,' }
]

export function Rail(): React.JSX.Element {
  const view = useApp((state) => state.view)
  const settings = useApp((state) => state.settings)
  const setView = useApp((state) => state.setView)
  const saveSettings = useApp((state) => state.saveSettings)
  const openWorkspace = useApp((state) => state.openWorkspace)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)

  const theme = settings ? resolveTheme(settings.theme) : 'dark'
  const toggleTheme = (): void => {
    void saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }

  const activate = (id: ViewId): void => {
    if (id === 'workspace') {
      const target = host.workspaceId ?? settings?.lastWorkspaceId ?? workspaces[0]?.id
      if (target) void openWorkspace(target)
      else setView('workspace')
      return
    }
    setView(id)
  }

  return (
    <nav className="rail" aria-label="主导航">
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
        <button className="rail-item" onClick={toggleTheme} data-tip={theme === 'dark' ? '切换到浅色' : '切换到深色'}>
          {theme === 'dark' ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
        </button>
        <button
          className="rail-item"
          onClick={() => void window.studio.app.openExternal(GITHUB_URL)}
          data-tip="GitHub 仓库"
        >
          <GithubMark size={19} />
        </button>
        <div className="rail-avatar" title="本地工作台">
          <span>HS</span>
        </div>
      </div>
    </nav>
  )
}
