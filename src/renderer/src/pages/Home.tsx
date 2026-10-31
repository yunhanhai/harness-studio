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
import { useI18n } from '../lib/i18n'
import { compactTokens, greeting, hostStateLabel, relativeTime, shortPath, sourceLabel } from '../lib/format'
import { BrandMark } from '../components/BrandMark'

export function Home(): React.JSX.Element {
  const { locale, t } = useI18n()
  const info = useApp((state) => state.info)
  const settings = useApp((state) => state.settings)
  const runtime = useApp((state) => state.runtime)
  const host = useApp((state) => state.host)
  const workspaces = useApp((state) => state.workspaces)
  const activeTab = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId))
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

  const activeWorkspace = workspaces.find((item) => item.id === activeTab?.workspaceId)
  const current =
    activeWorkspace ??
    workspaces.find((item) => item.id === settings?.lastWorkspaceId) ??
    workspaces[0]
  const currentName = activeTab?.path && !activeWorkspace ? shortPath(activeTab.path, 42) : current?.name
  const currentPath = activeTab?.path ?? current?.path
  const sorted = [...workspaces].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt)
  const ready = host.state === 'ready'
  const starting = host.state === 'starting'
  const dateLabel = new Date().toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'long' })
  const uptime = (startedAt?: number): string => {
    if (!startedAt) return t('pages.home.standby')
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    return `${Math.floor(seconds / 3600)}h`
  }

  const openPrimary = (): void => {
    if (activeTab?.path && !activeWorkspace) {
      setView('workspace')
      void startHost()
    } else if (current) void openWorkspace(current.id)
    else void addWorkspace()
  }

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            {greeting()}{locale === 'zh-CN' ? '，' : ', '}{dateLabel}
          </div>
          <h1>
            {t('pages.home.heroFirst')}
            <br />
            <span className="gradient-text">{t('pages.home.heroSecond')}</span>
          </h1>
          <p className="hero-lead">
            {t('pages.home.heroLead')}
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={openPrimary} title={currentPath}>
              {currentName ? (
                <>
                  {t('pages.home.openNamed', { name: currentName })}
                  <ArrowRight size={16} />
                </>
              ) : (
                <>
                  {t('pages.home.firstWorkspace')}
                  <FolderPlus size={16} />
                </>
              )}
            </button>
            <button className="button button-secondary" onClick={() => void addWorkspace()}>
              <FolderPlus size={15} />
              {t('pages.home.addFolder')}
            </button>
          </div>
          <div className="hero-hints">
            <span>
              <kbd>Ctrl</kbd> <kbd>K</kbd>  {t('pages.home.palette')}
            </span>
            <span>
              <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>H</kbd>  {t('pages.home.showWindow')}
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
              {t('pages.home.runtime')}
            </div>
            <div className="runtime-state">{hostStateLabel(host.state)}</div>
            <div className="runtime-meta">
              <span>dsh {runtime?.version ?? t('pages.home.notDetected')}</span>
              <span className="dot-sep" />
              <span>{host.port ? `127.0.0.1:${host.port}` : sourceLabel(runtime?.source)}</span>
            </div>
            <div className="runtime-metrics">
              <div>
                <span>Node</span>
                <strong>{runtime?.nodeVersion ?? '—'}</strong>
              </div>
              <div>
                <span>{t('pages.home.port')}</span>
                <strong>{host.port ?? '—'}</strong>
              </div>
              <div>
                <span>{t('pages.home.uptime')}</span>
                <strong>{uptime(host.startedAt)}</strong>
              </div>
            </div>
          </div>
          <div className="runtime-actions">
            {ready ? (
              <>
                <button className="button button-subtle" onClick={() => void restartHost()} title={t('pages.home.restartRuntime')}>
                  <RefreshCw size={14} />
                  {t('pages.home.restart')}
                </button>
                <button className="button button-subtle danger-hover" onClick={() => void stopHost()}>
                  <Pause size={14} />
                  {t('pages.home.stop')}
                </button>
              </>
            ) : (
              <button
                className="button button-primary button-small"
                disabled={starting || runtime?.state !== 'ready'}
                onClick={() => void startHost()}
              >
                <Play size={14} />
                {starting ? t('pages.home.starting') : t('pages.home.startRuntime')}
              </button>
            )}
            <button className="icon-button" onClick={() => setView('logs')} title={t('pages.home.viewLogs')}>
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
            <div className="stat-label">{t('pages.home.workspaces')}</div>
          </div>
          <button className="stat-action" onClick={() => void addWorkspace()} title={t('pages.home.addWorkspace')}>
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-violet">
            <Sparkles size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{prompts.length}</div>
            <div className="stat-label">{t('pages.home.prompts')}</div>
          </div>
          <button className="stat-action" onClick={() => setView('prompts')} title={t('pages.home.openPrompts')}>
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-mint">
            <BarChart3 size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{insights ? compactTokens(insights.totals.totalTokens) : '—'}</div>
            <div className="stat-label">{t('pages.home.totalTokens')}</div>
          </div>
          <button className="stat-action" onClick={() => setView('insights')} title={t('pages.home.openInsights')}>
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-icon accent-amber">
            <Cpu size={17} />
          </div>
          <div className="stat-body">
            <div className="stat-value">{info?.version ?? '0.0.0'}</div>
            <div className="stat-label">{t('pages.home.version')}</div>
          </div>
          <span className="mini-chip">{info?.arch ?? ''}</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>{t('pages.home.recentWorkspaces')}</h2>
            <p>{t('pages.home.recentDesc')}</p>
          </div>
          <button className="button button-ghost button-small" onClick={() => void addWorkspace()}>
            <FolderPlus size={14} />
            {t('pages.home.add')}
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="empty-card">
            <div className="empty-art">
              <FolderPlus size={26} />
            </div>
            <div className="empty-copy">
              <h3>{t('pages.home.emptyTitle')}</h3>
              <p>{t('pages.home.emptyDesc')}</p>
            </div>
            <button className="button button-primary" onClick={() => void addWorkspace()}>
              {t('pages.home.chooseFolder')}
              <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            {sorted.map((workspace) => (
              <article key={workspace.id} className={`workspace-card ${workspace.id === activeWorkspace?.id ? 'is-current' : ''}`}>
                <div className="workspace-card-top">
                  <span className="workspace-color" style={{ background: workspace.color }} />
                  <div className="workspace-name" title={workspace.name}>
                    {workspace.name}
                  </div>
                  <button
                    className={`icon-button ${workspace.pinned ? 'is-pinned' : ''}`}
                    onClick={() => void updateWorkspace(workspace.id, { pinned: !workspace.pinned })}
                    title={workspace.pinned ? t('pages.home.unpin') : t('pages.home.pin')}
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
                    {t('pages.home.open')}
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
              <h3>{t('pages.home.diagnostics')}</h3>
              <p>{t('pages.home.diagnosticsDesc')}</p>
            </div>
            <button className="icon-button" onClick={() => void refreshRuntime()} title={t('pages.home.detectRuntime')}>
              <RefreshCw size={15} />
            </button>
          </div>
          <dl className="kv-list">
            <div>
              <dt>{t('pages.home.status')}</dt>
              <dd>
                <span className={`state-inline state-${runtime?.state ?? 'unknown'}`}>
                  {runtime?.state === 'ready' ? t('pages.home.ready') : runtime?.state === 'missing' ? t('pages.home.missing') : t('pages.home.checking')}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t('pages.home.source')}</dt>
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
                <strong>{runtime?.state === 'missing' ? t('pages.home.runtimeUnavailable') : t('pages.home.runtimeRepair')}</strong>
                <p>{runtime?.error ?? t('pages.home.installHint')}</p>
              </div>
              <button className="button button-primary button-small" onClick={() => void installRuntime()}>
                {t('pages.home.install')}
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
              <h3>{t('pages.home.quickActions')}</h3>
              <p>{t('pages.home.quickActionsDesc')}</p>
            </div>
          </div>
          <div className="shortcut-list">
            <div className="shortcut-row" onClick={() => window.studio.studio.showPalette()}>
              <span>{t('pages.home.palette')}</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>K</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('insights')}>
              <span>{t('pages.home.insights')}</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>3</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('prompts')}>
              <span>{t('pages.home.promptLibrary')}</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>4</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('logs')}>
              <span>{t('pages.home.logs')}</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>5</kbd>
              </span>
            </div>
            <div className="shortcut-row" onClick={() => setView('settings')}>
              <span>{t('pages.home.settings')}</span>
              <span className="keys">
                <kbd>Ctrl</kbd>
                <kbd>,</kbd>
              </span>
            </div>
          </div>
          <div className="panel-foot muted">
            <Sparkles size={13} />
            <span>{t('pages.home.tip')}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
