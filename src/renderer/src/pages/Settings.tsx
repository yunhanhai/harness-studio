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
import type { InsightsSettings, RuntimeSettings, UpdateResult } from '@shared/types'
import { ACCENTS, DOCS_URL, GITEE_URL, GITHUB_URL, RELEASES_URL } from '@shared/defaults'
import { useApp } from '../store'
import { sourceLabel } from '../lib/format'
import { Modal } from '../components/Modal'
import { BrandMark } from '../components/BrandMark'
import { GithubMark } from '../components/GithubMark'

type SectionId = 'general' | 'appearance' | 'insights' | 'runtime' | 'advanced' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'insights', label: '洞察', icon: BarChart3 },
  { id: 'runtime', label: '运行时', icon: Cpu },
  { id: 'advanced', label: '高级', icon: Terminal },
  { id: 'about', label: '关于', icon: Info }
]

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

  const saveRuntimeDraft = async (): Promise<void> => {    if (!runtimeDraft) return
    await saveSettings({ runtime: runtimeDraft })
    toast('运行时设置已保存', 'success')
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
    toast('高级设置已保存', 'success')
  }

  const checkUpdate = async (): Promise<void> => {
    setChecking(true)
    setProgress(0)
    setUpdate(await window.studio.studio.checkUpdates())
    setChecking(false)
  }

  const downloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    setProgress(0)
    const result = await window.studio.studio.downloadUpdate()
    setDownloading(false)
    setUpdate(result)
    if (result.status === 'available') toast('更新已下载，重启应用即可安装', 'success')
    else if (result.status === 'error') toast(result.message ?? '下载更新失败', 'error')
  }

  return (
    <div className="page settings-page">
      <header className="page-head settings-head">
        <div>
          <div className="eyebrow">
            <SlidersHorizontal size={13} />
            设置
          </div>
          <h1>把工作台调成你的样子</h1>
          <p>所有设置只保存在本机，不会同步到云端。</p>
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
          {active === 'general' ? (
            <>
              <Card title="启动" desc="控制应用如何开始新的一天。">
                <Row title="开机自动启动" desc="登录 Windows 后在后台启动 Harness Studio。">
                  <Toggle checked={settings.launchAtLogin} onChange={(value) => void saveSettings({ launchAtLogin: value })} />
                </Row>
                <Row title="启动时最小化" desc="启动后只保留托盘图标，不打断当前工作。">
                  <Toggle checked={settings.startMinimized} onChange={(value) => void saveSettings({ startMinimized: value })} />
                </Row>
                <Row title="自动检查更新" desc="启动后静默检查 GitHub 发布版本。">
                  <Toggle
                    checked={settings.checkUpdatesOnStart}
                    onChange={(value) => void saveSettings({ checkUpdatesOnStart: value })}
                  />
                </Row>
              </Card>

              <Card title="窗口行为" desc="决定点击关闭按钮时发生什么。">
                <Row title="关闭时隐藏到托盘" desc="会话和任务继续运行，可从托盘或快捷键找回窗口。">
                  <Toggle checked={settings.closeToTray} onChange={(value) => void saveSettings({ closeToTray: value })} />
                </Row>
                <Row title="最小化时隐藏到托盘" desc="保持任务栏干净，适合长期挂机。">
                  <Toggle
                    checked={settings.minimizeToTray}
                    onChange={(value) => void saveSettings({ minimizeToTray: value })}
                  />
                </Row>
              </Card>

              <Card title="默认工作区" desc="启动运行时和托盘「打开工作区」会优先使用它。">
                <Row title="当前工作区" stacked>
                  <select
                    className="input"
                    value={settings.lastWorkspaceId}
                    onChange={(event) => void saveSettings({ lastWorkspaceId: event.target.value })}
                  >
                    <option value="">未选择</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </Row>
              </Card>

              <Card title="全局快捷键" desc="在任何应用中都能唤出 Studio。使用 Electron 加速键格式，例如 CommandOrControl+Alt+H。">
                <Row title="显示 / 隐藏窗口" stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.toggleWindow}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, toggleWindow: event.target.value } })}
                  />
                </Row>
                <Row title="打开命令面板" stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.palette}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, palette: event.target.value } })}
                  />
                </Row>
                <Row title="全局快速提问" desc="在任何应用中呼出输入框，直接发送到当前 Harness 会话。" stacked>
                  <input
                    className="input mono"
                    defaultValue={settings.shortcuts.quickAsk}
                    onBlur={(event) => void saveSettings({ shortcuts: { ...settings.shortcuts, quickAsk: event.target.value } })}
                  />
                </Row>
              </Card>

              <Card title="快速提问" desc="控制全局快速提问窗口的行为。">
                <Row title="自动发送" desc="关闭后只把内容填入输入框，由你确认后按 Enter。">
                  <Toggle
                    checked={settings.quickAsk.autoSend}
                    onChange={(value) => void saveSettings({ quickAsk: { ...settings.quickAsk, autoSend: value } })}
                  />
                </Row>
                <Row title="发送后显示主窗口" desc="关闭后保持在原应用，Studio 只在后台完成发送。">
                  <Toggle
                    checked={settings.quickAsk.revealAfterSend}
                    onChange={(value) => void saveSettings({ quickAsk: { ...settings.quickAsk, revealAfterSend: value } })}
                  />
                </Row>
                <Row title="最近记录条数" desc={`当前 ${settings.quickAsk.recentLimit} 条`} stacked>
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
                title="发送确认"
                desc="内嵌界面按下回车就会立即发送，误触无法撤回。这里可以让 Studio 在发送前先问你一次。"
              >
                <Row title="每次发送前确认" desc="拦截回车与发送按钮，弹窗确认后才真正发出。">
                  <Toggle
                    checked={settings.composer.confirmSend}
                    onChange={(value) => void saveSettings({ composer: { ...settings.composer, confirmSend: value } })}
                  />
                </Row>
                <Row
                  title="发送会带上排队消息时额外提醒"
                  desc="队列里有待发消息时，本次发送会把它们一起提交；开启后会在确认框里明确指出条数。"
                >
                  <Toggle
                    checked={settings.composer.confirmQueued}
                    onChange={(value) => void saveSettings({ composer: { ...settings.composer, confirmQueued: value } })}
                  />
                </Row>
                <Row title="说明" stacked>
                  <div className="setting-desc">
                    拦截发生在内嵌界面内部（webview preload），依赖官方输入框结构；如果上游改版导致拦截失效，发送会退回原先的「直接发送」行为。
                  </div>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'appearance' ? (
            <>
              <Card title="主题" desc="跟随系统，或者固定为深色 / 浅色。">
                <div className="theme-grid">
                  {[
                    { id: 'system', label: '跟随系统', icon: Monitor },
                    { id: 'light', label: '浅色', icon: Sun },
                    { id: 'dark', label: '深色', icon: Moon }
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

              <Card title="强调色" desc="影响选中态、按钮与命令面板的高亮。">
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
                    <span>自定义</span>
                  </label>
                </div>
              </Card>

              <Card title="动效与缩放" desc="减少动效会让所有过渡立即完成。">
                <Row title="减少动态效果">
                  <Toggle checked={settings.reduceMotion} onChange={(value) => void saveSettings({ reduceMotion: value })} />
                </Row>
                <Row title="界面缩放" desc={`当前 ${Math.round(settings.zoomFactor * 100)}%`} stacked>
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
                      重置
                    </button>
                  </div>
                </Row>
              </Card>
            </>
          ) : null}

          {active === 'insights' ? (
            <>
              <Card
                title="价格"
                desc="用于估算会话洞察中的花费。单价按每 100 万 token 计算，全部填 0 则隐藏花费卡片。"
              >
                <Row title="未缓存输入（input）" stacked>
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
                <Row title="输出（output）" stacked>
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
                <Row title="缓存读取（cache read）" desc="命中缓存的输入通常远低于未缓存输入价格。" stacked>
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
                <Row title="货币">
                  <div className="segmented">
                    {(['CNY', 'USD'] as const).map((currency) => (
                      <button
                        key={currency}
                        className={insightsDraft?.currency === currency ? 'active' : ''}
                        onClick={() => insightsDraft && setInsightsDraft({ ...insightsDraft, currency })}
                      >
                        {currency === 'CNY' ? '¥ 人民币' : '$ 美元'}
                      </button>
                    ))}
                  </div>
                </Row>
                <div className="settings-save-row">
                  <button className="button button-ghost button-small" onClick={() => setInsightsDraft(settings.insights)}>
                    撤销
                  </button>
                  <button
                    className="button button-primary button-small"
                    onClick={async () => {
                      if (!insightsDraft) return
                      await saveSettings({ insights: insightsDraft })
                      toast('洞察设置已保存，重新扫描后生效', 'success')
                    }}
                  >
                    保存
                  </button>
                </div>
              </Card>

              <Card title="数据来源" desc="会话洞察只读取本机文件，不上传任何对话内容。">
                <Row title="会话目录" desc={info.dshHome}>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => void window.studio.app.openPath(info.dshHome)}
                  >
                    <FolderOpen size={14} />
                    打开
                  </button>
                </Row>
                <Row title="统计口径" desc="token 来自 DSH 的会话投影缓存；无缓存的会话退回解析日志头部。" stacked>
                  <div className="setting-desc">
                    会话数包含空会话；「有内容」只统计产生过回合的会话。每日趋势按会话最后活跃时间归入本地日历日。
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
                  {runtime?.state === 'ready' ? '运行时可用' : runtime?.state === 'missing' ? '未安装运行时' : '检测中'}
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
                    {runtime?.cliPath ?? '未找到 CLI'}
                  </span>
                </div>
                <div className="runtime-hero-actions">
                  <button className="button button-secondary button-small" onClick={() => void refreshRuntime()}>
                    <RefreshCw size={14} />
                    重新检测
                  </button>
                  <button
                    className="button button-primary button-small"
                    disabled={installing}
                    onClick={() => void installRuntime()}
                  >
                    <Download size={14} />
                    {installing ? '安装中…' : '安装便携运行时'}
                  </button>
                </div>
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
                      取消安装
                    </button>
                  </div>
                ) : null}
              </section>

              <Card title="运行时来源" desc="自动模式会依次查找内置便携运行时、npm 全局安装与 PATH。">
                <Row title="检测模式">
                  <div className="segmented">
                    {(['auto', 'custom'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={runtimeDraft?.mode === mode ? 'active' : ''}
                        onClick={() => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, mode })}
                      >
                        {mode === 'auto' ? '自动' : '自定义'}
                      </button>
                    ))}
                  </div>
                </Row>
                {runtimeDraft?.mode === 'custom' ? (
                  <Row title="CLI 路径" desc="指向 dsh 的 lib/bin.js、包目录或 dsh.cmd。" stacked>
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
                <Row title="Node.js 路径" desc="留空则自动查找。" stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.nodePath ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, nodePath: event.target.value })}
                    placeholder="C:\Program Files\nodejs\node.exe"
                  />
                </Row>
                <Row title="DSH_HOME" desc="会话、凭据与插件的存储位置。留空使用 ~/.dsh。" stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.dshHome ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, dshHome: event.target.value })}
                    placeholder="C:\Users\you\.dsh"
                  />
                </Row>
                <Row
                  title="配置档案"
                  desc="默认使用独立档案 studio（首次启动从 web 复制），避免与正在运行的 dsh web 争用同一 profile。填 web 表示直接共用。"
                  stacked
                >
                  <input
                    className="input mono"
                    value={runtimeDraft?.profile ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, profile: event.target.value })}
                    placeholder="studio"
                  />
                </Row>
                <Row title="端口" desc="0 表示让系统分配空闲端口，避免与已运行的 Web 实例冲突。" stacked>
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
                <Row title="启动 Studio 时自动启动运行时" desc="只对最近一次使用的工作区生效。">
                  <Toggle
                    checked={runtimeDraft?.autoStart ?? true}
                    onChange={(value) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, autoStart: value })}
                  />
                </Row>
                <div className="settings-save-row">
                  <button className="button button-ghost button-small" onClick={() => setRuntimeDraft(settings.runtime)}>
                    撤销
                  </button>
                  <button className="button button-primary button-small" onClick={() => void saveRuntimeDraft()}>
                    保存运行时设置
                  </button>
                </div>
              </Card>

              <Card
                title="其他 DSH 进程"
                desc="Harness 同一时间只允许一个进程写入某个 profile 或某个会话。出现「会话已被占用」或 profile 写入失败（EPERM）时，在这里看清是谁占着，并一键结束。"
              >
                <Row
                  title="扫描本机"
                  desc={
                    instances?.error
                      ? `扫描失败：${instances.error}`
                      : instances
                        ? `上次扫描：${new Date(instances.scannedAt).toLocaleTimeString('zh-CN', { hour12: false })} · 可见 ${instances.totalProcesses} 个进程`
                        : '尚未扫描'
                  }
                >
                  <button
                    className="button button-secondary button-small"
                    disabled={instancesLoading}
                    onClick={() => void scanInstances()}
                  >
                    <RefreshCw size={14} className={instancesLoading ? 'spin' : undefined} />
                    {instancesLoading ? '扫描中…' : '扫描'}
                  </button>
                </Row>
                {instances?.restricted ? (
                  <div className="instance-warning">
                    <AlertTriangle size={14} />
                    <span>
                      当前权限下只能看到本机的一部分进程，因此「没找到」并不代表真的没有。请用任务管理器确认，或手动退出其他 dsh web /
                      桌面端后重试。
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
                              {item.mode === 'web' ? 'Web 服务' : item.mode === 'cli' ? '命令行' : '其他'}
                            </span>
                            {item.self ? <span className="instance-badge is-self">Studio 自己的运行时</span> : null}
                          </span>
                          <span className="instance-command" title={item.commandLine}>
                            {item.commandLine}
                          </span>
                        </div>
                        <button
                          className="button button-ghost button-small"
                          disabled={item.self}
                          title={item.self ? '请用「重启运行时」' : '结束这个进程及其子进程'}
                          onClick={() => void killInstances([item.pid])}
                        >
                          结束
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Row title="结果">
                    <span className="setting-desc">
                      {instances
                        ? instances.restricted
                          ? '没有可用的结果。'
                          : '没有发现其他 DSH 进程。'
                        : '点击「扫描」查看正在运行的 DSH 进程。'}
                    </span>
                  </Row>
                )}
                {instances && instances.processes.some((item) => !item.self) ? (
                  <div className="settings-save-row">
                    <button
                      className="button button-primary button-small"
                      onClick={() => void killOtherDsh()}
                    >
                      结束所有其他 DSH 进程
                    </button>
                  </div>
                ) : null}
              </Card>

              <Card title="下载镜像" desc="网络受限时，可以替换为其他 npm / Node.js 镜像。">
                <Row title="npm registry" stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.registry ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, registry: event.target.value })}
                  />
                </Row>
                <Row title="Node.js 镜像" stacked>
                  <input
                    className="input mono"
                    value={runtimeDraft?.nodeMirror ?? ''}
                    onChange={(event) => runtimeDraft && setRuntimeDraft({ ...runtimeDraft, nodeMirror: event.target.value })}
                  />
                </Row>
                <div className="settings-save-row">
                  <button className="button button-primary button-small" onClick={() => void saveRuntimeDraft()}>
                    保存镜像设置
                  </button>
                </div>
              </Card>
            </>
          ) : null}

          {active === 'advanced' ? (
            <>
              <Card title="启动参数" desc="每行一个参数，追加到 dsh web 命令之后。">
                <Row title="额外参数" stacked>
                  <textarea
                    className="input mono"
                    rows={4}
                    value={argsDraft}
                    onChange={(event) => setArgsDraft(event.target.value)}
                    placeholder="--trusted-host app.example"
                  />
                </Row>
              </Card>

              <Card title="环境变量" desc="每行一个 KEY=VALUE，只在启动运行时时注入。">
                <Row title="变量" stacked>
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
                    保存高级设置
                  </button>
                </div>
              </Card>

              <Card title="数据与诊断" desc="所有数据都存放在本机。">
                <Row title="应用数据目录" desc={info.userData}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.app.openPath(info.userData)}>
                    <FolderOpen size={14} />
                    打开
                  </button>
                </Row>
                <Row title="日志目录" desc={info.logsDir}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.host.openLogsFolder()}>
                    <FolderOpen size={14} />
                    打开
                  </button>
                </Row>
                <Row title="DSH_HOME" desc={info.dshHome}>
                  <button className="button button-secondary button-small" onClick={() => void window.studio.app.openPath(info.dshHome)}>
                    <FolderOpen size={14} />
                    打开
                  </button>
                </Row>
              </Card>

              <Card title="危险操作" desc="这些操作会改变应用状态。">
                <Row title="重启应用" desc="关闭并重新打开 Harness Studio，运行时会一起重启。">
                  <button className="button button-secondary button-small" onClick={() => window.studio.studio.relaunch()}>
                    <RotateCcw size={14} />
                    重启
                  </button>
                </Row>
                <Row title="恢复默认设置" desc="保留工作区、提示词与会话数据。">
                  <button className="button button-danger button-small" onClick={() => setResetOpen(true)}>
                    恢复默认
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
                  <p className="about-tagline">DeepSeek Harness 的专属桌面工作台</p>
                  <div className="about-version">
                    v{info.version}
                    <span className="meta-dot" />
                    {info.isPackaged ? '正式版' : '开发版'}
                  </div>
                </div>
              </div>

              <div className="about-actions">
                <button className="button button-primary" onClick={() => void checkUpdate()} disabled={checking}>
                  {checking ? <RefreshCw size={15} className="spin" /> : <Zap size={15} />}
                  {checking ? '检查中…' : '检查更新'}
                </button>
                <button className="button button-secondary" onClick={() => void window.studio.app.openExternal(RELEASES_URL)}>
                  <Download size={15} />
                  发布版本
                </button>
                <button className="button button-ghost" onClick={() => void window.studio.app.openExternal(DOCS_URL)}>
                  <ArrowUpRight size={15} />
                  使用文档
                </button>
              </div>
              {update ? (
                <div className={`update-result update-${update.status}`}>
                  <Info size={15} />
                  <span>{update.message}</span>
                  {update.status === 'available' && update.downloaded ? (
                    <button className="button button-primary button-small" onClick={() => window.studio.studio.installUpdate()}>
                      重启并安装
                    </button>
                  ) : update.status === 'available' && update.canDownload ? (
                    <button
                      className="button button-primary button-small"
                      disabled={downloading}
                      onClick={() => void downloadUpdate()}
                    >
                      {downloading ? `下载中 ${Math.round(progress)}%` : '下载更新'}
                    </button>
                  ) : update.status === 'available' && update.url ? (
                    <button className="button button-primary button-small" onClick={() => void window.studio.app.openExternal(update.url!)}>
                      前往下载
                    </button>
                  ) : null}
                </div>
              ) : null}
              {downloading ? (
                <div className="update-progress">
                  <span style={{ width: `${Math.max(2, progress)}%` }} />
                </div>
              ) : null}

              <Card title="技术信息" desc="用于反馈问题时附上。">
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
                    <dt>平台</dt>
                    <dd className="mono">
                      {info.platform} / {info.arch}
                    </dd>
                  </div>
                </dl>
              </Card>

              <Card title="关于项目" desc="Harness Studio 是独立的开源桌面客户端，不是 DeepSeek 官方产品。">
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
                    MIT License · 数据仅保存在本地
                  </div>
                  <div>
                    <Wrench size={15} />
                    基于 DeepSeek Harness 的 Web 运行时构建
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
        title="恢复默认设置？"
        subtitle="工作区、提示词和会话数据不会被删除。"
        onClose={() => setResetOpen(false)}
        width={460}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setResetOpen(false)}>
              取消
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                void resetSettings()
                setResetOpen(false)
              }}
            >
              恢复默认
            </button>
          </>
        }
      >
        <p className="modal-text">主题、快捷键、运行时路径等设置会回到初始状态，应用会立即刷新外观。</p>
      </Modal>
    </div>
  )
}
