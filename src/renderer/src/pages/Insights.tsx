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
  const max = Math.max(1, ...data.map((item) => item.tokens))
  return (
    <div className="trend-chart">
      <div className="trend-bars">
        {data.map((item) => {
          const height = Math.max(2, Math.round((item.tokens / max) * 100))
          return (
            <div key={item.date} className="trend-column" title={`${item.date} · ${compact(item.tokens)} tokens · ${item.sessions} 个会话`}>
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
            会话洞察
          </div>
          <h1>看见你的 Harness 用量</h1>
          <p>从本地会话记录统计，不上传任何对话内容。</p>
        </div>
        <div className="page-head-actions">
          <button
            className="button button-secondary button-small"
            disabled={loading}
            onClick={() => void loadInsights(true)}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            {loading ? '扫描中…' : '重新扫描'}
          </button>
          <button
            className="button button-ghost button-small"
            onClick={() => setView('settings')}
            title="在设置中配置价格与货币"
          >
            <Coins size={14} />
            价格设置
          </button>
        </div>
      </header>

      {error ? (
        <div className="insight-banner insight-banner-error">
          <Activity size={15} />
          <span>读取会话数据失败：{error}</span>
        </div>
      ) : null}

      {!insights && loading ? (
        <div className="insight-loading">
          <div className="loading-mark">
            <Sparkles size={28} />
          </div>
          <span>正在扫描 {settings?.runtime.dshHome || '~/.dsh'} 下的会话…</span>
        </div>
      ) : null}

      {insights && insights.totals.sessions === 0 ? (
        <div className="empty-card">
          <div className="empty-art">
            <BarChart3 size={24} />
          </div>
          <div className="empty-copy">
            <h3>还没有可统计的会话</h3>
            <p>
              在 Harness 中完成一次对话后，这里会显示会话数、token 用量、缓存命中率与每日趋势。
              数据全部来自本机 <code>{insights.dshHome}</code>。
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
              label="会话数"
              value={String(insights.totals.sessions)}
              hint={`${insights.totals.activeSessions} 个有内容`}
            />
            <StatCard
              icon={Zap}
              tone="tone-violet"
              label="总 Token"
              value={compact(tokenTotal)}
              hint={`输入 ${compact(insights.totals.tokens.uncachedInputTokens)} · 输出 ${compact(insights.totals.tokens.outputTokens)}`}
            />
            <StatCard
              icon={Gauge}
              tone="tone-mint"
              label="缓存命中率"
              value={`${cacheRate}%`}
              hint={`读取 ${compact(insights.totals.tokens.cacheReadTokens)}`}
            />
            <StatCard
              icon={TrendingUp}
              tone="tone-amber"
              label="回合 / 步骤"
              value={`${insights.totals.turns} / ${insights.totals.steps}`}
              hint={`${insights.totals.messages} 条用户输入`}
            />
            <StatCard
              icon={Timer}
              tone="tone-cyan"
              label="模型耗时"
              value={duration(insights.totals.llmMs)}
              hint={`工具耗时 ${duration(insights.totals.toolMs)}`}
            />
            {cost ? (
              <StatCard
                icon={Coins}
                tone="tone-rose"
                label="预估花费"
                value={cost}
                hint="按设置中的单价估算"
              />
            ) : null}
          </div>

          <section className="insight-panels">
            <div className="panel insight-trend">
              <div className="panel-head">
                <div>
                  <h3>最近 14 天用量</h3>
                  <p>按会话最后活跃时间归入当天，柱高代表 token 总量。</p>
                </div>
                <span className="insight-source">
                  <CalendarDays size={12} />
                  {insights.source === 'projection-cache' ? '投影缓存' : insights.source === 'session-logs' ? '会话日志' : '未知来源'}
                </span>
              </div>
              <TrendChart data={insights.daily} />
            </div>

            <div className="panel insight-model">
              <div className="panel-head">
                <div>
                  <h3>按模型分布</h3>
                  <p>token 量排序。</p>
                </div>
              </div>
              <div className="breakdown-list">
                {insights.byModel.slice(0, 6).map((item) => (
                  <BreakdownBar
                    key={item.label}
                    label={item.label}
                    value={item.tokens}
                    max={modelMax}
                    hint={`${compact(item.tokens)} · ${item.turns} 回合`}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="panel insight-workspace">
            <div className="panel-head">
              <div>
                <h3>按工作区分布</h3>
                <p>哪个项目最消耗上下文。</p>
              </div>
            </div>
            <div className="breakdown-list two-col">
              {insights.byWorkspace.slice(0, 8).map((item) => (
                <BreakdownBar
                  key={item.path}
                  label={item.name}
                  value={item.tokens}
                  max={workspaceMax}
                  hint={`${compact(item.tokens)} · ${item.sessions} 会话`}
                />
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-head">
              <div>
                <h2>会话明细</h2>
                <p>共 {sessions.length} 条记录，点击文件夹图标可在资源管理器中打开。</p>
              </div>
              <div className="search-field search-compact">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="按标题、目录或模型筛选"
                />
              </div>
            </div>

            <div className="session-table">
              <div className="session-head">
                <span>会话</span>
                <span>目录</span>
                <span>模型</span>
                <span className="num">Token</span>
                <span className="num">回合</span>
                <span className="num">活跃</span>
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
                      {session.title ?? (session.blank ? '（空会话）' : session.id.slice(0, 12))}
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
                        title="在资源管理器中打开会话目录"
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
                {showAll ? '收起' : `显示全部 ${sessions.length} 条`}
                <ArrowUpRight size={13} />
              </button>
            ) : null}
          </section>

          <p className="insight-footnote">
            数据来源：<code>{insights.sessionsDir}</code> · 上次扫描 {new Date(insights.scannedAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </p>
        </>
      ) : null}
    </div>
  )
}
