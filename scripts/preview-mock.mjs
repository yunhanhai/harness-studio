const SETTINGS = {
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
  shortcuts: { toggleWindow: 'CommandOrControl+Alt+H', palette: 'CommandOrControl+Alt+K' },
  lastWorkspaceId: 'ws-1',
  window: { width: 1360, height: 860, maximized: false }
}

const PROMPT_BODIES = [
  ['代码审查', '请以资深工程师的视角审查我选中的代码。按「阻塞问题 / 建议改进 / 可读性 / 安全性」分组，每条给出具体行号和可执行的修改建议。', ['代码质量', '审查']],
  ['重构方案', '请先阅读相关文件，理解当前实现，然后给出一份小步、可回滚的重构计划：目标、约束、涉及文件、每一步的验证方式。', ['重构', '架构']],
  ['补齐测试', '为这次改动补齐测试。先列出行为清单和边界条件，再按现有测试框架实现，最后运行并修复失败项。', ['测试', '质量']],
  ['解释代码', '请解释这段代码在做什么：先用三句话概括，再按执行顺序拆解关键路径，最后指出其中的假设与潜在 bug。', ['学习', '理解']],
  ['生成提交信息', '根据当前 git diff 生成一条提交信息。采用 Conventional Commits，标题不超过 72 字符，正文说明动机和影响。', ['Git', '协作']],
  ['需求拆解', '把这个需求拆成可独立交付的小任务：每项写清验收标准、涉及模块、风险与依赖。', ['规划', '产品']]
]

