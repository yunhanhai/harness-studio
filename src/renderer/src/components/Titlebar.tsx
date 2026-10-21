import { useEffect, useState } from 'react'
import { Copy, Minus, Search, Square, X } from 'lucide-react'
import { useApp } from '../store'
import { BrandMark } from './BrandMark'
import { hostStateLabel } from '../lib/format'

export function Titlebar(): React.JSX.Element {
  const view = useApp((state) => state.view)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)
  const setView = useApp((state) => state.setView)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.studio.app.isMaximized().then(setMaximized)
    return window.studio.settings.onWindowState((state) => setMaximized(state.maximized))
  }, [])

  const workspace = workspaces.find((item) => item.id === host.workspaceId)
  const contextLabel =
    view === 'workspace'
      ? (workspace?.name ?? '工作区')
      : view === 'home'
        ? '启动台'
        : view === 'insights'
          ? '会话洞察'
          : view === 'prompts'
            ? '提示词库'
            : view === 'logs'
              ? '运行日志'
              : '设置'

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <BrandMark size={22} />
        <span className="titlebar-name">
          Harness <em>Studio</em>
        </span>
        <span className="titlebar-beta">BETA</span>
        <span className="titlebar-divider" />
        <button className="titlebar-context" onClick={() => setView('home')} title="返回启动台">
          {contextLabel}
        </button>
      </div>

      <button className="command-pill" onClick={() => window.studio.studio.showPalette()} title="打开命令面板">
        <Search size={13} strokeWidth={2.2} />
        <span>搜索命令、工作区或提示词</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="titlebar-right">
        <button className={`host-pill host-${host.state}`} onClick={() => setView('workspace')} title="查看工作区">
          <span className="status-dot" />
          <span>{hostStateLabel(host.state)}</span>
          {host.state === 'ready' && host.port ? <span className="host-port">:{host.port}</span> : null}
        </button>
        <div className="window-controls">
          <button className="window-button" onClick={() => window.studio.app.minimize()} title="最小化">
            <Minus size={15} />
          </button>
          <button
            className="window-button"
            onClick={() => window.studio.app.toggleMaximize()}
            title={maximized ? '还原' : '最大化'}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button className="window-button window-close" onClick={() => window.studio.app.close()} title="关闭">
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}
