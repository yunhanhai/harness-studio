# 架构说明

Harness Studio 是一个 Electron 外壳，不重写模型能力，也不复制 DeepSeek Harness 的后端。它负责三件事：

1. **管理运行时**：找到或安装 `dsh`，以独立子进程启动 `dsh web`，并把本地 URL 交给窗口；
2. **提供工作台**：项目工作区、提示词库、日志、设置、托盘、命令面板；
3. **承载会话界面**：用隔离的 `<webview>` 加载官方 Web UI，保持与上游一致的模型、工具和插件行为。

## 进程模型

```
┌──────────────────────────────────────────────────────────┐
│ Electron main                                            │
│  · 单实例锁 / 窗口 / 托盘 / 全局快捷键                    │
│  · RuntimeManager：检测 dsh、安装便携运行时、启动 Host   │
│  · JSON 存储：settings / workspaces / prompts            │
│  · IPC（contextBridge 白名单）                           │
└───────────────┬──────────────────────────┬───────────────┘
                │ IPC                      │ child_process
┌───────────────▼──────────────┐   ┌───────▼────────────────┐
│ Renderer（React 工作台）      │   │ dsh web（Node 子进程）  │
│  · 启动台 / 提示词 / 日志     │   │  · 监听 127.0.0.1:随机端口│
│  · 设置 / 命令面板窗口        │   │  · 官方 Web UI 与 API   │
│  · <webview> 加载 Host URL    │◄──┤  · 启动令牌 + Cookie    │
└──────────────────────────────┘   └────────────────────────┘
```

- 主进程只暴露窄接口：窗口控制、设置读写、运行时检测/安装、Host 生命周期、工作区与提示词 CRUD、剪贴板、外链。
- 渲染进程没有 Node 权限；`nodeIntegration`、`contextIsolation`、`sandbox` 均按 Electron 安全推荐配置。
- Webview 使用 `persist:harness-studio` 分区，只允许加载当前 Host 的 origin；新窗口和跨 origin 导航一律交给系统浏览器。

## Host 生命周期

1. 渲染进程请求 `host:start(workspaceId)`；
2. 主进程解析工作区路径与运行时，启动：
   ```text
   <node> <dsh>/lib/bin.js web --no-open --port 0
   ```
3. 从 stdout 读取 `dsh web: http://127.0.0.1:<port>/?token=...`；
4. 把 URL 写入 `HostStatus`，渲染进程据此设置 `<webview src>`；
5. 退出应用或切换工作区时，Windows 使用 `taskkill /T` 结束整棵进程树。

访问令牌只存在于内存和 Webview 的启动 URL 中；写入日志前会被替换为 `token=***`。

### 崩溃自动恢复

Host 进程**非主动**退出时，`HostManager` 会用指数退避自动重启，而不是把用户丢在错误页：

| 字段 | 含义 |
| --- | --- |
| `HostStatus.recovery.attempt` | 当前第几次重试（从 1 开始） |
| `HostStatus.recovery.maxAttempts` | 上限，当前为 3 |
| `HostStatus.recovery.nextAttemptAt` | 下次重试的时间戳，驱动 UI 倒计时 |
| `HostStatus.recovery.reason` | 崩溃原因，直接展示给用户 |

退避间隔为 2s → 5s → 15s。重启成功后计数归零；三次都失败则保留错误状态不再重试。

**不会触发恢复的情况**（避免误重启）：

- 用户主动停止、切换工作区、退出应用（`stopping` 标志 + `recoveryCancelled`）；
- 配置档案被占用（日志出现 `EPERM` + `cordis.yml`）：重试必然失败，直接提示用户退出其他 `dsh web`；
- 启动时权限不足（`EPERM` / `EACCES`）。

启动超时（150 秒）也纳入恢复流程：超时后先结束进程树，再按退避重试。

