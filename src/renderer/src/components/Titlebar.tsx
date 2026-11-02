import { useI18n } from '../lib/i18n'
import { useEffect, useState } from 'react'
import { Copy, Minus, Search, Square, X } from 'lucide-react'
import { useApp } from '../store'
import { BrandMark } from './BrandMark'
import { hostStateLabel, shortPath } from '../lib/format'

export function Titlebar(): React.JSX.Element {
  const { t } = useI18n()
  const view = useApp((state) => state.view)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
  const setView = useApp((state) => state.setView)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.studio.app.isMaximized().then(setMaximized)
    return window.studio.settings.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId)
  const contextLabel =
    view === 'workspace'
      ? (workspace?.name ?? (activeTab?.path ? shortPath(activeTab.path, 32) : t('shell.workspace')))
      : view === 'home'
        ? t('shell.home')
        : view === 'insights'
          ? t('shell.sessionInsights')
          : view === 'prompts'
            ? t('shell.promptLibrary')
            : view === 'logs'
              ? t('shell.runtimeLogs')
              : view === 'skills'
                ? t('skills.title')
                : t('shell.settings')

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <BrandMark size={22} />
        <span className="titlebar-name">
          Harness <em>Studio</em>
        </span>
        <span className="titlebar-beta">BETA</span>
        <span className="titlebar-divider" />
        <button className="titlebar-context" onClick={() => setView('home')} title={t('shell.backToHome')}>
          {contextLabel}
        </button>
      </div>

      <button className="command-pill" onClick={() => window.studio.studio.showPalette()} title={t('shell.openCommandPalette')}>
        <Search size={13} strokeWidth={2.2} />
        <span>{t('shell.searchCommandsWorkspacesOrPrompts82')}</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="titlebar-right">
        <button className={`host-pill host-${host.state}`} onClick={() => setView('workspace')} title={t('shell.viewWorkspace')}>
          <span className="status-dot" />
          <span>{hostStateLabel(host.state)}</span>
          {host.state === 'ready' && host.port ? <span className="host-port">:{host.port}</span> : null}
        </button>
        <div className="window-controls">
          <button className="window-button" onClick={() => window.studio.app.minimize()} title={t('shell.minimize')}>
            <Minus size={15} />
          </button>
          <button
            className="window-button"
            onClick={() => window.studio.app.toggleMaximize()}
            title={maximized ? t('shell.restore') : t('shell.maximize')}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button className="window-button window-close" onClick={() => window.studio.app.close()} title={t('shell.close')}>
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}
