import { Cpu, FolderOpen, Radio } from 'lucide-react'
import { useApp } from '../store'
import { hostStateLabel, shortPath } from '../lib/format'

export function StatusBar(): React.JSX.Element {
  const host = useApp((state) => state.host)
  const runtime = useApp((state) => state.runtime)
  const workspaces = useApp((state) => state.workspaces)
  const view = useApp((state) => state.view)
  const workspace = workspaces.find((item) => item.id === host.workspaceId)

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className={`statusbar-state host-${host.state}`}>
          <span className="status-dot" />
          {hostStateLabel(host.state)}
        </span>
        {host.state === 'ready' && host.port ? (
          <span className="statusbar-item">
            <Radio size={12} /> 127.0.0.1:{host.port}
          </span>
        ) : null}
        {workspace && view !== 'home' ? (
          <span className="statusbar-item statusbar-path" title={workspace.path}>
            <FolderOpen size={12} /> {shortPath(workspace.path, 52)}
          </span>
        ) : null}
      </div>
      <div className="statusbar-right">
        <span className="statusbar-item">
          <Cpu size={12} /> dsh {runtime?.version ?? '—'}
        </span>
        <span className="statusbar-item">Node {runtime?.nodeVersion ?? '—'}</span>
        <span className="statusbar-item statusbar-brand">Harness Studio</span>
      </div>
    </footer>
  )
}
