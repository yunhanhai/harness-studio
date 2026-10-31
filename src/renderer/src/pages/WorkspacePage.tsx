import { useI18n } from '../lib/i18n'
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
  const { t } = useI18n()
  const host = useApp((state) => state.host)
  const runtime = useApp((state) => state.runtime)
  const workspaces = useApp((state) => state.workspaces)
  const lastWorkspaceId = useApp((state) => state.settings?.lastWorkspaceId)
  const focusMode = useApp((state) => state.focusMode)
  const onScreen = useApp((state) => state.view === 'workspace')
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  const activeGuestId = useApp((state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.guestId)
  const setFocusMode = useApp((state) => state.setFocusMode)
  const addWorkspace = useApp((state) => state.addWorkspace)
  const openWorkspace = useApp((state) => state.openWorkspace)
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

  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const current = workspaces.find((item) => item.id === activeTab?.workspaceId)
  const pending = workspaces.find((item) => item.id === activeTab?.pendingWorkspaceId)
  const switching = Boolean(pending || activeTab?.pendingWorkspacePath)
  const startup = pending ?? current ?? workspaces.find((item) => item.id === lastWorkspaceId) ?? workspaces[0]
  const currentPath = activeTab?.path ?? ''
  const currentName = current?.name ?? (currentPath ? t('shell.unlinkedWorkspace') : t('shell.chooseWorkspace'))
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
    if (!id || id === pending?.id || (id === current?.id && !switching)) return
    void openWorkspace(id)
  }

  if (workspaces.length === 0 && !ready && !currentPath) {
    return (
      <div className="page workspace-page">
        <div className="workspace-onboarding">
          <div className="onboarding-visual">
            <div className="onboarding-ring" />
            <BrandMark size={64} />
          </div>
          <h1>{t('shell.chooseAProjectAndStartAHarnessSession')}</h1>
          <p>
            {t('shell.eachWorkspaceHasItsOwnDirectoryAndContext')}</p>
          <div className="onboarding-points">
            <div>
              <strong>{t('shell.separateContexts')}</strong>
              <span>{t('shell.sessionsInDifferentProjectsStayIndependent')}</span>
            </div>
            <div>
              <strong>{t('shell.localFirst')}</strong>
              <span>{t('shell.theRuntimeListensOnlyOn12700')}</span>
            </div>
            <div>
              <strong>{t('shell.switchAnytime')}</strong>
              <span>{t('shell.returnToAnyProjectWithAShortcut')}</span>
            </div>
          </div>
          <button className="button button-primary button-large" onClick={() => void addWorkspace()}>
            <FolderPlus size={17} />
            {t('shell.chooseProjectFolder')}
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
            <span className="workspace-color" style={{ background: current?.color ?? 'var(--muted)' }} />
            <span className="switcher-name" title={currentPath || currentName}>
              {currentName}
            </span>
            {switching ? <Loader2 size={13} className="spin" aria-label={pending ? t('shell.opening', { p0: pending.name }) : t('shell.openingWorkspace')} /> : <ChevronDown size={13} />}
            <select value={pending?.id ?? current?.id ?? ''} onChange={(event) => switchWorkspace(event.target.value)} aria-label={t('shell.switchWorkspace')}>
              {!current ? <option value="" disabled>{currentName}</option> : null}
              {sorted.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          <button className="icon-button" disabled={!currentPath} onClick={() => void window.studio.app.showItemInFolder(currentPath)} title={t('shell.showInFileManager')}>
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
            title={t('shell.back')}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            className="icon-button"
            disabled={!ready || !activePane.canForward}
            onClick={() => activeFrame()?.goForward()}
            title={t('shell.forward')}
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
            title={t('shell.refreshConversationInterface')}
          >
            <RefreshCw size={14} />
          </button>
          <span className="toolbar-divider" />
          <button className="icon-button" disabled={!ready} onClick={() => changeZoom(-0.1)} title={t('shell.zoomOut')}>
            <ZoomOut size={15} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="icon-button" disabled={!ready} onClick={() => changeZoom(0.1)} title={t('shell.zoomIn')}>
            <ZoomIn size={15} />
          </button>
          <span className="toolbar-divider" />
          <button
            className="icon-button"
            disabled={!ready}
            onClick={() => activeFrame()?.openDevTools()}
            title={t('shell.developerTools')}
          >
            <Bug size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => setFocusMode(!focusMode)}
            title={focusMode ? t('shell.exitFocusMode') : t('shell.focusModeHideNavigation')}
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
                <h2>{t('shell.startingHarnessRuntime')}</h2>
                <p className="stage-sub">
                  {t('shell.serviceStartup', { name: startup?.name ?? t('shell.currentWorkspace') })}
                  {elapsed > 0 ? ` · ${elapsed}s` : ''}
                </p>
                <div className="stage-steps">
                  <span className="stage-step done">{t('shell.loadRuntime')}</span>
                  <span className="stage-step active">{t('shell.startWebService')}</span>
                  <span className="stage-step">{t('shell.waitUntilReady')}</span>
                </div>
                <div className="stage-actions">
                  <button className="button button-subtle" onClick={() => setView('logs')}>
                    <ScrollText size={14} />
                    {t('shell.viewLogs')}
                  </button>
                  <button className="button button-subtle" onClick={() => void stopHost()}>
                    {t('shell.cancel')}
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
                    ? t('shell.runtimeExitedRecoveringAutomatically')
                    : host.state === 'stopping'
                      ? t('shell.stoppingRuntime')
                      : t('shell.runtimeIsNotReady')}
                </h2>
                {host.recovery ? (
                  <p className="stage-error">
                    {host.recovery.reason}
                    <br />
                    <span className="stage-recovery">
                      {recoverySeconds > 0
                        ? t('shell.recoveryCountdown', { attempt: host.recovery.attempt, max: host.recovery.maxAttempts, seconds: recoverySeconds })
                        : t('shell.recoveryStarting', { attempt: host.recovery.attempt, max: host.recovery.maxAttempts })}
                    </span>
                  </p>
                ) : (
                  <p className="stage-error">{host.error ?? runtime?.error ?? t('shell.startTheLocalHarnessServiceWithTheButton')}</p>
                )}
                <div className="stage-log">
                  {logs.slice(-6).map((line) => (
                    <div key={line.id} className={`stage-log-line ${line.stream}`}>
                      {line.text}
                    </div>
                  ))}
                </div>
                <div className="stage-actions">
                  <button className="button button-primary" disabled={!startup} onClick={() => { if (startup) void openWorkspace(startup.id) }}>
                    <Play size={15} />
                    {t('shell.startRuntime')}
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      void scanInstances()
                      setView('settings')
                      setSettingsSection('runtime')
                    }}
                    title={t('shell.viewLocalDshProcessesAndStopOneIf')}
                  >
                    <ListTree size={14} />
                    {t('shell.otherDshProcesses')}
                  </button>
                  {runtime?.state !== 'ready' ? (
                    <button className="button button-secondary" onClick={() => void installRuntime()}>
                      <Wrench size={14} />
                      {t('shell.installPortableRuntime')}
                    </button>
                  ) : null}
                  <button className="button button-subtle" onClick={() => void restartHost()}>
                    <RotateCcw size={14} />
                    {t('shell.restart')}
                  </button>
                  <button className="button button-subtle" onClick={() => setView('logs')}>
                    <ScrollText size={14} />
                    {t('shell.fullLogs')}
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
        <div className="workspace-footnote" title={currentPath}>
          <Loader2 size={11} className={activePane.loading || switching ? 'spin' : 'hidden'} />
          <span>{switching ? pending ? t('shell.opening132', { p0: pending.name }) : t('shell.openingWorkspace133') : currentPath ? shortPath(currentPath, 88) : t('shell.waitingForTheConversationToConfirmItsWorkspace')}</span>
        </div>
      ) : null}
    </div>
  )
}
