# 交接说明（新对话从这里开始）

本文面向"接手继续开发"的人或 AI 助手。读完这一页就能知道项目在哪、怎么跑、下一步做什么。

## 当前状态

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.5` |
| 本地 HEAD | `git log --oneline -1` 确认 |
| 工作区 | 干净，无未提交改动 |
| 已发布 | v0.1.0 / v0.1.1 / v0.1.2 / v0.1.3 / v0.1.4 / v0.1.5，GitHub 与 Gitee 双平台齐全 |
| 远端 | `origin` → GitHub，`gitee` → Gitee |
| 平台 | Windows 10/11 x64（主要目标） |

> **注意**：GitHub 上的 commit SHA 与本地不同（通过 Git Data API 推送时 GitHub 会重新规范化提交对象）。**tree SHA 是一致的**，所以文件内容逐字节相同。校验同步时比较 `git rev-parse HEAD^{tree}` 与远端 commit 的 tree，不要比较 commit SHA。

六个版本的功能：

| 版本 | 内容 |
| --- | --- |
| v0.1.0 | 桌面外壳、多工作区、提示词库、实时日志、命令面板、托盘、主题 |
| v0.1.1 | 会话洞察（token / 缓存命中 / 成本估算 / 14 天趋势 / 模型与工作区分布） |
| v0.1.2 | 全局快速提问 `Ctrl+Alt+Space` |
| v0.1.3 | 快速提问历史记录（持久化 + 一键回填） |
| v0.1.4 | Host 崩溃自动恢复（指数退避 + 界面倒计时） |
| v0.1.5 | 会话/档案被占用诊断：提示可选中可关闭、DSH 进程列表与一键结束 |

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
先读 docs/HANDOFF.md（尤其「当前未完成的收尾」一节）和 docs/ARCHITECTURE.md，
然后完成 v0.1.5 的收尾：跑 npm run install:local 原地更新桌面版、
npm run status 确认无堆积，最后提交并推送 GitHub 与 Gitee。
我的 GitHub PAT 是 xxx，Gitee 令牌是 xxx。
```

如果这条消息里包含令牌，注意它们会留在对话记录里，事后应当轮换。

## 当前收尾状态（v0.1.5）

v0.1.5 的代码、文档、本地安装与状态审计都已完成；功能改动已提交并推送到 GitHub 与 Gitee。验证结果：

| 项目 | 结果 |
| --- | --- |
| 本地桌面版 | 已通过 `npm run install:local -- -SkipBuild` 更新到 `0.1.5.0` |
| 状态审计 | `npm run status` 显示唯一程序目录、两个快捷方式、已安装版本 `0.1.5.0`，且无 staging 副本 |
| 代码检查 | `npm run typecheck` 与 `npm run build` 均通过；preload 自包含检查通过 |
| 发布产物 | GitHub 与 Gitee 的 v0.1.5 已包含 `Setup.exe` 与 `Portable.exe` |

**剩余人工确认**：发送确认的拦截逻辑（状态机、选择器、按钮识别）已自动验证，但 Lexical 忽略 CDP 合成事件，所以「真实按键是否被拦下」需要手动试一次——开启「每次发送前确认」，在输入框里输入文字按回车，应弹出确认框。

### 不需要重新做的事

- 仓库已建好、双平台已发布，不用重新初始化；
- 依赖已装好（`node_modules` 在），除非你要升级依赖；
- v0.1.5 的功能改动、typecheck、build 与真机验证都已完成，不用重做（见下方「已完成（v0.1.5）」）。

### 已经改过、但**不在仓库里**的配置（重要）

下面这些是直接改在本机 DSH 配置上的，**提交代码不会带上它们**，新对话不需要重做，但需要知道现状：

| 文件 | 改动 | 备份 |
| --- | --- | --- |
| `~/.dsh/profiles/studio/cordis.patch.yml` | 三个 provider 都加了 `compat.requiresReasoningContentOnAssistantMessages: true`（修 `reasoning_content` 400）与 `retryPolicy`（`maxRetries: 25`） | `*.bak-2026-10-25T16-09-07-346Z` |
| `~/.dsh/profiles/web/cordis.patch.yml` | 同上；另外把默认模型从已下线的 `deepseek-v4.1-flash` 改为 `deepseek-v4.1-flash-1017` | `*.bak-2026-10-25T16-09-07-346Z`、`*.bak-2026-10-26T04-38-06-789Z` |

已验证：`dsh --profile studio|web --dump-config` 均 exit 0，配置可正常加载。

