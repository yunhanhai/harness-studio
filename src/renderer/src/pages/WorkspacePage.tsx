import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Wrench,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useApp } from '../store'
import { hostStateLabel, shortPath } from '../lib/format'
import { BrandMark } from '../components/BrandMark'
import { TabStrip } from '../components/TabStrip'
import { HarnessPane } from './HarnessPane'
import type { PaneState, WebviewElement } from './HarnessPane'

const INITIAL_PANE: PaneState = { loading: true, failed: false, canBack: false, canForward: false }

export function WorkspacePage(): React.JSX.Element {
  const host = useApp((state) => state.host)
  const runtime = useApp((state) => state.runtime)
  const workspaces = useApp((state) => state.workspaces)
  const focusMode = useApp((state) => state.focusMode)
  const onScreen = useApp((state) => state.view === 'workspace')
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  const activeGuestId = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.guestId)
  const setFocusMode = useApp((state) => state.setFocusMode)
  const addWorkspace = useApp((state) => state.addWorkspace)
  const openWorkspace = useApp((state) => state.openWorkspace)
  const startHost = useApp((state) => state.startHost)
  const stopHost = useApp((state) => state.stopHost)
  const restartHost = useApp((state) => state.restartHost)
  const setView = useApp((state) => state.setView)
  const setSettingsSection = useApp((state) => state.setSettingsSection)
  const scanInstances = useApp((state) => state.scanInstances)
  const installRuntime = useApp((state) => state.installRuntime)
  const logs = useApp((state) => state.logs)

  /** Webview elements by tab id, so the toolbar can drive the tab in front. */
  const framesRef = useRef(new Map<string, WebviewElement>())
  const [panes, setPanes] = useState<Record<string, PaneState>>({})
  const [zoom, setZoom] = useState(1)
  const [elapsed, setElapsed] = useState(0)

  const current = workspaces.find((item) => item.id === host.workspaceId) ?? workspaces[0]
  const ready = host.state === 'ready' && Boolean(host.url)
  const starting = host.state === 'starting'
  const recovery = host.recovery
  const [recoverySeconds, setRecoverySeconds] = useState(0)
  const activePane = panes[activeTabId] ?? INITIAL_PANE

  useEffect(() => {
    if (!recovery) {
      setRecoverySeconds(0)
      return
    }
    const tick = (): void => setRecoverySeconds(Math.max(0, Math.ceil((recovery.nextAttemptAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [recovery])
  const sorted = [...workspaces].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt)

  useEffect(() => {
    if (!starting) {
      setElapsed(0)
      return
    }
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [starting])

  const updatePane = useCallback((id: string, patch: Partial<PaneState> | null): void => {
    setPanes((previous) => {
      if (patch === null) {
        if (!(id in previous)) return previous
        const next = { ...previous }
        delete next[id]
        return next
      }
      return { ...previous, [id]: { ...(previous[id] ?? INITIAL_PANE), ...patch } }
    })
  }, [])

  const registerFrame = useCallback((id: string, element: WebviewElement | null): void => {
    if (element) framesRef.current.set(id, element)
    else framesRef.current.delete(id)
  }, [])

  // Quick Ask types into the guest the user is looking at.
  useEffect(() => {
    window.studio.tabs.setActiveGuest(ready ? (activeGuestId ?? null) : null)
  }, [ready, activeTabId, activeGuestId])

  const activeFrame = (): WebviewElement | undefined => framesRef.current.get(activeTabId)

  const changeZoom = (delta: number): void => {
    const element = activeFrame()
    if (!element) return
    let base = zoom
    try {
      base = element.getZoomFactor()
    } catch {
      /* a brand-new tab whose guest has not attached yet */
    }
    const next = Math.min(1.75, Math.max(0.6, Number((base + delta).toFixed(2))))
    // Chromium keeps zoom per origin and every tab shares one, so they move together.
    for (const frame of framesRef.current.values()) {
      try {
        frame.setZoomFactor(next)
      } catch {
        /* guest not attached yet */
      }
    }
    setZoom(next)
  }

  const switchWorkspace = (id: string): void => {
    if (!id || id === current?.id) return
    void openWorkspace(id)
  }

  if (!current) {
    return (
      <div className="page workspace-page">
        <div className="workspace-onboarding">
          <div className="onboarding-visual">
            <div className="onboarding-ring" />
            <BrandMark size={64} />
          </div>
          <h1>选择一个项目，开始 Harness 会话</h1>
          <p>
            每个工作区都绑定自己的目录与上下文。Studio 复用同一个本地 Host，切换项目时不必重新启动服务，并为每个项目保留独立的会话历史。
          </p>
          <div className="onboarding-points">
            <div>
              <strong>独立上下文</strong>
              <span>不同项目的会话互不干扰</span>
            </div>
            <div>
              <strong>本地优先</strong>
              <span>运行时只监听 127.0.0.1</span>
            </div>
            <div>
              <strong>随时切换</strong>
              <span>一个快捷键回到任何项目</span>
            </div>
          </div>
          <button className="button button-primary button-large" onClick={() => void addWorkspace()}>
            <FolderPlus size={17} />
            选择项目文件夹
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace-shell">
      <div className="workspace-toolbar">
        <div className="toolbar-left">
          <div className="workspace-switcher">
            <span className="workspace-color" style={{ background: current.color }} />
            <span className="switcher-name" title={current.name}>
              {current.name}
            </span>
            <ChevronDown size={13} />
            <select value={current.id} onChange={(event) => switchWorkspace(event.target.value)} aria-label="切换工作区">
              {sorted.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          <button className="icon-button" onClick={() => void window.studio.app.showItemInFolder(current.path)} title="在资源管理器中打开">
            <FolderOpen size={14} />
          </button>
          <span className={`toolbar-status host-${host.state}`}>
            <span className="status-dot" />
            {hostStateLabel(host.state)}
          </span>
        </div>

        <TabStrip ready={ready} />

        <div className="toolbar-right">
          <button
            className="icon-button"
            disabled={!ready || !activePane.canBack}
            onClick={() => activeFrame()?.goBack()}
            title="后退"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="icon-button"
            disabled={!ready || !activePane.canForward}
            onClick={() => activeFrame()?.goForward()}
            title="前进"
          >
            <ArrowRight size={15} />
          </button>
          <button
            className="icon-button"
            disabled={!ready}
            onClick={() => {
              updatePane(activeTabId, { loading: true })
              activeFrame()?.reload()
            }}
            title="刷新会话界面"
          >
            <RefreshCw size={14} />
          </button>
          <span className="toolbar-divider" />
          <button className="icon-button" disabled={!ready} onClick={() => changeZoom(-0.1)} title="缩小">
            <ZoomOut size={15} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="icon-button" disabled={!ready} onClick={() => changeZoom(0.1)} title="放大">
            <ZoomIn size={15} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            disabled={!ready}
            onClick={() => activeFrame()?.openDevTools()}
            title="开发者工具"
          >
            <Bug size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => setFocusMode(!focusMode)}
            title={focusMode ? '退出专注模式' : '专注模式：隐藏导航栏'}
          >
            {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      <div className="workspace-body">
        {!ready ? (
          <div className="host-stage">
            {starting ? (
              <>
                <div className="stage-orbit">
                  <span className="stage-ring ring-a" />
                  <span className="stage-ring ring-b" />
                  <span className="stage-ring ring-c" />
                  <div className="stage-core">
                    <BrandMark size={46} />
                  </div>
                </div>
                <h2>正在启动 Harness 运行时</h2>
                <p className="stage-sub">
                  为 <strong>{current.name}</strong> 准备独立的本地服务
                  {elapsed > 0 ? ` · ${elapsed}s` : ''}
                </p>
                <div className="stage-steps">
                  <span className="stage-step done">加载运行时</span>
                  <span className="stage-step active">启动 Web 服务</span>
                  <span className="stage-step">等待就绪</span>
                </div>
                <div className="stage-actions">
                  <button className="button button-subtle" onClick={() => setView('logs')}>
                    <ScrollText size={14} />
                    查看日志
                  </button>
                  <button className="button button-subtle" onClick={() => void stopHost()}>
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="stage-error-icon">
                  <Wrench size={26} />
                </div>
                <h2>
                  {host.recovery
                    ? '运行时已退出，正在自动恢复'
                    : host.state === 'stopping'
                      ? '正在停止运行时…'
                      : '运行时没有就绪'}
                </h2>
                {host.recovery ? (
                  <p className="stage-error">
                    {host.recovery.reason}
                    <br />
                    <span className="stage-recovery">
                      第 {host.recovery.attempt}/{host.recovery.maxAttempts} 次重试，
                      {recoverySeconds > 0 ? `${recoverySeconds} 秒后开始` : '即将开始'}…
                    </span>
                  </p>
                ) : (
                  <p className="stage-error">{host.error ?? runtime?.error ?? '点击下方按钮启动本地 Harness 服务。'}</p>
                )}
                <div className="stage-log">
                  {logs.slice(-6).map((line) => (
                    <div key={line.id} className={`stage-log-line ${line.stream}`}>
                      {line.text}
                    </div>
                  ))}
                </div>
                <div className="stage-actions">
                  <button className="button button-primary" onClick={() => void startHost(current.id)}>
                    <Play size={15} />
                    启动运行时
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      void scanInstances()
                      setView('settings')
                      setSettingsSection('runtime')
                    }}
                    title="查看本机正在运行的 DSH 进程，必要时结束占用的那个"
                  >
                    <ListTree size={14} />
                    查看其他 DSH 进程
                  </button>
                  {runtime?.state !== 'ready' ? (
                    <button className="button button-secondary" onClick={() => void installRuntime()}>
                      <Wrench size={14} />
                      安装便携运行时
                    </button>
                  ) : null}
                  <button className="button button-subtle" onClick={() => void restartHost()}>
                    <RotateCcw size={14} />
                    重启
                  </button>
                  <button className="button button-subtle" onClick={() => setView('logs')}>
                    <ScrollText size={14} />
                    完整日志
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          // One pane per tab, all mounted and stacked; only the active one shows.
          tabs.map((tab) => (
            <HarnessPane
              key={tab.id}
              tab={tab}
              url={host.url ?? ''}
              active={tab.id === activeTabId}
              focused={onScreen && tab.id === activeTabId}
              pane={panes[tab.id] ?? INITIAL_PANE}
              onState={updatePane}
              onFrame={registerFrame}
              onZoom={setZoom}
            />
          ))
        )}
      </div>

      {ready ? (
        <div className="workspace-footnote" title={current.path}>
          <Loader2 size={11} className={activePane.loading ? 'spin' : 'hidden'} />
          <span>{shortPath(current.path, 88)}</span>
        </div>
      ) : null}
    </div>
  )
}
