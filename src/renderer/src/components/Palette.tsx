import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  CircleStop,
  Command,
  Download,
  FolderPlus,
  LayoutDashboard,
  MessagesSquare,
  Moon,
  Play,
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
  settings: Settings2
}

export default function Palette(): React.JSX.Element {
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
    void Promise.all([api.settings.get(), api.workspaces.list(), api.prompts.list()]).then(
      ([settingsValue, workspaceValue, promptValue]) => {
        setSettings(settingsValue)
        setWorkspaces(workspaceValue)
        setPrompts(promptValue)
      }
    )
    const offSettings = api.settings.onChange(setSettings)
    const offPrompts = api.prompts.onChange(setPrompts)
    const offWorkspaces = api.workspaces.onChange(setWorkspaces)
    inputRef.current?.focus()
    return () => {
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
        group: '导航',
        title: '启动台',
        subtitle: '回到总览与最近工作区',
        icon: ICONS.home,
        keywords: 'home dashboard start',
        run: () => navigate('home')
      },
      {
        id: 'nav-workspace',
        group: '导航',
        title: workspaces[0] ? `打开工作区 · ${workspaces[0].name}` : '工作区',
        subtitle: '进入 Harness 会话界面',
        icon: ICONS.workspace,
        keywords: 'workspace chat session',
        run: () => window.studio.studio.runAction({ type: 'open-workspace' })
      },
      {
        id: 'action-new-tab',
        group: '导航',
        title: '新建会话标签页',
        subtitle: '在工作区里并排再开一个会话 · Ctrl+T',
        icon: SquarePlus,
        keywords: 'tab new session 标签 新建',
        run: () => window.studio.studio.runAction({ type: 'new-tab' })
      },
      {
        id: 'action-close-tab',
        group: '导航',
        title: '关闭当前会话标签页',
        subtitle: '只关闭这个视图，会话不会被删除 · Ctrl+W',
        icon: SquareX,
        keywords: 'tab close session 标签 关闭',
        run: () => window.studio.studio.runAction({ type: 'close-tab' })
      },
      {
        id: 'nav-insights',
        group: '导航',
        title: '会话洞察',
        subtitle: 'token 用量、缓存命中与每日趋势',
        icon: ICONS.insights,
        keywords: 'insights tokens usage stats analytics 统计 用量',
        run: () => window.studio.studio.runAction({ type: 'open-insights' })
      },
      {
        id: 'nav-prompts',
        group: '导航',
        title: '提示词库',
        subtitle: '复制并复用常用指令',
        icon: ICONS.prompts,
        keywords: 'prompt library',
        run: () => navigate('prompts')
      },
      {
        id: 'nav-logs',
        group: '导航',
        title: '运行日志',
        subtitle: '查看本地服务输出',
        icon: ICONS.logs,
        keywords: 'logs console output',
        run: () => navigate('logs')
      },
      {
        id: 'nav-settings',
        group: '导航',
        title: '设置',
        subtitle: '外观、运行时与快捷键',
        icon: ICONS.settings,
        keywords: 'settings preferences',
        run: () => window.studio.studio.runAction({ type: 'open-settings' })
      },
      {
        id: 'action-restart',
        group: '运行时',
        title: '重启 Harness 运行时',
        subtitle: '应用运行中会话会受影响',
        icon: RefreshCw,
        keywords: 'restart host runtime',
        run: () => window.studio.studio.runAction({ type: 'restart-host' })
      },
      {
        id: 'action-stop',
        group: '运行时',
        title: '停止运行时',
        subtitle: '释放端口与本地进程',
        icon: CircleStop,
        keywords: 'stop host runtime',
        run: () => window.studio.studio.runAction({ type: 'stop-host' })
      },
      {
        id: 'action-start',
        group: '运行时',
        title: '启动运行时',
        subtitle: '使用最近的工作区',
        icon: Play,
        keywords: 'start host runtime',
        run: () => window.studio.studio.runAction({ type: 'start-host' })
      },
      {
        id: 'action-install',
        group: '运行时',
        title: '安装便携运行时',
        subtitle: '下载 Node.js 并部署 dsh',
        icon: Download,
        keywords: 'install runtime node',
        run: () => window.studio.studio.runAction({ type: 'open-settings', section: 'runtime' })
      },
      {
        id: 'action-theme',
        group: '外观',
        title: '切换深色 / 浅色主题',
        subtitle: settings?.theme === 'dark' ? '当前：深色' : '当前：浅色',
        icon: settings?.theme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light appearance',
        run: () => window.studio.studio.runAction({ type: 'toggle-theme' })
      },
      {
        id: 'action-update',
        group: '关于',
        title: '检查更新',
        subtitle: '从 GitHub 发布页获取最新版本',
        icon: Zap,
        keywords: 'update upgrade version',
        run: () => window.studio.studio.runAction({ type: 'check-updates' })
      },
      {
        id: 'action-github',
        group: '关于',
        title: '打开 GitHub 仓库',
        subtitle: GITHUB_URL,
        icon: GithubMark,
        keywords: 'github source repo',
        run: () => void window.studio.app.openExternal(GITHUB_URL)
      }
    ]

    if (workspaces.length === 0) {
      list.push({
        id: 'workspace-add',
        group: '工作区',
        title: '添加项目文件夹',
        subtitle: '选择第一个工作区',
        icon: FolderPlus,
        keywords: 'add workspace folder',
        run: () => window.studio.studio.runAction({ type: 'open-workspace' })
      })
    }

    for (const workspace of workspaces) {
      list.push({
        id: `ws-${workspace.id}`,
        group: '工作区',
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
        group: '提示词',
        title: prompt.title,
        subtitle: prompt.content.slice(0, 80),
        icon: Sparkles,
        keywords: `${prompt.tags.join(' ')} ${prompt.content.slice(0, 120)}`,
        run: async () => {
          await window.studio.clipboard.write(prompt.content)
          await window.studio.prompts.use(prompt.id)
          window.studio.studio.toast(`已复制「${prompt.title}」`, 'success')
        }
      })
    }

    return list
  }, [workspaces, prompts, settings])

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
            placeholder="输入命令、工作区或提示词…"
            spellCheck={false}
          />
          <span className="palette-esc">ESC</span>
        </div>

        <div className="palette-results">
          {filtered.length === 0 ? (
            <div className="palette-empty">
              <Command size={20} />
              <span>没有匹配的项目</span>
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
                        打开 <ArrowRight size={12} />
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
            <kbd>↓</kbd> 选择
          </span>
          <span className="palette-keys">
            <kbd>↵</kbd> 执行
          </span>
          <span className="palette-keys">
            <kbd>esc</kbd> 关闭
          </span>
          <span className="palette-count">{filtered.length} 项</span>
        </div>
      </div>
    </div>
  )
}
