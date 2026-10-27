import type { PromptItem, Settings } from './types'

export const PRODUCT_NAME = 'Harness Studio'
export const PRODUCT_NAME_ZH = '深寻工作台'
export const GITHUB_REPO = 'yunhanhai/harness-studio'
export const GITEE_REPO = 'yunhanhai/harness-studio'
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`
export const GITEE_URL = `https://gitee.com/${GITEE_REPO}`
export const RELEASES_URL = `${GITHUB_URL}/releases`
export const DOCS_URL = `${GITHUB_URL}#readme`

export const ACCENTS = ['#5B8CFF', '#22D3EE', '#8B5CF6', '#F472B6', '#34D399', '#F59E0B'] as const

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  language: 'system',
  theme: 'dark',
  accent: '#5B8CFF',
  reduceMotion: false,
  zoomFactor: 1,
  closeToTray: true,
  minimizeToTray: false,
  launchAtLogin: false,
  startMinimized: false,
  checkUpdatesOnStart: true,
  runtime: {
    mode: 'auto',
    customPath: '',
    nodePath: '',
    dshHome: '',
    profile: 'studio',
    port: 0,
    extraArgs: [],
    env: {},
    autoStart: true,
    registry: 'https://registry.npmmirror.com',
    nodeMirror: 'https://npmmirror.com/mirrors/node'
  },
  shortcuts: {
    toggleWindow: 'CommandOrControl+Alt+H',
    palette: 'CommandOrControl+Alt+K',
    quickAsk: 'CommandOrControl+Alt+Space'
  },
  insights: {
    inputPrice: 0,
    outputPrice: 0,
    cacheReadPrice: 0,
    currency: 'CNY'
  },
  quickAsk: {
    autoSend: true,
    revealAfterSend: true,
    recentLimit: 6
  },
  composer: {
    confirmSend: false,
    confirmQueued: true
  },
  lastWorkspaceId: '',
  window: {
    width: 1360,
    height: 860,
    maximized: false
  }
}

const now = Date.now()

export const DEFAULT_PROMPTS: PromptItem[] = [
  {
    id: 'builtin-review',
    title: '代码审查',
    content:
      '请以资深工程师的视角审查我选中的代码。按「阻塞问题 / 建议改进 / 可读性 / 安全性」分组，每条给出具体行号和可执行的修改建议。最后给出一个总体结论（可以合并 / 需要修改）。',
    tags: ['代码质量', '审查'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'builtin-refactor',
    title: '重构方案',
    content:
      '请先阅读相关文件，理解当前实现，然后给出一份小步、可回滚的重构计划：目标、约束、涉及文件、每一步的验证方式。不要一次性重写；优先消除重复和隐式状态。',
    tags: ['重构', '架构'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'builtin-tests',
    title: '补齐测试',
    content:
      '为这次改动补齐测试。先列出行为清单和边界条件，再按现有测试框架实现。测试应当稳定、快速、不依赖真实网络或时间。最后运行测试并修复失败项。',
    tags: ['测试', '质量'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'builtin-explain',
    title: '解释代码',
    content:
      '请解释这段代码在做什么：先用三句话概括，再按执行顺序拆解关键路径，最后指出其中容易被忽略的假设、边界条件和潜在 bug。',
    tags: ['学习', '理解'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'builtin-commit',
    title: '生成提交信息',
    content:
      '根据当前 git diff 生成一条提交信息。采用 Conventional Commits 格式，标题不超过 72 个字符，正文说明动机和影响。不要罗列文件清单。',
    tags: ['Git', '协作'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'builtin-plan',
    title: '需求拆解',
    content:
      '把这个需求拆成可独立交付的小任务：每项写清验收标准、涉及模块、风险与依赖。标出必须先做的技术验证，以及可以并行的工作。',
    tags: ['规划', '产品'],
    builtin: true,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  }
]
