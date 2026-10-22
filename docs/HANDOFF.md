# 交接说明（新对话从这里开始）

本文面向"接手继续开发"的人或 AI 助手。读完这一页就能知道项目在哪、怎么跑、下一步做什么。

## 当前状态

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.4` |
| 本地 HEAD | `git log --oneline -1` 确认 |
| 工作区 | 干净，无未提交改动 |
| 已发布 | v0.1.0 / v0.1.1 / v0.1.2 / v0.1.3 / v0.1.4，GitHub 与 Gitee 双平台齐全 |
| 远端 | `origin` → GitHub，`gitee` → Gitee |
| 平台 | Windows 10/11 x64（主要目标） |

> **注意**：GitHub 上的 commit SHA 与本地不同（通过 Git Data API 推送时 GitHub 会重新规范化提交对象）。**tree SHA 是一致的**，所以文件内容逐字节相同。校验同步时比较 `git rev-parse HEAD^{tree}` 与远端 commit 的 tree，不要比较 commit SHA。

五个版本的功能：

| 版本 | 内容 |
| --- | --- |
| v0.1.0 | 桌面外壳、多工作区、提示词库、实时日志、命令面板、托盘、主题 |
| v0.1.1 | 会话洞察（token / 缓存命中 / 成本估算 / 14 天趋势 / 模型与工作区分布） |
| v0.1.2 | 全局快速提问 `Ctrl+Alt+Space` |
| v0.1.3 | 快速提问历史记录（持久化 + 一键回填） |
| v0.1.4 | Host 崩溃自动恢复（指数退避 + 界面倒计时） |

## 在新对话中如何继续

工作区就在 `D:\Program Files\develop\vscode\her`（以 `pwd` 为准），新对话里直接说清楚下面三件事即可：

**1. 指明工作目录**

> 在 `D:\Program Files\develop\vscode\her` 继续开发 Harness Studio，先读 `docs/HANDOFF.md`。

**2. 说明要做什么**

从下面挑一个，或者提你自己的需求：

- "实现 Host 崩溃自动恢复，按 HANDOFF 里第 1 项的建议做"
- "实现多标签工作区，按 HANDOFF 里第 2 项做"
- "给 xxx 页面加 yyy 功能"

**3. 需要时提供凭据**

推送 GitHub 需要一个有 `repo` + `workflow` 权限的 PAT；推 Gitee 需要一个 `projects` 权限的私有令牌。这两个都不在仓库里（`.gitignore` 已屏蔽相关文件），需要你在新对话里重新提供。

### 新对话的第一条消息可以直接复制

```text
在 D:\Program Files\develop\vscode\her 继续开发 Harness Studio。
先读 docs/HANDOFF.md 和 docs/ARCHITECTURE.md 了解现状，
然后实现 Host 崩溃自动恢复。完成后跑 typecheck 与 build，
提交、推送 GitHub 与 Gitee，并按 docs/PUBLISHING.md 发布新版本。
我的 GitHub PAT 是 xxx，Gitee 令牌是 xxx。
```

如果这条消息里包含令牌，注意它们会留在对话记录里，事后应当轮换。

### 不需要重新做的事

- 仓库已建好、双平台已发布，不用重新初始化；
- 依赖已装好（`node_modules` 在），除非你要升级依赖；
- `dist/` 里有 v0.1.3 的构建产物，但发布新版本时会重新生成。

### 如果新对话里 `npm install` 报 EPERM

说明换了环境。按"环境注意事项"里的方式拆开装，或者直接 `npm run typecheck`——只要 `node_modules` 还在就不用重装。

## 最快上手

```powershell
npm install --ignore-scripts
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
npm run dev
```

改 UI 而不想启动 Electron 时，用浏览器预览（见下文"验证方式"）。

## 代码地图

```
src/
  main/                    Electron 主进程
    index.ts               IPC 注册、窗口与 Host 编排、设置应用（约 860 行，最大的文件）
    windows.ts             主窗口 / 命令面板 / 快速提问窗口的创建
    shortcuts.ts           全局快捷键注册
    store.ts               JsonStore：原子写入 + 合并默认值 + 范围校验
    sessions.ts            会话洞察：投影缓存解析、聚合、60 秒缓存（约 325 行）
    quickask.ts            快速提问注入：聚焦 composer → insertText → 点击发送
    updater.ts             electron-updater 封装
    logger.ts              文件日志
    runtime/
      detect.ts            运行时探测顺序：自定义 → 便携 → npm 全局 → PATH
      host.ts              HostManager：spawn / 停止 / 重启 / 状态 / 日志 / 生命周期队列
      installer.ts         一键安装便携运行时（下载 Node + 安装 dsh）
  preload/index.ts         contextBridge 暴露 window.studio
  renderer/src/
    pages/                 Home / Workspace / Insights / Prompts / Logs / Settings
    components/            Rail、Titlebar、Palette、QuickAsk、ErrorBoundary 等
    store.ts               zustand 全局状态
    styles/index.css       全部样式（约 3600 行，Tailwind v4 + 自定义 CSS 变量）
  shared/
    types.ts               所有跨进程类型与 StudioApi 契约
    channels.ts            IPC 频道常量
    defaults.ts            默认设置、内置提示词、仓库地址
