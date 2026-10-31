import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Coins,
  FolderOpen,
  Gauge,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Timer,
  TrendingUp,
  Zap
} from 'lucide-react'
import type { InsightsData, SessionSummary } from '@shared/types'
import { useApp } from '../store'
import { useI18n } from '../lib/i18n'
import { relativeTime, shortPath } from '../lib/format'

function compact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function duration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`
}

function money(value: number | undefined, currency: string | undefined): string | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  if (value === 0) return null
  const symbol = currency === 'USD' ? '$' : '¥'
  return `${symbol}${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
}

function dayLabel(date: string): string {
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

interface StatCardProps {
  icon: React.ComponentType<{ size?: number }>
  tone: string
  label: string
  value: string
  hint?: string
}

function StatCard({ icon: Icon, tone, label, value, hint }: StatCardProps): React.JSX.Element {
  return (
    <div className="insight-stat">
      <div className={`insight-stat-icon ${tone}`}>
        <Icon size={16} />
      </div>
      <div className="insight-stat-body">
        <div className="insight-stat-value">{value}</div>
        <div className="insight-stat-label">{label}</div>
        {hint ? <div className="insight-stat-hint">{hint}</div> : null}
      </div>
    </div>
  )
}

function TrendChart({ data }: { data: InsightsData['daily'] }): React.JSX.Element {
  const { t } = useI18n()
  const max = Math.max(1, ...data.map((item) => item.tokens))
  return (
    <div className="trend-chart">
      <div className="trend-bars">
        {data.map((item) => {
          const height = Math.max(2, Math.round((item.tokens / max) * 100))
          return (
            <div key={item.date} className="trend-column" title={t('pages.insights.trendTooltip', { date: item.date, tokens: compact(item.tokens), count: item.sessions })}>
              <div className="trend-bar-wrap">
                <span className="trend-bar" style={{ height: `${height}%` }} />
              </div>
              <span className="trend-label">{dayLabel(item.date)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BreakdownBar({
  label,
  value,
  max,
  hint
}: {
  label: string
  value: number
  max: number
  hint: string
}): React.JSX.Element {
  const ratio = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2
  return (
    <div className="breakdown-row">
      <div className="breakdown-head">
        <span className="breakdown-label" title={label}>
          {label}
        </span>
        <span className="breakdown-value">{hint}</span>
      </div>
      <div className="breakdown-track">
        <span style={{ width: `${ratio}%` }} />
      </div>
    </div>
  )
}

export function Insights(): React.JSX.Element {
  const { locale, t } = useI18n()
  const insights = useApp((state) => state.insights)
  const loading = useApp((state) => state.insightsLoading)
  const error = useApp((state) => state.insightsError)
  const settings = useApp((state) => state.settings)
  const loadInsights = useApp((state) => state.loadInsights)
  const revealSession = useApp((state) => state.revealSession)
  const setView = useApp((state) => state.setView)
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!insights) void loadInsights()
  }, [insights, loadInsights])

  const sessions = useMemo(() => {
    if (!insights) return []
    const keyword = query.trim().toLowerCase()
    const list = keyword
      ? insights.sessions.filter((item) =>
          [item.title ?? '', item.cwd, item.workspaceName ?? '', item.model ?? '']
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        )
      : insights.sessions
    return list
  }, [insights, query])

  const visibleSessions = showAll ? sessions : sessions.slice(0, 12)
  const tokenTotal = insights?.totals.totalTokens ?? 0
  const cost = money(insights?.costEstimate, insights?.currency)
  const cacheRate = insights ? Math.round(insights.totals.cacheHitRate * 100) : 0
  const modelMax = Math.max(1, ...(insights?.byModel.map((item) => item.tokens) ?? [1]))
  const workspaceMax = Math.max(1, ...(insights?.byWorkspace.map((item) => item.tokens) ?? [1]))

  return (
    <div className="page insights-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <BarChart3 size={13} />
            {t('pages.insights.title')}
          </div>
          <h1>{t('pages.insights.headline')}</h1>
          <p>{t('pages.insights.description')}</p>
        </div>
        <div className="page-head-actions">
          <button
            className="button button-secondary button-small"
            disabled={loading}
            onClick={() => void loadInsights(true)}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? t('pages.insights.scanning') : t('pages.insights.rescan')}
          </button>
          <button
            className="button button-ghost button-small"
            onClick={() => setView('settings')}
            title={t('pages.insights.pricingHint')}
          >
            <Coins size={14} />
            {t('pages.insights.pricing')}
          </button>
        </div>
      </header>

      {error ? (
        <div className="insight-banner insight-banner-error">
          <Activity size={15} />
          <span>{t('pages.insights.readFailed', { error })}</span>
        </div>
      ) : null}

      {!insights && loading ? (
        <div className="insight-loading">
          <div className="loading-mark">
            <Sparkles size={28} />
          </div>
          <span>{t('pages.insights.scanningDirectory', { path: settings?.runtime.dshHome || '~/.dsh' })}</span>
        </div>
      ) : null}

      {insights && insights.totals.sessions === 0 ? (
        <div className="empty-card">
          <div className="empty-art">
            <BarChart3 size={24} />
          </div>
          <div className="empty-copy">
            <h3>{t('pages.insights.emptyTitle')}</h3>
            <p>
              {t('pages.insights.emptyDescription')} <code>{insights.dshHome}</code>{locale === 'zh-CN' ? '。' : '.'}
            </p>
          </div>
        </div>
      ) : null}

      {insights && insights.totals.sessions > 0 ? (
        <>
          <div className="insight-stats">
            <StatCard
              icon={MessageSquare}
              tone="tone-blue"
              label={t('pages.insights.sessions')}
              value={String(insights.totals.sessions)}
              hint={t('pages.insights.activeSessions', { count: insights.totals.activeSessions })}
            />
            <StatCard
              icon={Zap}
              tone="tone-violet"
              label={t('pages.insights.tokens')}
              value={compact(tokenTotal)}
              hint={t('pages.insights.inputOutput', { input: compact(insights.totals.tokens.uncachedInputTokens), output: compact(insights.totals.tokens.outputTokens) })}
            />
            <StatCard
              icon={Gauge}
              tone="tone-mint"
              label={t('pages.insights.cacheRate')}
              value={`${cacheRate}%`}
              hint={t('pages.insights.cacheReads', { count: compact(insights.totals.tokens.cacheReadTokens) })}
            />
            <StatCard
              icon={TrendingUp}
              tone="tone-amber"
              label={t('pages.insights.turnsSteps')}
              value={`${insights.totals.turns} / ${insights.totals.steps}`}
              hint={t('pages.insights.messages', { count: insights.totals.messages })}
            />
            <StatCard
              icon={Timer}
              tone="tone-cyan"
              label={t('pages.insights.modelTime')}
              value={duration(insights.totals.llmMs)}
              hint={t('pages.insights.toolTime', { time: duration(insights.totals.toolMs) })}
            />
            {cost ? (
              <StatCard
                icon={Coins}
                tone="tone-rose"
                label={t('pages.insights.cost')}
                value={cost}
                hint={t('pages.insights.costHint')}
              />
            ) : null}
          </div>

          <section className="insight-panels">
            <div className="panel insight-trend">
              <div className="panel-head">
                <div>
                  <h3>{t('pages.insights.trendTitle')}</h3>
                  <p>{t('pages.insights.trendDescription')}</p>
                </div>
                <span className="insight-source">
                  <CalendarDays size={12} />
                  {insights.source === 'projection-cache' ? t('pages.insights.projectionCache') : insights.source === 'session-logs' ? t('pages.insights.sessionLogs') : t('pages.insights.unknownSource')}
                </span>
              </div>
              <TrendChart data={insights.daily} />
            </div>

            <div className="panel insight-model">
              <div className="panel-head">
                <div>
                  <h3>{t('pages.insights.modelBreakdown')}</h3>
                  <p>{t('pages.insights.modelBreakdownDesc')}</p>
                </div>
              </div>
              <div className="breakdown-list">
                {insights.byModel.slice(0, 6).map((item) => (
                  <BreakdownBar
                    key={item.label}
                    label={item.unrecorded ? t('pages.insights.unrecorded') : item.label}
                    value={item.tokens}
                    max={modelMax}
                    hint={t('pages.insights.modelHint', { tokens: compact(item.tokens), count: item.turns })}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="panel insight-workspace">
            <div className="panel-head">
              <div>
                <h3>{t('pages.insights.workspaceBreakdown')}</h3>
                <p>{t('pages.insights.workspaceBreakdownDesc')}</p>
              </div>
            </div>
            <div className="breakdown-list two-col">
              {insights.byWorkspace.slice(0, 8).map((item) => (
                <BreakdownBar
                  key={item.path}
                  label={item.unknownDirectory ? t('pages.insights.unknownDirectory') : item.name}
                  value={item.tokens}
                  max={workspaceMax}
                  hint={t('pages.insights.workspaceHint', { tokens: compact(item.tokens), count: item.sessions })}
                />
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <div>
                <h2>{t('pages.insights.details')}</h2>
                <p>{t('pages.insights.records', { count: sessions.length })}</p>
              </div>
              <div className="search-field search-compact">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('pages.insights.filterPlaceholder')}
                />
              </div>
            </div>

            <div className="session-table">
              <div className="session-head">
                <span>{t('pages.insights.session')}</span>
                <span>{t('pages.insights.directory')}</span>
                <span>{t('pages.insights.model')}</span>
                <span className="num">Token</span>
                <span className="num">{t('pages.insights.turns')}</span>
                <span className="num">{t('pages.insights.active')}</span>
                <span />
              </div>
              {visibleSessions.map((session: SessionSummary) => {
                const total =
                  session.tokens.uncachedInputTokens +
                  session.tokens.outputTokens +
                  session.tokens.cacheReadTokens
                return (
                  <div key={session.id} className={`session-row ${session.blank ? 'is-blank' : ''}`}>
                    <span className="session-title" title={session.title ?? session.id}>
                      {session.title ?? (session.blank ? t('pages.insights.emptySession') : session.id.slice(0, 12))}
                    </span>
                    <span className="session-path" title={session.cwd}>
                      {shortPath(session.cwd || '—', 40)}
                    </span>
                    <span className="session-model" title={session.model ?? ''}>
                      {session.model ?? '—'}
                    </span>
                    <span className="num mono">{compact(total)}</span>
                    <span className="num mono">{session.turns}</span>
                    <span className="num session-time">{relativeTime(session.lastActiveAt || session.createdAt)}</span>
                    <span className="session-actions">
                      <button
                        className="icon-button"
                        onClick={() => void revealSession(session.id)}
                        title={t('pages.insights.openDirectory')}
                      >
                        <FolderOpen size={13} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>

            {sessions.length > 12 ? (
              <button className="session-more" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('pages.insights.collapse') : t('pages.insights.showAll', { count: sessions.length })}
                <ArrowUpRight size={13} />
              </button>
            ) : null}
          </section>

          <p className="insight-footnote">
            {t('pages.insights.sourcePrefix')} <code>{insights.sessionsDir}</code> {t('pages.insights.lastScanPrefix')} {new Date(insights.scannedAt).toLocaleTimeString(locale, { hour12: false })}
          </p>
        </>
      ) : null}
    </div>
  )
}