**注意**：配置只在 Host 启动时读取，改完要重启运行时才生效。当前运行中的 Studio Host 是改动前启动的。

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
    instances.ts           本机 DSH 进程枚举 / 结束（受限权限会标记 restricted）
    updater.ts             electron-updater 封装
    logger.ts              文件日志
    runtime/
      detect.ts            运行时探测顺序：自定义 → 便携 → npm 全局 → PATH
      host.ts              HostManager：spawn / 停止 / 重启 / 状态 / 日志 / 生命周期队列
      installer.ts         一键安装便携运行时（下载 Node + 安装 dsh）
  preload/index.ts         contextBridge 暴露 window.studio
  preload/workspace.ts     webview 主题注入 + 官方 toast 镜像（必须自包含，见下）
  renderer/src/
    pages/                 Home / Workspace / Insights / Prompts / Logs / Settings
    components/            Rail、Titlebar、Palette、QuickAsk、ErrorBoundary 等
    store.ts               zustand 全局状态
    styles/index.css       全部样式（约 3800 行，Tailwind v4 + 自定义 CSS 变量）
  shared/
    types.ts               所有跨进程类型与 StudioApi 契约
    channels.ts            IPC 频道常量（preload 里只能复制字面量，不能 import）
    defaults.ts            默认设置、内置提示词、仓库地址
scripts/
  check-preload.mjs        build 后校验 preload 无相对 require（沙箱硬约束）