export function buildMockScript() {
  const now = Date.now()
  const settings = JSON.parse(JSON.stringify(SETTINGS))
  const workspaces = [
    { id: 'ws-1', name: 'her', path: 'D:\\Program Files\\develop\\vscode\\her', color: '#5B8CFF', pinned: true, createdAt: now - 86400000 * 12, lastOpenedAt: now - 1000 * 60 * 8 },
    { id: 'ws-2', name: 'aurora-web', path: 'D:\\workspace\\aurora-web', color: '#22D3EE', pinned: false, createdAt: now - 86400000 * 30, lastOpenedAt: now - 1000 * 60 * 60 * 5 },
    { id: 'ws-3', name: 'docs-site', path: 'D:\\workspace\\docs-site', color: '#8B5CF6', pinned: false, createdAt: now - 86400000 * 3, lastOpenedAt: now - 86400000 * 2 }
  ]
  const prompts = PROMPT_BODIES.map(([title, content, tags], index) => ({
    id: `builtin-${index}`,
    title,
    content,
    tags,
    builtin: true,
    usageCount: [12, 8, 5, 3, 2, 1][index],
    createdAt: now - 86400000 * 20,
    updatedAt: now - 86400000
  }))
  const messages = [
    'dsh runtime booting (profile: web)',
    'loaded 42 plugins from bundle layer',
    'webserver listening on 127.0.0.1:62812',
    'connection ready: launch token accepted',
    'workspace mounted at D:\\Program Files\\develop\\vscode\\her',
    'agent preset: standard',
    'session projection cache warm',
    'awaiting first message'
  ]
  const logs = Array.from({ length: 42 }, (_, index) => ({
    id: index + 1,
    ts: now - (42 - index) * 1100,
    stream: index % 11 === 0 ? 'err' : index % 6 === 0 ? 'sys' : 'out',
    text: index % 11 === 0 ? 'warn: optional plugin ui-terminal skipped (not installed)' : messages[index % messages.length]
  }))
  const runtime = {
    state: 'ready',
    source: 'npm-global',
    version: '0.2.1-rc.2',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    nodeVersion: '22.23.3',
    cliPath: 'C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    dshHome: 'C:\\Users\\you\\.dsh',
    checkedAt: now
  }
  const host = { state: 'ready', url: 'http://127.0.0.1:62812/?token=preview', port: 62812, pid: 4412, workspaceId: 'ws-1', startedAt: now - 30000 }
  const info = {
    name: 'Harness Studio',
    version: '0.1.0',
    platform: 'win32',
    arch: 'x64',
    electron: '44.9.3',
    chrome: '140.0.7339.0',
    node: '24.22.0',
    v8: '13.7',
    userData: 'C:\\Users\\you\\AppData\\Roaming\\Harness Studio',
    logsDir: 'C:\\Users\\you\\AppData\\Roaming\\Harness Studio\\logs',
    dshHome: 'C:\\Users\\you\\.dsh',
    isPackaged: false,
    repoUrl: 'https://github.com/REPLACE_ME/harness-studio',
    giteeUrl: 'https://gitee.com/REPLACE_ME/harness-studio'
  }
  const mock = { info, settings, workspaces, prompts, logs, runtime, host }
  return `
const MOCK = ${JSON.stringify(mock)};
const clone = (value) => JSON.parse(JSON.stringify(value));
const listeners = () => () => {};
const merge = (base, patch) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base[key] || {}, value) : value;
  }
  return out;
};
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light' || params.get('theme') === 'dark') {
  MOCK.settings.theme = params.get('theme');
}
if (params.get('host') === 'starting') {
  MOCK.host = { state: 'starting', workspaceId: 'ws-1', startedAt: Date.now() - 4000 };
}
if (params.get('host') === 'error') {
  MOCK.host = { state: 'error', workspaceId: 'ws-1', error: 'Host 进程意外退出（退出码 1）。请检查模型凭据与端口占用。' };
}
if (params.get('host') === 'stopped') {
  MOCK.host = { state: 'stopped' };
}
if (params.get('empty') === '1') {
  MOCK.workspaces = [];
  MOCK.host = { state: 'stopped' };
}
window.studio = {
  app: {
    info: async () => MOCK.info,
    minimize: () => {}, toggleMaximize: () => {}, close: () => {},
    isMaximized: async () => false,
    openExternal: async () => true,
    openPath: async () => true,
    showItemInFolder: () => {},
    setBadge: () => {}
  },
  settings: {
    get: async () => clone(MOCK.settings),
    save: async (patch) => { MOCK.settings = merge(MOCK.settings, patch); return clone(MOCK.settings); },
    reset: async () => clone(MOCK.settings),
    onChange: listeners, onWindowState: listeners
  },
  runtime: {
    detect: async () => clone(MOCK.runtime),
    install: async () => ({ phase: 'done', percent: 100, message: '运行时安装完成（演示）' }),
    cancelInstall: async () => {},
    onInstallProgress: listeners
  },
  host: {
    start: async () => clone(MOCK.host),
    stop: async () => ({ state: 'stopped' }),
    restart: async () => clone(MOCK.host),
    status: async () => clone(MOCK.host),
    logs: async () => clone(MOCK.logs),
    clearLogs: async () => {},
    onStatus: listeners, onLog: listeners, openLogsFolder: async () => {}
  },
  workspaces: {
    list: async () => clone(MOCK.workspaces),
    add: async () => null,
    remove: async () => clone(MOCK.workspaces),
    update: async () => clone(MOCK.workspaces),
    touch: async () => clone(MOCK.workspaces),
    pickFolder: async () => null,
    onChange: listeners
  },
  prompts: {
    list: async () => clone(MOCK.prompts),
    save: async () => clone(MOCK.prompts),
    remove: async () => clone(MOCK.prompts),
    use: async () => clone(MOCK.prompts),
    onChange: listeners
  },
  studio: {
    onAction: listeners, onToast: listeners, runAction: () => {},
    closePalette: () => {}, hidePalette: () => {}, showPalette: () => {},
    toast: () => {},
    checkUpdates: async () => ({ status: 'latest', version: '0.1.0', message: '已经是最新版本。' }),
    openReleases: async () => {}, quit: () => {}, relaunch: () => {}
  },
  clipboard: { write: async () => {}, read: async () => '' },
  zoom: { get: async () => 1, set: () => {}, onChange: listeners }
};
`
}
