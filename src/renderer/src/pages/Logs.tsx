import { t as translateNow, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, FolderOpen, Pause, Play, Search, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import { clockTime } from '../lib/format'

type Filter = 'all' | 'out' | 'err' | 'sys'

export function Logs(): React.JSX.Element {
  const { t } = useI18n()
  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('shell.all') },
    { id: 'out', label: t('shell.standardOutput') },
    { id: 'err', label: t('shell.errors') },
    { id: 'sys', label: t('shell.system') }
  ]
  const logs = useApp((state) => state.logs)
  const host = useApp((state) => state.host)
  const clearLogs = useApp((state) => state.clearLogs)
  const toast = useApp((state) => state.toast)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const scroller = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = logs.filter((line) => {
      if (filter !== 'all' && line.stream !== filter) return false
      if (keyword && !line.text.toLowerCase().includes(keyword)) return false
      return true
    })
    return list.slice(-800)
  }, [logs, filter, query])

  useEffect(() => {
    if (!autoScroll) return
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [filtered, autoScroll])

  const counts = useMemo(
    () => ({
      all: logs.length,
      err: logs.filter((line) => line.stream === 'err').length,
      out: logs.filter((line) => line.stream === 'out').length,
      sys: logs.filter((line) => line.stream === 'sys').length
    }),
    [logs]
  )

  const copyAll = async (): Promise<void> => {
    const text = filtered.map((line) => `[${clockTime(line.ts)}] [${line.stream}] ${line.text}`).join('\n')
    await window.studio.clipboard.write(text)
    toast(translateNow('shell.copiedLogLines', { p0: filtered.length }), 'success')
  }

  return (
    <div className="page logs-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <span className={`status-dot host-${host.state}`} />
            {t('shell.runtimeLogs')}
          </div>
          <h1>{t('shell.seeWhatHappensInTheRuntime')}</h1>
          <p>{t('shell.liveOutputIsAlsoWrittenToLocalFiles')}</p>
        </div>
        <div className="page-head-actions">
          <button className="button button-secondary button-small" onClick={() => void window.studio.host.openLogsFolder()}>
            <FolderOpen size={14} />
            {t('shell.logsFolder')}
          </button>
          <button className="button button-secondary button-small" onClick={() => void copyAll()}>
            <Copy size={14} />
            {t('shell.copy')}
          </button>
          <button className="button button-ghost button-small" onClick={() => void clearLogs()}>
            <Trash2 size={14} />
            {t('shell.clearLogs')}
          </button>
        </div>
      </header>

      <div className="log-toolbar">
        <div className="segmented">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="seg-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="search-field search-compact">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('shell.filterLogContent')} />
        </div>
        <button
          className={`button button-ghost button-small ${autoScroll ? 'is-on' : ''}`}
          onClick={() => setAutoScroll(!autoScroll)}
          title={t('shell.autoScroll')}
        >
          {autoScroll ? <Pause size={13} /> : <Play size={13} />}
          {autoScroll ? t('shell.following') : t('shell.paused')}
        </button>
      </div>

      <div className="log-panel">
        <div className="log-head">
          <span>{t('shell.time')}</span>
          <span>{t('shell.source')}</span>
          <span>{t('shell.content')}</span>
        </div>
        <div className="log-scroll" ref={scroller}>
          {filtered.length === 0 ? (
            <div className="log-empty">
              <ArrowDownToLine size={20} />
              <span>{logs.length === 0 ? t('shell.noLogsYetStartTheRuntimeToSee') : t('shell.noLogsMatchTheCurrentFilters')}</span>
            </div>
          ) : (
            filtered.map((line) => (
              <div key={line.id} className={`log-line log-${line.stream}`}>
                <span className="log-time">{clockTime(line.ts)}</span>
                <span className={`log-badge badge-${line.stream}`}>{line.stream.toUpperCase()}</span>
                <span className="log-text">{line.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="log-footer">
          <span>{t('shell.logLineCount', { shown: filtered.length, total: logs.length })}</span>
          <span>{t('shell.upTo4000LinesFullLogsHost')}</span>
        </div>
      </div>
    </div>
  )
}
