import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, FolderOpen, Pause, Play, Search, Trash2 } from 'lucide-react'
import { useApp } from '../store'
import { clockTime } from '../lib/format'

type Filter = 'all' | 'out' | 'err' | 'sys'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'out', label: '标准输出' },
  { id: 'err', label: '错误' },
  { id: 'sys', label: '系统' }
]

export function Logs(): React.JSX.Element {
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
    toast(`已复制 ${filtered.length} 行日志`, 'success')
  }

  return (
    <div className="page logs-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <span className={`status-dot host-${host.state}`} />
            运行日志
          </div>
          <h1>看见运行时发生了什么</h1>
          <p>实时输出会同时写入本地文件；访问令牌在日志中自动脱敏。</p>
        </div>
        <div className="page-head-actions">
          <button className="button button-secondary button-small" onClick={() => void window.studio.host.openLogsFolder()}>
            <FolderOpen size={14} />
            日志文件夹
          </button>
          <button className="button button-secondary button-small" onClick={() => void copyAll()}>
            <Copy size={14} />
            复制
          </button>
          <button className="button button-ghost button-small" onClick={() => void clearLogs()}>
            <Trash2 size={14} />
            清空
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="过滤日志内容" />
        </div>
        <button
          className={`button button-ghost button-small ${autoScroll ? 'is-on' : ''}`}
          onClick={() => setAutoScroll(!autoScroll)}
          title="自动滚动"
        >
          {autoScroll ? <Pause size={13} /> : <Play size={13} />}
          {autoScroll ? '跟随' : '已暂停'}
        </button>
      </div>

      <div className="log-panel">
        <div className="log-head">
          <span>时间</span>
          <span>来源</span>
          <span>内容</span>
        </div>
        <div className="log-scroll" ref={scroller}>
          {filtered.length === 0 ? (
            <div className="log-empty">
              <ArrowDownToLine size={20} />
              <span>{logs.length === 0 ? '还没有日志。启动一次运行时后，这里会实时显示输出。' : '当前筛选条件下没有日志。'}</span>
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
          <span>{filtered.length} / {logs.length} 行</span>
          <span>最多保留 4000 行 · 完整记录见 host-*.log</span>
        </div>
      </div>
    </div>
  )
}
