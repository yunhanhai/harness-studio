import { applyLanguage, t as translateNow, useI18n } from '../lib/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleStop,
  Command,
  Download,
  FolderPlus,
  LayoutDashboard,
  MessagesSquare,
  Moon,
  Play,
  Puzzle,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
  Sparkles,
  SquarePlus,
  SquareX,
  Sun,
  Zap
} from 'lucide-react'
import type { PromptItem, Settings, ViewId, Workspace } from '@shared/types'
import { GITHUB_URL } from '@shared/defaults'
import { GithubMark } from './GithubMark'

interface PaletteItem {
  id: string
  group: string
  title: string
  subtitle?: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  keywords?: string
  run: () => void | Promise<void>
}

const ICONS = {
  home: LayoutDashboard,
  workspace: MessagesSquare,
  insights: BarChart3,
  prompts: Sparkles,
  logs: ScrollText,
  skills: BookOpen,
  settings: Settings2
}

export default function Palette(): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    document.body.classList.add('palette-body')
    const api = window.studio
    let systemLocale = navigator.language
    let currentSettings: Settings | null = null
    let disposed = false
    const updateSettings = (value: Settings): void => {
      currentSettings = value
      applyLanguage(value.language, systemLocale)
      setSettings(value)
    }
    void Promise.all([api.app.info(), api.settings.get(), api.workspaces.list(), api.prompts.list()]).then(
      ([info, settingsValue, workspaceValue, promptValue]) => {
        if (disposed) return
        systemLocale = info.systemLocale ?? navigator.language
        updateSettings(currentSettings ?? settingsValue)
        setWorkspaces(workspaceValue)
        setPrompts(promptValue)
      }
    )
    const offSettings = api.settings.onChange(updateSettings)
    const offPrompts = api.prompts.onChange(setPrompts)
    const offWorkspaces = api.workspaces.onChange(setWorkspaces)
    inputRef.current?.focus()
    return () => {
      disposed = true
      offSettings()
      offPrompts()
      offWorkspaces()
    }
  }, [])

  useEffect(() => {
    const reset = (): void => {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    const listener = (): void => reset()
    window.addEventListener('focus', listener)
    return () => window.removeEventListener('focus', listener)
  }, [])

  const close = (): void => window.studio.studio.closePalette()

  const navigate = (view: ViewId): void => {
    window.studio.studio.runAction({ type: 'navigate', view })
  }

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [
      {
        id: 'nav-home',
        group: t('shell.navigation'),
        title: t('shell.home'),
        subtitle: t('shell.overviewAndRecentWorkspaces'),
        icon: ICONS.home,
        keywords: 'home dashboard start 启动台 总览 最近工作区',
        run: () => navigate('home')
      },
      {
        id: 'nav-workspace',
        group: t('shell.navigation'),
        title: workspaces[0] ? t('shell.openWorkspace', { p0: workspaces[0].name }) : t('shell.workspace'),
        subtitle: t('shell.openTheHarnessConversationInterface'),
        icon: ICONS.workspace,
        keywords: 'workspace chat session 工作区 会话',
        run: () => window.studio.studio.runAction({ type: 'open-workspace' })
      },
      {
        id: 'action-new-tab',
        group: t('shell.navigation'),
        title: t('shell.newSessionTab'),
        subtitle: t('shell.openAnotherSessionAlongsideThisOneCtrlT'),
        icon: SquarePlus,
        keywords: 'tab new session 标签 新建',
        run: () => window.studio.studio.runAction({ type: 'new-tab' })
      },
      {
        id: 'action-close-tab',
        group: t('shell.navigation'),
        title: t('shell.closeCurrentSessionTab'),
        subtitle: t('shell.closeThisViewWhileKeepingItsSessionCtrl'),
        icon: SquareX,
        keywords: 'tab close session 标签 关闭',
        run: () => window.studio.studio.runAction({ type: 'close-tab' })
      },
      {
        id: 'nav-insights',
        group: t('shell.navigation'),
        title: t('shell.sessionInsights'),
        subtitle: t('shell.tokenUsageCacheHitsAndDailyTrends'),
        icon: ICONS.insights,
        keywords: 'insights tokens usage stats analytics 统计 用量',
        run: () => window.studio.studio.runAction({ type: 'open-insights' })
      },
      {
        id: 'nav-prompts',
        group: t('shell.navigation'),
        title: t('shell.promptLibrary'),
        subtitle: t('shell.copyAndReuseYourInstructions'),
        icon: ICONS.prompts,
        keywords: 'prompt library 提示词库 提示词 指令',
        run: () => navigate('prompts')
      },
      {
        id: 'nav-logs',
        group: t('shell.navigation'),
        title: t('shell.runtimeLogs'),
        subtitle: t('shell.viewLocalServiceOutput'),
        icon: ICONS.logs,
        keywords: 'logs console output 运行日志 本地服务输出',
        run: () => navigate('logs')
      },
      {
        id: 'nav-skills',
        group: t('shell.navigation'),
        title: t('skills.title'),
        subtitle: t('skills.subtitle'),
        icon: ICONS.skills,
        keywords: 'skill skills 技能 管理 本地 导入 插件 精选',
        run: () => navigate('skills')
      },
      {
        id: 'nav-models',
        group: t('shell.navigation'),
        title: t('models.title'),
        subtitle: t('models.subtitle'),
        icon: Settings2,
        keywords: 'model custom api login 模型 自定义 免登录',
        run: () => window.studio.studio.runAction({ type: 'open-models' })
      },
      {
        id: 'nav-settings',
        group: t('shell.navigation'),
        title: t('shell.settings'),
        subtitle: t('shell.appearanceRuntimeAndShortcuts'),
        icon: ICONS.settings,
        keywords: 'settings preferences 设置 快捷键',
        run: () => window.studio.studio.runAction({ type: 'open-settings' })
      },
      {
        id: 'action-restart',
        group: t('shell.runtime'),
        title: t('shell.restartHarnessRuntime'),
        subtitle: t('shell.thisAffectsSessionsCurrentlyRunningInStudio'),
        icon: RefreshCw,
        keywords: 'restart host runtime 重启 运行时',
        run: () => window.studio.studio.runAction({ type: 'restart-host' })
      },
      {
        id: 'action-plugins',
        group: t('shell.runtime'),
        title: t('shell.openPluginManager'),
        subtitle: t('shell.openPluginManagerDesc'),
        icon: Puzzle,
        keywords: 'plugins plugin manager extensions 插件 管理 扩展',
        run: () => window.studio.studio.runAction({ type: 'open-plugins' })
      },
      {
        id: 'action-stop',
        group: t('shell.runtime'),
        title: t('shell.stopRuntime'),
        subtitle: t('shell.freeThePortAndLocalProcess'),
        icon: CircleStop,
        keywords: 'stop host runtime 停止 运行时',
        run: () => window.studio.studio.runAction({ type: 'stop-host' })
      },
      {
        id: 'action-start',
        group: t('shell.runtime'),
        title: t('shell.startRuntime'),
        subtitle: t('shell.useTheMostRecentWorkspace'),
        icon: Play,
        keywords: 'start host runtime 启动 运行时',
        run: () => window.studio.studio.runAction({ type: 'start-host' })
      },
      {
        id: 'action-install',
        group: t('shell.runtime'),
        title: t('shell.installPortableRuntime'),
        subtitle: t('shell.downloadNodeJsAndInstallDsh'),
        icon: Download,
        keywords: 'install runtime node 安装 便携运行时',
        run: () => window.studio.studio.runAction({ type: 'open-settings', section: 'runtime' })
      },
      {
        id: 'action-theme',
        group: t('shell.appearance'),
        title: t('shell.toggleDarkLightTheme'),
        subtitle: settings?.theme === 'dark' ? t('shell.currentDark') : t('shell.currentLight'),
        icon: settings?.theme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light appearance 主题 深色 浅色 外观',
        run: () => window.studio.studio.runAction({ type: 'toggle-theme' })
      },
      {
        id: 'action-update',
        group: t('shell.about'),
        title: t('shell.checkForUpdates'),
        subtitle: t('shell.getTheLatestVersionFromGithubReleases'),
        icon: Zap,
        keywords: 'update upgrade version 更新 版本',
        run: () => window.studio.studio.runAction({ type: 'check-updates' })
      },
      {
        id: 'action-github',
        group: t('shell.about'),
        title: t('shell.openGithubRepository'),
        subtitle: GITHUB_URL,
        icon: GithubMark,
        keywords: 'github source repo 仓库 源码',
        run: () => void window.studio.app.openExternal(GITHUB_URL)
      }
    ]

    if (workspaces.length === 0) {
      list.push({
        id: 'workspace-add',
        group: t('shell.workspace'),
        title: t('shell.addProjectFolder'),
        subtitle: t('shell.chooseYourFirstWorkspace'),
        icon: FolderPlus,
        keywords: 'add workspace folder 添加 项目 文件夹 工作区',
        run: () => window.studio.studio.runAction({ type: 'open-workspace' })
      })
    }

    for (const workspace of workspaces) {
      list.push({
        id: `ws-${workspace.id}`,
        group: t('shell.workspace'),
        title: workspace.name,
        subtitle: workspace.path,
        icon: FolderPlus,
        keywords: workspace.path,
        run: () => window.studio.studio.runAction({ type: 'open-workspace', id: workspace.id })
      })
    }

    for (const prompt of prompts) {
      list.push({
        id: `prompt-${prompt.id}`,
        group: t('shell.prompts'),
        title: prompt.title,
        subtitle: prompt.content.slice(0, 80),
        icon: Sparkles,
        keywords: `${prompt.tags.join(' ')} ${prompt.content.slice(0, 120)}`,
        run: async () => {
          await window.studio.clipboard.write(prompt.content)
          await window.studio.prompts.use(prompt.id)
          window.studio.studio.toast(translateNow('shell.copied', { p0: prompt.title }), 'success')
        }
      })
    }

    return list
  }, [workspaces, prompts, settings, t])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) =>
      `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(keyword)
    )
  }, [items, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return
    close()
    void item.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((value) => Math.min(filtered.length - 1, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      execute(filtered[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  let lastGroup = ''

  return (
    <div className="palette">
      <div className="palette-card" onKeyDown={onKeyDown}>
        <div className="palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('shell.searchCommandsWorkspacesOrPrompts')}
            spellCheck={false}
          />
          <span className="palette-esc">ESC</span>
        </div>

        <div className="palette-results">
          {filtered.length === 0 ? (
            <div className="palette-empty">
              <Command size={20} />
              <span>{t('shell.noMatchingItems')}</span>
            </div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon
              const header = item.group !== lastGroup ? item.group : null
              lastGroup = item.group
              return (
                <div key={item.id}>
                  {header ? <div className="palette-group">{header}</div> : null}
                  <div
                    ref={index === active ? activeRef : undefined}
                    className={`palette-item ${index === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => execute(item)}
                    role="option"
                    aria-selected={index === active}
                  >
                    <span className="palette-item-icon">
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="palette-item-copy">
                      <span className="palette-item-title">{item.title}</span>
                      {item.subtitle ? <span className="palette-item-sub">{item.subtitle}</span> : null}
                    </span>
                    {index === active ? (
                      <span className="palette-enter">
                        {t('shell.open')} <ArrowRight size={12} />
                      </span>
                    ) : (
                      <ChevronRight size={13} className="palette-chevron" />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-keys">
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('shell.select')}
          </span>
          <span className="palette-keys">
            <kbd>↵</kbd> {t('shell.run')}
          </span>
          <span className="palette-keys">
            <kbd>esc</kbd> {t('shell.close')}
          </span>
          <span className="palette-count">{t('shell.paletteItemCount', { count: filtered.length })}</span>
        </div>
      </div>
    </div>
  )
}
