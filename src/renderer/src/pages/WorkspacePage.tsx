import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ChevronDown,
  FolderOpen,
  FolderPlus,
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

interface WebviewElement extends HTMLElement {
  src: string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  getZoomFactor(): number
  setZoomFactor(factor: number): void
  openDevTools(): void
  isDevToolsOpened(): boolean
}

export function WorkspacePage(): React.JSX.Element {
  const host = useApp((state) => state.host)
  const runtime = useApp((state) => state.runtime)
  const workspaces = useApp((state) => state.workspaces)
  const focusMode = useApp((state) => state.focusMode)
  const setFocusMode = useApp((state) => state.setFocusMode)
  const addWorkspace = useApp((state) => state.addWorkspace)
  const openWorkspace = useApp((state) => state.openWorkspace)
  const startHost = useApp((state) => state.startHost)
  const stopHost = useApp((state) => state.stopHost)
  const restartHost = useApp((state) => state.restartHost)
  const setView = useApp((state) => state.setView)
  const installRuntime = useApp((state) => state.installRuntime)
  const logs = useApp((state) => state.logs)

  const webviewRef = useRef<WebviewElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [elapsed, setElapsed] = useState(0)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)

  const current = workspaces.find((item) => item.id === host.workspaceId) ?? workspaces[0]
  const ready = host.state === 'ready' && Boolean(host.url)
  const starting = host.state === 'starting'
  const sorted = [...workspaces].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastOpenedAt - a.lastOpenedAt)

  useEffect(() => {
    if (!starting) {
      setElapsed(0)
      return
    }
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [starting])

  useEffect(() => {
    const element = webviewRef.current
    if (!element || !ready) return
    const onStart = (): void => {
      setLoading(true)
      setFailed(false)
    }
    const onStop = (): void => {
      setLoading(false)
      setCanBack(element.canGoBack())
      setCanForward(element.canGoForward())
      try {
        setZoom(element.getZoomFactor())
      } catch {
        /* ignore */
      }
    }
    const onFail = (event: Event): void => {
      const detail = event as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (detail.isMainFrame === false) return
      if (detail.errorCode === -3) return
      setLoading(false)
      setFailed(true)
    }
    const onTitle = (): void => {
      setCanBack(element.canGoBack())
      setCanForward(element.canGoForward())
    }
    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('did-fail-load', onFail)
    element.addEventListener('did-navigate', onTitle)
    element.addEventListener('did-navigate-in-page', onTitle)
    return () => {
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('did-fail-load', onFail)
      element.removeEventListener('did-navigate', onTitle)
      element.removeEventListener('did-navigate-in-page', onTitle)
    }
  }, [ready, host.url])

  useEffect(() => {
    if (!ready) setLoading(true)
  }, [ready])

  const changeZoom = (delta: number): void => {
    const element = webviewRef.current
    if (!element) return
    const next = Math.min(1.75, Math.max(0.6, Number((element.getZoomFactor() + delta).toFixed(2))))
    element.setZoomFactor(next)
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
            每个工作区都绑定自己的目录与上下文。Studio 会在你切换项目时重启本地运行时，并为每个项目保留独立的会话历史。
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

        <div className="toolbar-right">
          <button
            className="icon-button"
            disabled={!ready || !canBack}
            onClick={() => webviewRef.current?.goBack()}
            title="后退"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="icon-button"
            disabled={!ready || !canForward}
            onClick={() => webviewRef.current?.goForward()}
            title="前进"
          >
            <ArrowRight size={15} />
          </button>
          <button
            className="icon-button"
            disabled={!ready}
            onClick={() => {
              setLoading(true)
              webviewRef.current?.reload()
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
            onClick={() => webviewRef.current?.openDevTools()}
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
                <h2>{host.state === 'stopping' ? '正在停止运行时…' : '运行时没有就绪'}</h2>
                <p className="stage-error">{host.error ?? runtime?.error ?? '点击下方按钮启动本地 Harness 服务。'}</p>
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
          <>
            <webview
              ref={webviewRef as unknown as React.Ref<HTMLElement>}
              className="dsh-frame"
              src={host.url}
              partition="persist:harness-studio"
            />
            {loading && !failed ? (
              <div className="webview-loading">
                <div className="loading-mark">
                  <BrandMark size={40} />
                </div>
                <div className="loading-text">正在载入 Harness 会话界面…</div>
                <div className="loading-bar">
                  <span />
                </div>
              </div>
            ) : null}
            {failed ? (
              <div className="webview-failed">
                <h3>界面加载失败</h3>
                <p>本地服务已就绪，但渲染进程没有完成加载。可以尝试刷新或重启运行时。</p>
                <div className="stage-actions">
                  <button className="button button-primary" onClick={() => webviewRef.current?.reload()}>
                    <RefreshCw size={14} />
                    重新加载
                  </button>
                  <button className="button button-secondary" onClick={() => void restartHost()}>
                    <RotateCcw size={14} />
                    重启运行时
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {ready ? (
        <div className="workspace-footnote" title={current.path}>
          <Loader2 size={11} className={loading ? 'spin' : 'hidden'} />
          <span>{shortPath(current.path, 88)}</span>
        </div>
      ) : null}
    </div>
  )
}