```

改代码时记住三条硬约束（也写在 `CONTRIBUTING.md`）：

1. 新增主进程能力必须同时改 `shared/types.ts`、`preload/index.ts` 和主进程 `handle/on`；
2. 渲染进程不碰 Node 与文件系统；
3. 日志里的启动令牌必须脱敏。

## 环境注意事项

这些是在这台机器上踩过的坑，换了机器可能不适用：

- Electron 应用在当前沙箱下需要 `--no-sandbox --disable-gpu` 才能启动；打包产物做真机验证时也要加。
- `npm` 要用完整路径调用：`& "C:\Program Files\nodejs\npm.cmd"`。
- `npm install` 在本环境会因 EPERM 失败，所以先 `--ignore-scripts` 再单独装 Electron 二进制。
- **不要用 PowerShell 的 `-replace` 或 `>` 重定向改源码**：会把中文写成乱码、把文件写成 UTF-16。要批量改文本就写个临时 `.mjs` 脚本用 Node 读写，并在写回前检查 `\uFFFD`。
- 本机 `dsh web` 可能正在运行，Studio 默认使用独立的 `studio` 配置档案，避免争用 profile。

## 验证方式

改完一定要跑：

```powershell
npm run typecheck
npm run build
```

UI 改动的截图流程：

```powershell
npm run build
npm run preview:ui          # 后台起 4179
# 另开终端：
node scripts/shot.mjs "http://127.0.0.1:4179/?view=insights" ".preview/insights.png" 1360 1000
```

`scripts/preview-mock.mjs` 提供全部 mock 数据，加新页面时记得同步补上，否则预览会报错。

需要真正验证 Electron 行为（比如快速提问注入、Host 生命周期）时：

```powershell
npm run dist:dir
$env:HARNESS_STUDIO_USER_DATA = "$PWD\.run-test"
& "$PWD\dist\win-unpacked\Harness Studio.exe" --no-sandbox --disable-gpu --remote-debugging-port=9333
# 用 CDP 查状态或截图：
node scripts/app-shot.mjs .run-test/shot.png "@.run-test/expr.js"
```

`scripts/app-shot.mjs` 只匹配应用自己的 renderer（`index.html` 且不含 `#`），不会误连到内嵌的 Harness webview。`scripts/preview-eval.mjs` 可以在截图前先断言 DOM，避免"图看起来对但其实是旧构建"。

**注意**：截图脚本必须禁用缓存，否则会拿到旧构建的图（这个坑踩过）。`shot.mjs` 已加 `Network.setCacheDisabled`。

## 下一步建议

按我评估的性价比排序：

### 1. 多标签工作区（改动大，路线图里呼声最高）

现状：单个 `HostManager` 实例，切换工作区靠 `host.restart()` 杀旧起新，已打开的会话会中断。

方向：把 `HostManager` 改成按 workspaceId 索引的实例池，每个实例独立端口与日志。需要处理：

- `src/main/index.ts` 里所有 `host.xxx()` 调用点（目前 18 处）都要改成"取当前标签对应的实例"；
- 渲染进程的 `<webview>` 要按标签维护多个实例，切换时只显示激活的那个；
- 内存与端口占用随标签数增长，建议限制并发上限（比如 4 个）并回收长时间未激活的实例。

### 3. 其他

- **macOS 构建**：`.github/workflows/release.yml` 加 `macos-latest` job 即可，但本环境无法验收，需要真机测试。
- **插件市场入口**：只需在 UI 里做一个跳转入口，工作量最小但价值也有限。
- **界面英文化**：`README.en.md` 已有，界面文案目前全是中文硬编码，需要引入 i18n 层。

### 已完成（v0.1.4）

Host 崩溃自动恢复已实现并验证：非主动退出后按 2s → 5s → 15s 退避重启，最多 3 次；`HostStatus.recovery` 暴露倒计时供 UI 展示；主动停止 / profile 被占用 / 权限不足时不重试。详见 `docs/ARCHITECTURE.md` 的「崩溃自动恢复」一节。

## 不要做的事

- 不要提交 `dist/`、`.preview/`、`.run-*/`、日志或任何令牌（`.gitignore` 已覆盖大部分）。
- 不要为了省事把 token 写进仓库：这个项目历史上发生过一次，已通过 force-push 清理，务必避免重演。
- 不要手动改 `dist/` 里的产物，所有版本都从源码构建。

## 发布新版本

完整流程见 `docs/PUBLISHING.md`。简要版：

```powershell
# 1. 改 package.json / package-lock.json 版本号，更新 CHANGELOG.md 与 README 下载链接
# 2. 构建
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
# 3. 提交打标签
git add -A; git commit -m "chore(release): v0.1.x"; git tag -a v0.1.x -m "..."
# 4. Gitee（GitHub 直连不稳，走 API 更可靠）
git push gitee main; git push gitee v0.1.x
# 5. GitHub：推 tag 后 Actions 自动构建并发布
# 6. Gitee 需要手动传安装包到发行版（Gitee 不跑 Actions）
```

两个平台的 Release 都要有 `Setup.exe` 与 `Portable.exe`，且都小于 100 MB（Gitee 附件上限）。