## 运行时检测顺序

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 自定义路径 | 设置中的 `runtime.customPath`，支持 `bin.js` / 包目录 / `dsh.cmd` |
| 2 | 便携运行时 | `<userData>/runtime/node/node.exe` + `<userData>/runtime/node_modules/@deepseek-ai/dsh` |
| 3 | npm 全局 | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js` |
| 4 | PATH | `where dsh` 反查 npm 全局包 |

Node.js 同理：自定义路径 → 便携运行时 → `C:\Program Files\nodejs\node.exe` → PATH。

## 一键安装便携运行时

1. 从镜像下载官方 Node.js Windows zip；
2. 解压到 `<userData>/runtime/node`；
3. 用 Node 自带的 npm 执行 `npm install @deepseek-ai/dsh@latest --prefix <userData>/runtime`；
4. 重新检测并返回版本。

整个过程有阶段进度、取消和超时；失败时保留已有运行时。

## 快速提问

`Ctrl+Alt+Space` 呼出一个 640×210 的置顶小窗，写完 Enter 直接发到当前会话。它不经过 Harness 的私有 RPC，而是驱动真实 UI：

1. **确保 guest 存在**：若主窗口不在工作区，先切过去，并等待 `did-attach-webview`（最多 15 秒）；
2. **关闭说明弹窗**：只点「继续 / 知道了 / 跳过」这类确认按钮；含「登录 / API Key / 删除 / 重置」的弹窗一律跳过；
3. **聚焦 composer**：找到可见的 `[contenteditable="true"]`，把光标移到末尾；SPA 刚挂载时轮询最多 6 秒；
4. **写入文本**：调用 `webContents.insertText()`，这是 Chromium 真实输入事件，React 受控编辑器会正常接收；
5. **可选发送**：找到可见的发送按钮并 `click()`；失败时保留已填入的文本，提示用户手动发送。

相比抓内部 API，这条路在上游改版时更稳，也不会绕过 Harness 自己的发送流程（包括工作区权限、模型选择、附件校验）。

关键文件：`src/main/quickask.ts`（注入逻辑）、`src/main/windows.ts`（窗口）、`src/renderer/src/components/QuickAsk.tsx`（界面）。

## 会话洞察

洞察面板是只读分析层，不参与 Host 生命周期，也不接触对话正文。

### 数据来源

| 优先级 | 路径 | 说明 |
| --- | --- | --- |
| 1 | `$DSH_HOME/storages/session_projcache/sessions/*.json` | DSH 自己的会话投影缓存，含 `tokenUsage.totals`、`sessionStats`、`modelSelection`、`sessionListMetadata` |
| 2 | `$DSH_HOME/sessions/**/session.v*.jsonl.zstd` | 回退方案，只解压首个 zstd 帧读取会话头（cwd / createdAt） |

投影缓存是首选：它已经是聚合后的数字，无需解压 GB 级日志，也不会碰到消息内容。只有当某个 `$DSH_HOME` 完全没有投影缓存时，才退回日志头扫描。

### 结构

- `src/main/sessions.ts` — 扫描、聚合、60 秒内存缓存、按需强制刷新；
- `src/shared/types.ts` — `InsightsData` / `SessionSummary` / `DailyBucket` / `WorkspaceBucket` / `ModelBucket`；
- `src/renderer/src/pages/Insights.tsx` — 总览卡片、14 天趋势、模型/工作区分布、会话明细表。

### 统计口径

- **会话数**：所有会话目录，包含 0 回合的空会话；
- **有内容**：`sessionListMetadata.blank === false` 的会话；
- **每日趋势**：按会话最后活跃时间归入本地日历日，取最近 14 天；
- **缓存命中率**：`cacheRead / (uncachedInput + cacheRead)`；
- **花费估算**：只用设置里的单价乘以 token，不查询任何在线价格。

### 隐私

扫描过程只读文件名与缓存中的数值字段，不读取消息文本，也不做任何网络请求。

## 数据位置

| 数据 | 默认路径 |
| --- | --- |
| 应用设置 | `%APPDATA%\Harness Studio\settings.json` |
| 工作区列表 | `%APPDATA%\Harness Studio\workspaces.json` |
| 提示词 | `%APPDATA%\Harness Studio\prompts.json` |
| 运行日志 | `%APPDATA%\Harness Studio\logs\` |
| 快速提问最近记录 | `%APPDATA%\Harness Studio\quickask-recent.json` |
| 便携运行时 | `%APPDATA%\Harness Studio\runtime\` |
| DSH 会话/凭据 | `%USERPROFILE%\.dsh`（与 `dsh` CLI 共用） |

便携版把 `userData` 放到可执行文件旁的 `HarnessStudioData/`（由 `PORTABLE_EXECUTABLE_DIR` 触发）。开发时可用 `HARNESS_STUDIO_USER_DATA` 隔离。

## 安全边界

- 主窗口是唯一允许 `<webview>` 的渲染进程；
- `will-attach-webview` 校验 src 的 origin 必须等于当前 Host origin，并强制注入 workspace preload；
- 默认拒绝所有权限，仅放行剪贴板、通知、麦克风与全屏；
- 外链仅允许 `http(s)` / `mailto`，其余协议拒绝；
- 不加载远程代码：界面资源全部随安装包分发。

## 浏览器预览（无需 Electron）

`npm run build && npm run preview:ui` 会启动一个仅用于 UI 开发的本地服务器，用 mock 的 `window.studio` 渲染真实 React 包。它用于截图、样式回归和设计评审，不参与生产构建。

## 已知取舍

- 会话界面复用官方 Web UI，因此上游改版会直接影响外观；外壳只注入滚动条、选中色和减少动效样式。
- Host 与 `dsh` CLI 共用 `~/.dsh`，但 Studio 自己管理进程与端口。
- 当前安装包未签名，正式分发建议配置代码签名。

## 配置档案（profile）

`dsh` 同一时间只允许一个进程写入某个 profile。为了避免和用户正在运行的 `dsh web` 争用 `profiles/web`，Studio 默认使用独立的 `studio` 档案：

1. 首次启动时，把 `$DSH_HOME/profiles/web` 的配置文件复制到 `profiles/studio`（含用户自定义的模型 provider）；
2. 重写 `package.json` 里的 profile 名称；
3. 用 `dsh --profile studio --no-open --port 0` 启动 Host。

会话、凭据仍保存在 `$DSH_HOME` 顶层，因此与 CLI 共用；只有插件配置和 profile 写锁是隔离的。可以在「设置 → 运行时 → 配置档案」把它改回 `web`，或换成任意合法名称。