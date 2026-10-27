import { useEffect } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleDot,
  Cpu,
  FolderPlus,
  Pause,
  Pin,
  Play,
  RefreshCw,
  ScrollText,
  Sparkles,
  Terminal,
  Zap
} from 'lucide-react'
import { useApp } from '../store'
import { compactTokens, greeting, hostStateLabel, relativeTime, shortPath, sourceLabel } from '../lib/format'
import { BrandMark } from '../components/BrandMark'

export function Home(): React.JSX.Element {
  const info = useApp((state) => state.info)
  const settings = useApp((state) => state.settings)
  const runtime = useApp((state) => state.runtime)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)
  const prompts = useApp((state) => state.prompts)
  const addWorkspace = useApp((state) => state.addWorkspace)
  const openWorkspace = useApp((state) => state.openWorkspace)
  const setView = useApp((state) => state.setView)
  const startHost = useApp((state) => state.startHost)
  const stopHost = useApp((state) => state.stopHost)
  const restartHost = useApp((state) => state.restartHost)
  const updateWorkspace = useApp((state) => state.updateWorkspace)
  const refreshRuntime = useApp((state) => state.refreshRuntime)
  const installRuntime = useApp((state) => state.installRuntime)
  const insights = useApp((state) => state.insights)
  const loadInsights = useApp((state) => state.loadInsights)

  useEffect(() => {
    if (!insights) void loadInsights()
  }, [insights, loadInsights])

  const current =
    workspaces.find((item) => item.id === host.workspaceId) ??
    workspaces.find((item) => item.id === settings?.lastWorkspaceId) ??
    workspaces[0]
  const sorted = [...workspaces].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt)
  const ready = host.state === 'ready'
  const starting = host.state === 'starting'
  const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
  const uptime = (startedAt?: number): string => {
    if (!startedAt) return '待命'
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    return `${Math.floor(seconds / 3600)}h`
  }

  const openPrimary = (): void => {
    if (current) void openWorkspace(current.id)
    else void addWorkspace()
  }

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            {greeting()}，{dateLabel}
          </div>
          <h1>
            让 DeepSeek Harness
            <br />
            <span className="gradient-text">成为你的工作台。</span>
          </h1>
          <p className="hero-lead">
            一个更专注的桌面外壳。多项目工作区、一键运行时、原生快捷键、完整日志与提示词库，全部围绕你的开发流。
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={openPrimary}>
              {current ? (
                <>
                  打开 {current.name}
                  <ArrowRight size={16} />
                </>
              ) : (
                <>
                  选择第一个工作区
                  <FolderPlus size={16} />
                </>
              )}
            </button>
            <button className="button button-secondary" onClick={() => void addWorkspace()}>
              <FolderPlus size={15} />
              添加项目文件夹
            </button>
          </div>
          <div className="hero-hints">
            <span>
              <kbd>Ctrl</kbd> <kbd>K</kbd> 命令面板
            </span>
            <span>
              <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>H</kbd> 唤出窗口
            </span>
          </div>
        </div>

        <div className={`runtime-card ${ready ? 'is-ready' : starting ? 'is-starting' : ''}`}>
          <div className="runtime-orb">
            <span className="orb-ring ring-one" />
            <span className="orb-ring ring-two" />
            <span className="orb-ring ring-three" />
            <div className="orb-core">
              <BrandMark size={44} />
            </div>
            <span className="orb-dot" />
          </div>
          <div className="runtime-copy">
            <div className="runtime-label">
              <CircleDot size={13} />
              Harness 运行时
            </div>
            <div className="runtime-state">{hostStateLabel(host.state)}</div>
            <div className="runtime-meta">
              <span>dsh {runtime?.version ?? '未检测'}</span>
              <span className="dot-sep" />
              <span>{host.port ? `127.0.0.1:${host.port}` : sourceLabel(runtime?.source)}</span>
            </div>
            <div className="runtime-metrics">
              <div>
                <span>Node</span>
                <strong>{runtime?.nodeVersion ?? '—'}</strong>
              </div>
              <div>
                <span>端口</span>
                <strong>{host.port ?? '—'}</strong>
              </div>
              <div>
                <span>运行</span>
                <strong>{uptime(host.startedAt)}</strong>
              </div>
            </div>
          </div>
          <div className="runtime-actions">
            {ready ? (
              <>
                <button className="button button-subtle" onClick={() => void restartHost()} title="重启运行时">
                  <RefreshCw size={14} />
                  重启
                </button>
                <button className="button button-subtle danger-hover" onClick={() => void stopHost()}>
                  <Pause size={14} />
                  停止
                </button>
              </>
            ) : (
              <button
                className="button button-primary button-small"
                disabled={starting || runtime?.state !== 'ready'}
                onClick={() => void startHost()}
              >
                <Play size={14} />
                {starting ? '启动中…' : '启动运行时'}
              </button>
            )}
            <button className="icon-button" onClick={() => setView('logs')} title="查看日志">
              <ScrollText size={15} />
            </button>
          </div>
        </div>
      </section>

      <section className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon accent-blue">
            <Zap size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{workspaces.length}</div>
            <div className="stat-label">项目工作区</div>
          </div>
          <button className="stat-action" onClick={() => void addWorkspace()} title="添加工作区">
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-violet">
            <Sparkles size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{prompts.length}</div>
            <div className="stat-label">可复用提示词</div>
          </div>
          <button className="stat-action" onClick={() => setView('prompts')} title="打开提示词库">
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-mint">
            <BarChart3 size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{insights ? compactTokens(insights.totals.totalTokens) : '—'}</div>
            <div className="stat-label">累计 Token</div>
          </div>
          <button className="stat-action" onClick={() => setView('insights')} title="打开会话洞察">
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-amber">
            <Cpu size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{info?.version ?? '0.0.0'}</div>
            <div className="stat-label">Studio 版本</div>
          </div>
          <span className="mini-chip">{info?.arch ?? ''}</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>最近的工作区</h2>
            <p>每个工作区绑定自己的目录与会话上下文，切换时复用同一个 Host。</p>
          </div>
          <button className="button button-ghost button-small" onClick={() => void addWorkspace()}>
            <FolderPlus size={14} />
            添加
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="empty-card">
            <div className="empty-art">
              <FolderPlus size={26} />
            </div>
            <div className="empty-copy">
              <h3>从一个项目文件夹开始</h3>
              <p>选择你正在开发的仓库，Studio 会为它启动独立的 Harness 会话，并记住最近打开的位置。</p>
            </div>
            <button className="button button-primary" onClick={() => void addWorkspace()}>
              选择文件夹
              <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            {sorted.map((workspace) => (
              <article key={workspace.id} className={`workspace-card ${workspace.id === current?.id ? 'is-current' : ''}`}>
                <div className="workspace-card-top">
                  <span className="workspace-color" style={{ background: workspace.color }} />
                  <div className="workspace-name" title={workspace.name}>
                    {workspace.name}
                  </div>
                  <button
                    className={`icon-button ${workspace.pinned ? 'is-pinned' : ''}`}
                    onClick={() => void updateWorkspace(workspace.id, { pinned: !workspace.pinned })}
                    title={workspace.pinned ? '取消固定' : '固定到前面'}
                  >
                    <Pin size={14} />
                  </button>
                </div>
                <div className="workspace-path" title={workspace.path}>
                  {shortPath(workspace.path, 58)}
                </div>
                <div className="workspace-card-bottom">
                  <span className="workspace-time">{relativeTime(workspace.lastOpenedAt)}</span>
                  <button className="workspace-open" onClick={() => void openWorkspace(workspace.id)}>
                    打开
                    <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="home-lower">
        <div className="panel runtime-panel">
          <div className="panel-head">
            <div>
              <h3>运行时诊断</h3>
              <p>DeepSeek Harness 的版本、来源与依赖状态。</p>
            </div>
            <button className="icon-button" onClick={() => void refreshRuntime()} title="重新检测运行时">
              <RefreshCw size={15} />
            </button>
          </div>
          <dl className="kv-list">
            <div>
              <dt>状态</dt>
              <dd>
                <span className={`state-inline state-${runtime?.state ?? 'unknown'}`}>
                  {runtime?.state === 'ready' ? '可用' : runtime?.state === 'missing' ? '未安装' : '检测中'}
                </span>
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{sourceLabel(runtime?.source)}</dd>
            </div>
            <div>
              <dt>Node.js</dt>
              <dd className="mono">{runtime?.nodeVersion ?? '—'}</dd>
            </div>
            <div>
              <dt>DSH_HOME</dt>
              <dd className="mono ellipsis" title={runtime?.dshHome ?? ''}>
                {runtime?.dshHome ?? '—'}
              </dd>
            </div>
          </dl>
          {runtime?.state !== 'ready' ? (
            <div className="panel-callout">
              <div>
                <strong>{runtime?.state === 'missing' ? '还没有可用的运行时' : '运行时需要修复'}</strong>
                <p>{runtime?.error ?? '安装便携运行时后即可离线使用。'}</p>
              </div>
              <button className="button button-primary button-small" onClick={() => void installRuntime()}>
                一键安装
              </button>
            </div>
          ) : (
            <div className="panel-foot">
              <Terminal size={13} />
              <span className="mono ellipsis" title={runtime?.cliPath ?? ''}>
                {runtime?.cliPath ?? ''}
              </span>
            </div>
          )}
        </div>

        <div className="panel shortcuts-panel">
          <div className="panel-head">
            <div>
              <h3>快捷操作</h3>
              <p>少一次鼠标移动，多一次心流。</p>
            </div>
          </div>
          <div className="shortcut-list">
            <div className="shortcut-row" onClick={() => window.studio.studio.showPalette()}>
              <span>命令面板</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('insights')}>
              <span>会话洞察</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>3</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('prompts')}>
              <span>提示词库</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>4</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('logs')}>
              <span>运行日志</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>5</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('settings')}>
              <span>设置</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>,</kbd>
              </span>
            </div>
          </div>
          <div className="panel-foot muted">
            <Sparkles size={13} />
            <span>提示：把常用的提示词固定到命令面板，输入即用。</span>
          </div>
        </div>
      </section>
    </div>
  )
}