```

改代码时记住四条硬约束（前三条也写在 `CONTRIBUTING.md`）：

1. 新增主进程能力必须同时改 `shared/types.ts`、`preload/index.ts` 和主进程 `handle/on`；
2. 渲染进程不碰 Node 与文件系统；
3. 日志里的启动令牌必须脱敏；
4. **preload 只能 import type**。值级 import 会让 Rollup 拆出 `chunks/*.js`，沙箱 preload 加载失败后 `window.studio` 直接消失，界面卡在启动页且无任何报错。通道名就地写常量；`npm run build` 会自动校验。

## 环境注意事项

这些是在这台机器上踩过的坑，换了机器可能不适用：

- Electron 应用在当前沙箱下需要 `--no-sandbox --disable-gpu` 才能启动；打包产物做真机验证时也要加。
- `npm` 要用完整路径调用：`& "C:\Program Files\nodejs\npm.cmd"`。
- `npm install` 在本环境会因 EPERM 失败，所以先 `--ignore-scripts` 再单独装 Electron 二进制。
- **不要用 PowerShell 的 `-replace` 或 `>` 重定向改源码**：会把中文写成乱码、把文件写成 UTF-16。要批量改文本就写个临时 `.mjs` 脚本用 Node 读写，并在写回前检查 `\uFFFD`。
- 本机 `dsh web` 可能正在运行，Studio 默认使用独立的 `studio` 配置档案，避免争用 profile。
- **从 DSH 自己的沙箱 shell 启动 Electron 做验证，会拿到 Low 完整性令牌**：只能枚举到 33 个左右的进程，`Get-Process -Name node` 返回 0，`whoami /groups` 显示 `S-1-16-4096`。这不是代码问题，但会让「其他 DSH 进程」这类功能看起来失效。要验证真实行为，用 High/Medium 完整性的 shell（比如直接在本机终端跑），或用 `Invoke-CimMethod Win32_Process Create` 从非沙箱进程启动。
- 用 `Start-Process -PassThru` 启动 Electron 有时会一直阻塞；改用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create`。
- `--user-data-dir` 的路径含空格时必须带引号，否则参数会被截断、应用起不来。
- **模型凭据与路由在 `~/.dsh/profiles/<name>/cordis.patch.yml`，不在本仓库**。本机 `studio` 与 `web` 两个 profile 都走中转：`primerelay`（默认模型 `deepseek-v4.1-flash-1017`，注意该中转**已不再提供** `deepseek-v4.1-flash`，用错 id 会得到 404 `model_not_found`）、`ultrarouter`、`wzw`。改这个文件前先备份，且必须用 Node 脚本写（PowerShell 会写 BOM，DSH 解析 `package.json` 时会直接报 `Unexpected token '\uFEFF'` 起不来）。
- 排查模型请求问题最有效的手段是**在 `baseURL` 前挂一个抓包代理**，把 profile 临时指向 `http://127.0.0.1:<port>/v1`，就能看到 DSH 实际发出的请求体（roles、字段、重试次数）与提供方返回体。比翻日志快得多，也是确认 `reasoning_content` 这类字段问题的唯一可靠方式。
- 验证多轮场景用 `dsh --profile <name> --json "<task>"` 拿到 `sessionId`，再用 `--session-id <id>` 续跑——只有续跑那次请求才会带上 assistant 历史。
- `dsh --profile headless` 需要凭据走环境变量；密钥在 `~/.dsh/.credentials.yaml`（`PRIMERELAY_API_KEY` / `ULTRAROUTER_API_KEY` / `WZW_API_KEY`），读取时不要打印明文。

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

现状：单个 `HostManager` 实例，切换工作区已经**不再重启进程**（`canAdoptWorkspace` / `adoptWorkspace`，见 v0.1.5），但同一时刻只服务一个工作区视图。

方向：把 `HostManager` 改成按 workspaceId 索引的实例池，每个实例独立端口与日志。需要处理：

- `src/main/index.ts` 里所有 `host.xxx()` 调用点（目前 18 处）都要改成"取当前标签对应的实例"；
- 渲染进程的 `<webview>` 要按标签维护多个实例，切换时只显示激活的那个；
- 内存与端口占用随标签数增长，建议限制并发上限（比如 4 个）并回收长时间未激活的实例。

> 补充：`git stash@{0}` 里有一份未完成的多标签改动，因内存占用暂未启用。

**注意**：DSH 本身是多工作区服务，一个 Host 就能服务多个目录。如果目标只是"快速切换"，当前复用方案已经够用；只有当需要**并行**（两个工作区同时跑任务）时才需要实例池。

### 3. 对话界面内部的定制

凡属"对话界面内部"的能力（排队消息拖动排序、逐字流式的渲染细节等）都在 DSH 上游。npm 分发的 `@deepseek-ai/dsh-*` 是**压缩产物、不含源码**，因此只能注入或打补丁。

自建会话界面的可行性已实测（结论见 `docs/ARCHITECTURE.md` 的「能不能不用官方 Web UI」一节）：ACP/SDK 能驱动会话，但两条线路都**没有逐字流式**、**没有队列编辑/插话**。要拿到这两项，只能继续用官方 Web UI。

### 4. 其他

- **macOS 构建**：`.github/workflows/release.yml` 加 `macos-latest` job 即可，但本环境无法验收，需要真机测试。
- **插件市场入口**：只需在 UI 里做一个跳转入口，工作量最小但价值也有限。
- **界面英文化**：`README.en.md` 已有，界面文案目前全是中文硬编码，需要引入 i18n 层。

### 已完成（v0.1.4）

Host 崩溃自动恢复已实现并验证：非主动退出后按 2s → 5s → 15s 退避重启，最多 3 次；`HostStatus.recovery` 暴露倒计时供 UI 展示；主动停止 / profile 被占用 / 权限不足时不重试。详见 `docs/ARCHITECTURE.md` 的「崩溃自动恢复」一节。

### 已完成（v0.1.5）

**一、占用诊断**，详见 `docs/ARCHITECTURE.md` 的「会话 / 档案被占用」一节：

- 官方瞬态 toast 被镜像成 Studio 自己的 toast：可选中、可复制、可关闭、不自动消失，重复文案去重；
- 文案归类到 `session/writer-held` / `profile/locked` 时才附带「结束其他 DSH 进程」；
- 设置 → 运行时新增「其他 DSH 进程」卡片：PID / profile / 模式 / 完整命令行，Studio 自己的那条高亮且不可结束，结束前弹确认；
- 扫描能识别受限权限（Low 完整性或枚举不到自己）并显示琥珀色警告，避免把「看不到」说成「没有」；
- 新增 `scripts/check-preload.mjs`，把「preload 引共享模块导致整个 preload 静默失效」变成构建错误。

**二、启动与切换更快**，详见「启动耗时与工作区复用」一节：

- 切工作区复用运行中的 Host（DSH 是多工作区服务），不再每次白付约 10 秒；
- 冷启动并行预热，等待与界面加载重叠；
- 实测确认 10 秒来自 DSH 启动器自身，与插件数量/网络/JS 编译都无关。

**三、发送确认**，详见「发送确认」一节：拦截 Enter 与发送按钮，队列非空时明确提示「会连同 N 条排队消息一起提交」，设置里两个开关独立。

**遗留的小事**：

- `win-unpacked` 里的 `Harness Studio.exe` 若还在运行，`npm run dist:dir` 会因 `EBUSY` 失败。打包前先结束进程。
- 发送确认的**拦截逻辑**已自动化验证（状态机、选择器、按钮识别、隔离世界可见性），但「合成按键驱动 Lexical 输入」无法自动验证——Lexical 忽略 CDP 合成事件。**真实的键盘拦截需要人工确认一次**。

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
