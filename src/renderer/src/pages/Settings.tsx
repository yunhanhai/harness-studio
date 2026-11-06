import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Wrench,
  Zap
} from 'lucide-react'
import type { ConversationFontSize, InsightsSettings, LanguageSetting, RuntimeSettings, UpdateResult } from '@shared/types'
import { ACCENTS, CONVERSATION_FONT_SIZES, DOCS_URL, GITEE_URL, GITHUB_URL, RELEASES_URL } from '@shared/defaults'
import { useApp } from '../store'
import { t as translateNow, useI18n } from '../lib/i18n'
import { sourceLabel } from '../lib/format'
import { Modal } from '../components/Modal'
import { BrandMark } from '../components/BrandMark'
import { GithubMark } from '../components/GithubMark'
import { ModelSetupChoices } from '../components/ModelSetup'

type SectionId = 'general' | 'appearance' | 'insights' | 'models' | 'runtime' | 'advanced' | 'about'

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

function Row({
  title,
  desc,
  children,
  stacked
}: {
  title: string
  desc?: string
  children: React.ReactNode
  stacked?: boolean
}): React.JSX.Element {
  return (
    <div className={`setting-row ${stacked ? 'stacked' : ''}`}>
      <div className="setting-copy">
        <div className="setting-title">{title}</div>
        {desc ? <div className="setting-desc">{desc}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="settings-card">
      <header className="settings-card-head">
        <h3>{title}</h3>
        {desc ? <p>{desc}</p> : null}
      </header>
      <div className="settings-card-body">{children}</div>
    </section>
  )
}

export function SettingsPage(): React.JSX.Element {
  const { locale, t } = useI18n()
  const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'general', label: t('pages.settings.general'), icon: SlidersHorizontal },
    { id: 'appearance', label: t('pages.settings.appearance'), icon: Palette },
    { id: 'insights', label: t('pages.settings.insights'), icon: BarChart3 },
    { id: 'models', label: t('models.title'), icon: Sparkles },
    { id: 'runtime', label: t('pages.settings.runtime'), icon: Cpu },
    { id: 'advanced', label: t('pages.settings.advanced'), icon: Terminal },
    { id: 'about', label: t('pages.settings.about'), icon: Info }
  ]
  const settings = useApp((state) => state.settings)
  const info = useApp((state) => state.info)
  const runtime = useApp((state) => state.runtime)
  const install = useApp((state) => state.install)
  const installing = useApp((state) => state.installing)
  const workspaces = useApp((state) => state.workspaces)
  const section = useApp((state) => state.settingsSection)
  const setSection = useApp((state) => state.setSettingsSection)
  const saveSettings = useApp((state) => state.saveSettings)
  const resetSettings = useApp((state) => state.resetSettings)
  const refreshRuntime = useApp((state) => state.refreshRuntime)
  const installRuntime = useApp((state) => state.installRuntime)
  const cancelInstall = useApp((state) => state.cancelInstall)
  const toast = useApp((state) => state.toast)
  const host = useApp((state) => state.host)
  const openModels = useApp((state) => state.openModels)
  const instances = useApp((state) => state.instances)
  const instancesLoading = useApp((state) => state.instancesLoading)
  const scanInstances = useApp((state) => state.scanInstances)
  const killInstances = useApp((state) => state.killInstances)
  const killOtherDsh = useApp((state) => state.killOtherDsh)

  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeSettings | null>(settings?.runtime ?? null)
  const [insightsDraft, setInsightsDraft] = useState<InsightsSettings | null>(settings?.insights ?? null)
  const [argsDraft, setArgsDraft] = useState(settings?.runtime.extraArgs.join('\n') ?? '')
  const [envDraft, setEnvDraft] = useState(
    Object.entries(settings?.runtime.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  )
  const [resetOpen, setResetOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [openingModels, setOpeningModels] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!runtimeDraft && settings) setRuntimeDraft(settings.runtime)
  }, [runtimeDraft, settings])

  useEffect(() => {
    if (!insightsDraft && settings) setInsightsDraft(settings.insights)
  }, [insightsDraft, settings])

  useEffect(() => window.studio.studio.onUpdateProgress((value) => setProgress(value.percent)), [])

  // Show the process list without an extra click: a profile/session conflict is
  // the reason most people open this section in the first place.
  const activeSection = (section as SectionId) || 'general'
  useEffect(() => {
    if (activeSection === 'runtime' && !instances && !instancesLoading) void scanInstances()
  }, [activeSection, instances, instancesLoading, scanInstances])

  if (!settings || !info) {
    return <div className="page" />
  }

  const active = (section as SectionId) || 'general'

  const saveRuntimeDraft = async (): Promise<void> => {
    if (!runtimeDraft) return
    await saveSettings({ runtime: runtimeDraft })
    await refreshRuntime()
    toast(translateNow('pages.settings.runtimeSaved'), 'success')
  }

  const saveAdvanced = async (): Promise<void> => {
    const args = argsDraft
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const env: Record<string, string> = {}
    for (const line of envDraft.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('=')) continue
      const index = trimmed.indexOf('=')
      env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
    }
    await saveSettings({ runtime: { ...settings.runtime, extraArgs: args, env } })
    toast(translateNow('pages.settings.advancedSaved'), 'success')
  }

  const checkUpdate = async (): Promise<void> => {
    setChecking(true)
    setProgress(0)
    setUpdate(await window.studio.studio.checkUpdates())
    setChecking(false)
  }

  const chooseModel = async (choice: 'models' | 'custom' | 'account' | 'later'): Promise<void> => {
    setOpeningModels(true)
    try {
      const result = await openModels(choice)
      if (result.status === 'opened') await saveSettings({ modelSetupSeen: true })
    } finally { setOpeningModels(false) }
  }

  const downloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    setProgress(0)
    const result = await window.studio.studio.downloadUpdate()
    setDownloading(false)
    setUpdate(result)
    if (result.status === 'available') toast(translateNow('pages.settings.updateReady'), 'success')
    else if (result.status === 'error') toast(result.message ?? translateNow('pages.settings.updateFailed'), 'error')
  }

  return (
    <div className="page settings-page">
      <header className="page-head settings-head">
        <div>
          <div className="eyebrow">
            <SlidersHorizontal size={13} />
            {t('pages.settings.title')}
          </div>
          <h1>{t('pages.settings.headline')}</h1>
          <p>{t('pages.settings.localSettings')}</p>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-nav">
          {SECTIONS.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`settings-nav-item ${active === item.id ? 'active' : ''}`}
                onClick={() => setSection(item.id)}
              >
                <Icon size={16} />
                {item.label}
                <ChevronRight size={13} className="settings-nav-arrow" />
              </button>
            )
          })}
          <div className="settings-nav-foot">
            <span>Harness Studio</span>
            <span className="mono">v{info.version}</span>
          </div>
        </aside>

        <div className="settings-content">
          {active === 'models' ? <Card title={t('models.title')} desc={t('models.subtitle')}>
            <ModelSetupChoices runtimeReady={host.state === 'ready'} busy={openingModels} onChoose={choice => void chooseModel(choice)} />
            <button className="button button-primary" disabled={openingModels || host.state !== 'ready'} onClick={() => void chooseModel('models')}>{t('models.open')}</button>
          </Card> : null}
          {active === 'general' ? (
            <>
              <Card title={t('pages.settings.language')} desc={t('pages.settings.languageDesc')}>
                <Row title={t('pages.settings.language')} stacked>
                  <select
                    className="input"
                    aria-label={t('pages.settings.language')}
                    value={settings.language}
                    onChange={(event) => void saveSettings({ language: event.target.value as LanguageSetting })}
                  >
                    <option value="system">{t('pages.settings.system')}</option>
                    <option value="zh-CN">中文</option>
                    <option value="en-US">English</option>
                  </select>
                </Row>
              </Card>

              <Card title={t('pages.settings.startup')} desc={t('pages.settings.startupDesc')}>
                <Row title={t('pages.settings.launchAtLogin')} desc={t('pages.settings.launchAtLoginDesc')}>
                  <Toggle checked={settings.launchAtLogin} onChange={(value) => void saveSettings({ launchAtLogin: value })} />
                </Row>
                <Row title={t('pages.settings.startMinimized')} desc={t('pages.settings.startMinimizedDesc')}>
                  <Toggle checked={settings.startMinimized} onChange={(value) => void saveSettings({ startMinimized: value })} />
                </Row>
                <Row title={t('pages.settings.autoUpdate')} desc={t('pages.settings.autoUpdateDesc')}>
                  <Toggle
                    checked={settings.checkUpdatesOnStart}
                    onChange={(value) => void saveSettings({ checkUpdatesOnStart: value })}
                  />
                </Row>
              </Card>

              <Card title={t('pages.settings.windowBehavior')} desc={t('pages.settings.windowBehaviorDesc')}>
                <Row title={t('pages.settings.closeToTray')} desc={t('pages.settings.closeToTrayDesc')}>
                  <Toggle checked={settings.closeToTray} onChange={(value) => void saveSettings({ closeToTray: value })} />
                </Row>
                <Row title={t('pages.settings.minimizeToTray')} desc={t('pages.settings.minimizeToTrayDesc')}>
                  <Toggle
                    checked={settings.minimizeToTray}
                    onChange={(value) => void saveSettings({ minimizeToTray: value })}
                  />
                </Row>
              </Card>

              <Card title={t('pages.settings.defaultWorkspace')} desc={t('pages.settings.defaultWorkspaceDesc')}>
                <Row title={t('pages.settings.currentWorkspace')} stacked>
                  <select
                    className="input"
                    value={settings.lastWorkspaceId}
                    onChange={(event) => void saveSettings({ lastWorkspaceId: event.target.value })}
                  >
                    <option value="">{t('pages.settings.notSelected')}</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </Row>
              </Card>

              <Card title={t('pages.settings.sessionTabs')} desc={t('pages.settings.sessionTabsDesc')}>
                <Row
                  title={t('pages.settings.tabLimit')}
                  desc={t('pages.settings.tabLimitDesc', { count: settings.tabs.limit })}
                  stacked
                >
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={8}
                    value={settings.tabs.limit}
                    onChange={(event) =>
                      void saveSettings({
                        tabs: { ...settings.tabs, limit: Number(event.target.value) }
                      })
                    }
                  />
                </Row>
                <Row title={t('pages.settings.shortcuts')} stacked>
                  <div className="setting-desc">
                    {t('pages.settings.tabShortcuts')}
                  </div>
                </Row>
                <Row title={t('pages.settings.note')} stacked>
                  <div className="setting-desc">
                    {t('pages.settings.tabNote')}
                  </div>
                </Row>
              </Card>

              <Card title={t('pages.settings.globalShortcuts')} desc={t('pages.settings.globalShortcutsDesc')}>
                <Row title={t('pages.settings.toggleWindow')} stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.toggleWindow}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, toggleWindow: event.target.value } })}
                  />
                </Row>
                <Row title={t('pages.settings.openPalette')} stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.palette}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, palette: event.target.value } })}
                  />
                </Row>
                <Row title={t('pages.settings.globalQuickAsk')} desc={t('pages.settings.globalQuickAskDesc')} stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.quickAsk}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, quickAsk: event.target.value } })}
                  />
                </Row>
              </Card>

              <Card title={t('pages.settings.quickAsk')} desc={t('pages.settings.quickAskDesc')}>
                <Row title={t('pages.settings.autoSend')} desc={t('pages.settings.autoSendDesc')}>
                  <Toggle
                    checked={settings.quickAsk.autoSend}
                    onChange={(value) => void saveSettings({ quickAsk: { ...settings.quickAsk, autoSend: value } })}
                  />
                </Row>
                <Row title={t('pages.settings.revealAfterSend')} desc={t('pages.settings.revealAfterSendDesc')}>
                  <Toggle
                    checked={settings.quickAsk.revealAfterSend}
                    onChange={(value) => void saveSettings({ quickAsk: { ...settings.quickAsk, revealAfterSend: value } })}
                  />
                </Row>
                <Row title={t('pages.settings.recentLimit')} desc={t('pages.settings.recentLimitDesc', { count: settings.quickAsk.recentLimit })} stacked>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={20}
                    value={settings.quickAsk.recentLimit}
                    onChange={(event) =>
                      void saveSettings({
                        quickAsk: { ...settings.quickAsk, recentLimit: Number(event.target.value) }
                      })
                    }
                  />
                </Row>
              </Card>

              <Card
                title={t('pages.settings.sendConfirmation')}
                desc={t('pages.settings.sendConfirmationDesc')}
              >
                <Row title={t('pages.settings.confirmEachSend')} desc={t('pages.settings.confirmEachSendDesc')}>
                  <Toggle
                    checked={settings.composer.confirmSend}
                    onChange={(value) => void saveSettings({ composer: { ...settings.composer, confirmSend: value } })}
                  />
                </Row>
                <Row
                  title={t('pages.settings.confirmQueued')}
                  desc={t('pages.settings.confirmQueuedDesc')}
                >
                  <Toggle
                    checked={settings.composer.confirmQueued}
                    onChange={(value) => void saveSettings({ composer: { ...settings.composer, confirmQueued: value } })}
                  />
                </Row>
                <Row title={t('pages.settings.note')} stacked>
                  <div className="setting-desc">
                    {t('pages.settings.confirmationNote')}
                  </div>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'appearance' ? (
            <>
              <Card title={t('pages.settings.theme')} desc={t('pages.settings.themeDesc')}>
                <div className="theme-grid">
                  {[
                    { id: 'system', label: t('pages.settings.system'), icon: Monitor },
                    { id: 'light', label: t('pages.settings.light'), icon: Sun },
                    { id: 'dark', label: t('pages.settings.dark'), icon: Moon }
                  ].map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        className={`theme-option theme-${item.id} ${settings.theme === item.id ? 'active' : ''}`}
                        onClick={() => void saveSettings({ theme: item.id as 'system' | 'light' | 'dark' })}
                      >
                        <div className="theme-preview">
                          <span className="theme-preview-bar" />
                          <span className="theme-preview-rail" />
                          <span className="theme-preview-line" />
                          <span className="theme-preview-line short" />
                        </div>
                        <div className="theme-option-label">
                          <Icon size={14} />
                          {item.label}
                          {settings.theme === item.id ? <Check size={14} className="theme-check" /> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Card>

              <Card title={t('pages.settings.accent')} desc={t('pages.settings.accentDesc')}>
                <div className="accent-row">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      className={`accent-swatch ${settings.accent.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => void saveSettings({ accent: color })}
                      title={color}
                    >
                      {settings.accent.toLowerCase() === color.toLowerCase() ? <Check size={14} /> : null}
                    </button>
                  ))}
                  <label className="accent-custom">
                    <input
                      type="color"
                      value={settings.accent}
                      onChange={(event) => void saveSettings({ accent: event.target.value })}
                    />
                    <span>{t('pages.settings.custom')}</span>
                  </label>
                </div>
              </Card>

              <Card title={t('pages.settings.conversationReading')} desc={t('pages.settings.conversationReadingDesc')}>
                <Row title={t('pages.settings.conversationFontSize')} stacked>
                  <div className="slider-row">
                    <select
                      className="input"
                      aria-label={t('pages.settings.conversationFontSize')}
                      value={settings.conversationFontSize}
                      onChange={(event) => void saveSettings({ conversationFontSize: Number(event.target.value) as ConversationFontSize })}
                    >
                      {CONVERSATION_FONT_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size === 0 ? t('pages.settings.followHarness') : `${size} px`}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button button-ghost button-small"
                      onClick={() => void saveSettings({ conversationFontSize: 0 })}
                      disabled={settings.conversationFontSize === 0}
                    >
                      {t('pages.settings.reset')}
                    </button>
                  </div>
                </Row>
              </Card>

              <Card title={t('pages.settings.motionZoom')} desc={t('pages.settings.motionZoomDesc')}>
                <Row title={t('pages.settings.reduceMotion')}>
                  <Toggle checked={settings.reduceMotion} onChange={(value) => void saveSettings({ reduceMotion: value })} />
                </Row>
                <Row title={t('pages.settings.zoom')} desc={t('pages.settings.zoomDesc', { percent: Math.round(settings.zoomFactor * 100) })} stacked>
                  <div className="slider-row">
                    <input
                      type="range"
                      min={0.8}
                      max={1.4}
                      step={0.05}
                      value={settings.zoomFactor}
                      onChange={(event) => void saveSettings({ zoomFactor: Number(event.target.value) })}
                    />
                    <button className="button button-ghost button-small" onClick={() => void saveSettings({ zoomFactor: 1 })}>
                      {t('pages.settings.reset')}
                    </button>
                  </div>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'insights' ? (
            <>
              <Card
                title={t('pages.settings.pricing')}
                desc={t('pages.settings.pricingDesc')}
              >
                <Row title={t('pages.settings.inputPrice')} stacked>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    step={0.1}
                    value={insightsDraft?.inputPrice ?? 0}
                    onChange={(event) =>
                      insightsDraft && setInsightsDraft({ ...insightsDraft, inputPrice: Number(event.target.value) })
                    }
                  />
                </Row>
                <Row title={t('pages.settings.outputPrice')} stacked>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    step={0.1}
                    value={insightsDraft?.outputPrice ?? 0}
                    onChange={(event) =>
                      insightsDraft && setInsightsDraft({ ...insightsDraft, outputPrice: Number(event.target.value) })
                    }
                  />
                </Row>
                <Row title={t('pages.settings.cachePrice')} desc={t('pages.settings.cachePriceDesc')} stacked>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    step={0.1}
                    value={insightsDraft?.cacheReadPrice ?? 0}
                    onChange={(event) =>
                      insightsDraft && setInsightsDraft({ ...insightsDraft, cacheReadPrice: Number(event.target.value) })
                    }
                  />
                </Row>
                <Row title={t('pages.settings.currency')}>
                  <div className="segmented">
                    {(['CNY', 'USD'] as const).map((currency) => (
                      <button
                        key={currency}
                        className={insightsDraft?.currency === currency ? 'active' : ''}
                        onClick={() => insightsDraft && setInsightsDraft({ ...insightsDraft, currency })}
                      >
                        {currency === 'CNY' ? t('pages.settings.cny') : t('pages.settings.usd')}
                      </button>
                    ))}
                  </div>
                </Row>
                <div className="settings-save-row">
                  <button className="button button-ghost button-small" onClick={() => setInsightsDraft(settings.insights)}>
                    {t('pages.settings.revert')}
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={async () => {
                      if (!insightsDraft) return
                      await saveSettings({ insights: insightsDraft })
                      toast(translateNow('pages.settings.insightsSaved'), 'success')
                    }}
                  >
                    {t('pages.settings.save')}
                  </button>
                </div>
              </Card>

              <Card title={t('pages.settings.dataSource')} desc={t('pages.settings.dataSourceDesc')}>
                <Row title={t('pages.settings.sessionDirectory')} desc={info.dshHome}>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => void window.studio.app.openPath(info.dshHome)}
                  >
                    <FolderOpen size={14} />
                    {t('pages.settings.open')}
                  </button>
                </Row>
                <Row title={t('pages.settings.counting')} desc={t('pages.settings.countingDesc')} stacked>
                  <div className="setting-desc">
                    {t('pages.settings.countingNote')}
                  </div>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'runtime' ? (
            <>
              <section className="runtime-hero">
                <div className={`runtime-hero-status ${runtime?.state === 'ready' ? 'ok' : ''}`}>
                  <span className="status-dot" />
                  {runtime?.state === 'ready' ? t('pages.settings.runtimeReady') : runtime?.state === 'missing' ? t('pages.settings.runtimeMissing') : runtime?.state === 'error' ? t('pages.settings.runtimeError') : t('pages.settings.checking')}
                </div>
                <div className="runtime-hero-title">
                  dsh {runtime?.version ?? '—'}
                  <span className="runtime-hero-source">{sourceLabel(runtime?.source)}</span>
                </div>
                <div className="runtime-hero-meta">
                  <span>Node {runtime?.nodeVersion ?? '—'}</span>
                  <span className="meta-dot" />
                  <span className="mono">profile: {settings.runtime.profile || 'studio'}</span>
                  <span className="meta-dot" />
                  <span className="mono ellipsis" title={runtime?.cliPath ?? ''}>
                    {runtime?.cliPath ?? t('pages.settings.cliMissing')}
                  </span>
                </div>
                <div className="runtime-hero-actions">
                  <button className="button button-secondary button-small" onClick={() => void refreshRuntime()}>
                    <RefreshCw size={14} />
                    {t('pages.settings.detectAgain')}
                  </button>
                  <button
                    className="button button-primary button-small"
                    disabled={installing}
                    onClick={() => void installRuntime()}
                  >
                    <Download size={14} />
                    {installing ? t('pages.settings.installing') : t('pages.settings.installPortable')}
                  </button>
                </div>
                {runtime?.error ? <p className="panel-callout" role="alert">{runtime.error}</p> : null}
                {installing && install ? (
                  <div className="runtime-install">
                    <div className="runtime-install-head">
                      <span>{install.message}</span>
                      <span>{install.percent}%</span>
                    </div>
                    <div className="install-track">
                      <span style={{ width: `${install.percent}%` }} />
                    </div>
                    {install.detail ? <div className="runtime-install-detail">{install.detail}</div> : null}
                    <button className="button button-ghost button-small" onClick={() => void cancelInstall()}>
                      {t('pages.settings.cancelInstall')}
                    </button>
                  </div>
                ) : null}
              </section>

              <Card title={t('pages.settings.runtimeSource')} desc={t('pages.settings.runtimeSourceDesc')}>
                <Row title={t('pages.settings.detectMode')}>
                  <div className="segmented">
                    {(['auto', 'custom'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={runtimeDraft?.mode === mode ? 'active' : ''}
                        onClick={() => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, mode })}
                      >
                        {mode === 'auto' ? t('pages.settings.auto') : t('pages.settings.custom')}
                      </button>
                    ))}
                  </div>
                </Row>
                {runtimeDraft?.mode === 'custom' ? (
                  <Row title={t('pages.settings.cliPath')} desc={t('pages.settings.cliPathDesc')} stacked>
                    <input
                      className="input mono"
                      value={runtimeDraft.customPath}
                      onChange={(event) =>
                        setRuntimeDraft({ ...runtimeDraft, customPath: event.target.value })
                      }
                      placeholder="D:\tools\dsh\lib\bin.js"
                    />
                  </Row>
                ) : null}
                <Row title={t('pages.settings.nodePath')} desc={t('pages.settings.nodePathDesc')} stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.nodePath ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, nodePath: event.target.value })}
                    placeholder="C:\Program Files\nodejs\node.exe"
                  />
                </Row>
                <Row title="DSH_HOME" desc={t('pages.settings.dshHomeDesc')} stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.dshHome ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, dshHome: event.target.value })}
                    placeholder="C:\Users\you\.dsh"
                  />
                </Row>
                <Row
                  title={t('pages.settings.profile')}
                  desc={t('pages.settings.profileDesc')}
                  stacked
                >
                  <input
                    className="input mono"
                    value={runtimeDraft?.profile ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, profile: event.target.value })}
                    placeholder="studio"
                  />
                </Row>
                <Row title={t('pages.settings.port')} desc={t('pages.settings.portDesc')} stacked>
                  <input
                    className="input mono"
                    type="number"
                    min={0}
                    max={65535}
                    value={runtimeDraft?.port ?? 0}
                    onChange={(event) =>
                      runtimeDraft && setRuntimeDraft({ ...runtimeDraft, port: Number(event.target.value) })
                    }
                  />
                </Row>
                <Row title={t('pages.settings.autoStartRuntime')} desc={t('pages.settings.autoStartRuntimeDesc')}>
                  <Toggle
                    checked={runtimeDraft?.autoStart ?? true}
                    onChange={(value) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, autoStart: value })}
                  />
                </Row>
                <div className="settings-save-row">
                  <button className="button button-ghost button-small" onClick={() => setRuntimeDraft(settings.runtime)}>
                    {t('pages.settings.revert')}
                  </button>
                  <button className="button button-primary button-small" onClick={() => void saveRuntimeDraft()}>
                    {t('pages.settings.saveRuntime')}
                  </button>
                </div>
              </Card>

              <Card
                title={t('pages.settings.otherProcesses')}
                desc={t('pages.settings.otherProcessesDesc')}
              >
                <Row
                  title={t('pages.settings.scanDevice')}
                  desc={
                    instances?.error
                      ? t('pages.settings.scanFailed', { error: instances.error })
                      : instances
                        ? t('pages.settings.scanSummary', { time: new Date(instances.scannedAt).toLocaleTimeString(locale, { hour12: false }), count: instances.totalProcesses })
                        : t('pages.settings.notScanned')
                  }
                >
                  <button
                    className="button button-secondary button-small"
                    disabled={instancesLoading}
                    onClick={() => void scanInstances()}
                  >
                    <RefreshCw size={14} className={instancesLoading ? 'spin' : undefined} />
                    {instancesLoading ? t('pages.settings.scanning') : t('pages.settings.scan')}
                  </button>
                </Row>
                {instances?.restricted ? (
                  <div className="instance-warning">
                    <AlertTriangle size={14} />
                    <span>
                      {t('pages.settings.restrictedProcesses')}
                    </span>
                  </div>
                ) : null}
                {instances && instances.processes.length > 0 ? (
                  <ul className="instance-list">
                    {instances.processes.map((item) => (
                      <li key={item.pid} className={`instance-row ${item.self ? 'is-self' : ''}`}>
                        <span className={`instance-dot ${item.self ? 'self' : ''}`} />
                        <div className="instance-copy">
                          <span className="instance-title">
                            PID {item.pid}
                            <span className="instance-badge">profile: {item.profile}</span>
                            <span className="instance-badge">
                              {item.mode === 'web' ? t('pages.settings.webService') : item.mode === 'cli' ? t('pages.settings.commandLine') : t('pages.settings.other')}
                            </span>
                            {item.self ? <span className="instance-badge is-self">{t('pages.settings.ownRuntime')}</span> : null}
                          </span>
                          <span className="instance-command" title={item.commandLine}>
                            {item.commandLine}
                          </span>
                        </div>
                        <button
                          className="button button-ghost button-small"
                          disabled={item.self}
                          title={item.self ? t('pages.settings.restartInstead') : t('pages.settings.stopProcessHint')}
                          onClick={() => void killInstances([item.pid])}
                        >
                          {t('pages.settings.stop')}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Row title={t('pages.settings.result')}>
                    <span className="setting-desc">
                      {instances
                        ? instances.restricted
                          ? t('pages.settings.noResults')
                          : t('pages.settings.noOtherProcesses')
                        : t('pages.settings.scanHint')}
                    </span>
                  </Row>
                )}
                {instances && instances.processes.some((item) => !item.self) ? (
                  <div className="settings-save-row">
                    <button
                      className="button button-primary button-small"
                      onClick={() => void killOtherDsh()}
                    >
                      {t('pages.settings.stopOtherProcesses')}
                    </button>
                  </div>
                ) : null}
              </Card>

              <Card title={t('pages.settings.mirrors')} desc={t('pages.settings.mirrorsDesc')}>
                <Row title="npm registry" stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.registry ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, registry: event.target.value })}
                  />
                </Row>
                <Row title={t('pages.settings.nodeMirror')} stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.nodeMirror ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, nodeMirror: event.target.value })}
                  />
                </Row>
                <div className="settings-save-row">
                  <button className="button button-primary button-small" onClick={() => void saveRuntimeDraft()}>
                    {t('pages.settings.saveMirrors')}
                  </button>
                </div>
              </Card>
            </>
          ) : null}

          {active === 'advanced' ? (
            <>
              <Card title={t('pages.settings.startupArgs')} desc={t('pages.settings.startupArgsDesc')}>
                <Row title={t('pages.settings.extraArgs')} stacked>
                  <textarea
                    className="input mono"
                    rows={4}
                    value={argsDraft}
                    onChange={(event) => setArgsDraft(event.target.value)}
                    placeholder="--trusted-host app.example"
                  />
                </Row>
              </Card>

              <Card title={t('pages.settings.environment')} desc={t('pages.settings.environmentDesc')}>
                <Row title={t('pages.settings.variables')} stacked>
                  <textarea
                    className="input mono"
                    rows={4}
                    value={envDraft}
                    onChange={(event) => setEnvDraft(event.target.value)}
                    placeholder="DEEPSEEK_API_KEY=sk-…"
                  />
                </Row>
                <div className="settings-save-row">
                  <button className="button button-primary button-small" onClick={() => void saveAdvanced()}>
                    {t('pages.settings.saveAdvanced')}
                  </button>
                </div>
              </Card>

              <Card title={t('pages.settings.dataDiagnostics')} desc={t('pages.settings.dataDiagnosticsDesc')}>
                <Row title={t('pages.settings.appData')} desc={info.userData}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.app.openPath(info.userData)}>
                    <FolderOpen size={14} />
                    {t('pages.settings.open')}
                  </button>
                </Row>
                <Row title={t('pages.settings.logsDirectory')} desc={info.logsDir}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.host.openLogsFolder()}>
                    <FolderOpen size={14} />
                    {t('pages.settings.open')}
                  </button>
                </Row>
                <Row title="DSH_HOME" desc={info.dshHome}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.app.openPath(info.dshHome)}>
                    <FolderOpen size={14} />
                    {t('pages.settings.open')}
                  </button>
                </Row>
              </Card>

              <Card title={t('pages.settings.dangerous')} desc={t('pages.settings.dangerousDesc')}>
                <Row title={t('pages.settings.restartApp')} desc={t('pages.settings.restartAppDesc')}>
                  <button className="button button-secondary button-small" onClick={() => window.studio.studio.relaunch()}>
                    <RotateCcw size={14} />
                    {t('pages.settings.restart')}
                  </button>
                </Row>
                <Row title={t('pages.settings.restoreSettings')} desc={t('pages.settings.restoreSettingsDesc')}>
                  <button className="button button-danger button-small" onClick={() => setResetOpen(true)}>
                    {t('pages.settings.restoreDefaults')}
                  </button>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'about' ? (
            <div className="about">
              <div className="about-hero">
                <div className="about-mark">
                  <BrandMark size={56} />
                </div>
                <div>
                  <h2>Harness Studio</h2>
                  <p className="about-tagline">{t('pages.settings.tagline')}</p>
                  <div className="about-version">
                    v{info.version}
                    <span className="meta-dot" />
                    {info.isPackaged ? t('pages.settings.releaseBuild') : t('pages.settings.developmentBuild')}
                  </div>
                </div>
              </div>

              <div className="about-actions">
                <button className="button button-primary" onClick={() => void checkUpdate()} disabled={checking}>
                  {checking ? <RefreshCw size={15} className="spin" /> : <Zap size={15} />}
                  {checking ? t('pages.settings.checkingUpdates') : t('pages.settings.checkUpdates')}
                </button>
                <button className="button button-secondary" onClick={() => void window.studio.app.openExternal(RELEASES_URL)}>
                  <Download size={15} />
                  {t('pages.settings.releases')}
                </button>
                <button className="button button-ghost" onClick={() => void window.studio.app.openExternal(DOCS_URL)}>
                  <ArrowUpRight size={15} />
                  {t('pages.settings.docs')}
                </button>
              </div>
              {update ? (
                <div className={`update-result update-${update.status}`}>
                  <Info size={15} />
                  <span>{update.message}</span>
                  {update.status === 'available' && update.downloaded ? (
                    <button className="button button-primary button-small" onClick={() => window.studio.studio.installUpdate()}>
                      {t('pages.settings.restartInstall')}
                    </button>
                  ) : update.status === 'available' && update.canDownload ? (
                    <button
                      className="button button-primary button-small"
                      disabled={downloading}
                      onClick={() => void downloadUpdate()}
                    >
                      {downloading ? t('pages.settings.downloadProgress', { percent: Math.round(progress) }) : t('pages.settings.downloadUpdate')}
                    </button>
                  ) : update.status === 'available' && update.url ? (
                    <button className="button button-primary button-small" onClick={() => void window.studio.app.openExternal(update.url!)}>
                      {t('pages.settings.goDownload')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {downloading ? (
                <div className="update-progress">
                  <span style={{ width: `${Math.max(2, progress)}%` }} />
                </div>
              ) : null}

              <Card title={t('pages.settings.technicalInfo')} desc={t('pages.settings.technicalInfoDesc')}>
                <dl className="kv-list about-kv">
                  <div>
                    <dt>Electron</dt>
                    <dd className="mono">{info.electron}</dd>
                  </div>
                  <div>
                    <dt>Chromium</dt>
                    <dd className="mono">{info.chrome}</dd>
                  </div>
                  <div>
                    <dt>Node.js</dt>
                    <dd className="mono">{info.node}</dd>
                  </div>
                  <div>
                    <dt>{t('pages.settings.platform')}</dt>
                    <dd className="mono">
                      {info.platform} / {info.arch}
                    </dd>
                  </div>
                </dl>
              </Card>

              <Card title={t('pages.settings.aboutProject')} desc={t('pages.settings.aboutProjectDesc')}>
                <div className="about-links">
                  <button onClick={() => void window.studio.app.openExternal(GITHUB_URL)}>
                    <GithubMark size={15} />
                    GitHub
                    <ExternalLink size={12} />
                  </button>
                  <button onClick={() => void window.studio.app.openExternal(GITEE_URL)}>
                    <GithubMark size={15} />
                    Gitee
                    <ExternalLink size={12} />
                  </button>
                  <button onClick={() => void window.studio.app.openExternal('https://github.com/deepseek-ai/deepseek-harness')}>
                    <Sparkles size={15} />
                    DeepSeek Harness
                    <ExternalLink size={12} />
                  </button>
                </div>
                <div className="about-notes">
                  <div>
                    <ShieldCheck size={15} />
                    {t('pages.settings.licenseLocal')}
                  </div>
                  <div>
                    <Wrench size={15} />
                    {t('pages.settings.builtOn')}
                  </div>
                  <div>
                    <Cpu size={15} />
                    Electron + React + TypeScript
                  </div>
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={resetOpen}
        title={t('pages.settings.resetTitle')}
        subtitle={t('pages.settings.resetSubtitle')}
        onClose={() => setResetOpen(false)}
        width={460}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setResetOpen(false)}>
              {t('pages.settings.cancel')}
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                void resetSettings()
                setResetOpen(false)
              }}
            >
              {t('pages.settings.restoreDefaults')}
            </button>
          </>
        }
      >
        <p className="modal-text">{t('pages.settings.resetDetail')}</p>
      </Modal>
    </div>
  )
}
