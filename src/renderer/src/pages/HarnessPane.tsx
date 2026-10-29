import { memo, useEffect, useRef } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { useApp } from '../store'
import type { WorkspaceTab } from '../store'
import { BrandMark } from '../components/BrandMark'

export interface WebviewElement extends HTMLElement {
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
  /** Electron only; the inert <webview> of the browser preview has no methods. */
  getWebContentsId?: () => number
}

/** What the toolbar and footnote need to know about one tab's page. */
export interface PaneState {
  loading: boolean
  failed: boolean
  canBack: boolean
  canForward: boolean
}

/**
 * The embedded UI titles its page "<session title> — <product title>", or just
 * the product title when no session applies.
 */
function sessionTitle(pageTitle: string): string {
  const cut = pageTitle.lastIndexOf(' — ')
  return cut === -1 ? '' : pageTitle.slice(0, cut).trim()
}

interface HarnessPaneProps {
  tab: WorkspaceTab
  url: string
  /** The tab in front of the strip. */
  active: boolean
  /** Active and the workspace view is the visible page: typing should land here. */
  focused: boolean
  pane: PaneState
  /** `null` forgets the tab's state, so a remount starts from loading again. */
  onState: (id: string, patch: Partial<PaneState> | null) => void
  onFrame: (id: string, element: WebviewElement | null) => void
  onZoom: (factor: number) => void
}

/**
 * One session tab: a webview plus its loading and failure overlays. It must stay
 * under the same parent for as long as its tab exists, because moving or
 * unmounting a <webview> destroys the guest page.
 */
export const HarnessPane = memo(function HarnessPane({
  tab,
  url,
  active,
  focused,
  pane,
  onState,
  onFrame,
  onZoom
}: HarnessPaneProps): React.JSX.Element {
  const updateTab = useApp((state) => state.updateTab)
  const restartHost = useApp((state) => state.restartHost)
  const frameRef = useRef<WebviewElement | null>(null)
  const id = tab.id

  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    onFrame(id, element)
    const onStart = (): void => onState(id, { loading: true, failed: false })
    const onStop = (): void => {
      onState(id, { loading: false, canBack: element.canGoBack(), canForward: element.canGoForward() })
      // Every tab shares one origin and so one zoom; only the tab in front reports it.
      if (useApp.getState().activeTabId !== id) return
      try {
        onZoom(element.getZoomFactor())
      } catch {
        /* ignore */
      }
    }
    const onFail = (event: Event): void => {
      const detail = event as unknown as { errorCode?: number; isMainFrame?: boolean }
      if (detail.isMainFrame === false) return
      if (detail.errorCode === -3) return
      onState(id, { loading: false, failed: true })
    }
    const onNavigate = (): void => {
      onState(id, { canBack: element.canGoBack(), canForward: element.canGoForward() })
    }
    const onReady = (): void => {
      if (typeof element.getWebContentsId !== 'function') return
      try {
        updateTab(id, { guestId: element.getWebContentsId() })
      } catch {
        /* not attached yet */
      }
    }
    const onTitle = (event: Event): void => {
      const title = (event as unknown as { title?: unknown }).title
      updateTab(id, { title: typeof title === 'string' ? sessionTitle(title) : '' })
    }
    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('did-fail-load', onFail)
    element.addEventListener('did-navigate', onNavigate)
    element.addEventListener('did-navigate-in-page', onNavigate)
    element.addEventListener('dom-ready', onReady)
    element.addEventListener('page-title-updated', onTitle)
    return () => {
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('did-fail-load', onFail)
      element.removeEventListener('did-navigate', onNavigate)
      element.removeEventListener('did-navigate-in-page', onNavigate)
      element.removeEventListener('dom-ready', onReady)
      element.removeEventListener('page-title-updated', onTitle)
      onFrame(id, null)
      onState(id, null)
      updateTab(id, { guestId: undefined })
    }
  }, [id, onState, onFrame, onZoom, updateTab])

  // Typing follows the tab in front. A tab that goes to the back, or a workspace
  // view that is parked behind another page, gives focus up so keys never land
  // in a composer nobody can see.
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    if (focused) element.focus({ preventScroll: true })
    else if (document.activeElement === element) element.blur()
  }, [focused])

  return (
    <div className={`harness-pane ${active ? 'is-active' : 'is-parked'}`}>
      <webview
        ref={frameRef as unknown as React.Ref<HTMLElement>}
        className="dsh-frame"
        src={url}
        partition="persist:harness-studio"
      />
      {pane.loading && !pane.failed ? (
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
      {pane.failed ? (
        <div className="webview-failed">
          <h3>界面加载失败</h3>
          <p>本地服务已就绪，但渲染进程没有完成加载。可以尝试刷新或重启运行时。</p>
          <div className="stage-actions">
            <button className="button button-primary" onClick={() => frameRef.current?.reload()}>
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
    </div>
  )
})
