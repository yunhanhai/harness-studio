import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
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
import type { RuntimeSettings, UpdateResult } from '@shared/types'
import { ACCENTS, DOCS_URL, GITEE_URL, GITHUB_URL, RELEASES_URL } from '@shared/defaults'
import { useApp } from '../store'
import { sourceLabel } from '../lib/format'
import { Modal } from '../components/Modal'
import { BrandMark } from '../components/BrandMark'
import { GithubMark } from '../components/GithubMark'

type SectionId = 'general' | 'appearance' | 'runtime' | 'advanced' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'appearance', label: '外观', icon: Palette },
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

  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeSettings | null>(settings?.runtime ?? null)
  const [argsDraft, setArgsDraft] = useState(settings?.runtime.extraArgs.join('\n') ?? '')
  const [envDraft, setEnvDraft] = useState(
    Object.entries(settings?.runtime.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  )
  const [resetOpen, setResetOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateResult | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!runtimeDraft && settings) setRuntimeDraft(settings.runtime)
  }, [runtimeDraft, settings])

  if (!settings || !info) {
    return <div className="page" />
  }

  const active = (section as SectionId) || 'general'

  const saveRuntimeDraft = async (): Promise<void> => {
    if (!runtimeDraft) return
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
    setUpdate(await window.studio.studio.checkUpdates())
    setChecking(false)
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
                  {update.status === 'available' && update.url ? (
                    <button className="button button-primary button-small" onClick={() => void window.studio.app.openExternal(update.url!)}>
                      前往下载
                    </button>
                  ) : null}
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
