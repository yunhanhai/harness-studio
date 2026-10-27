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

### 启动耗时与工作区复用

Host 冷启动约 **10 秒**。实测结论（避免后人重复排查）：

| 假设 | 实测 | 结论 |
| --- | --- | --- |
| 插件太多 | 完整 studio（30 层）10.7s vs `base+web-app` 无自定义 10.7s | **与插件数量无关** |
| 网络等待 | 阻断网络后 14.0s | **不是网络**，阻断反而更慢 |
| JS 编译开销 | `NODE_COMPILE_CACHE` 冷/热 12.3/11.6s，缓存目录 0 MB | **编译缓存无效** |
| 配置树组合 | `--dump-config` 260ms | 只占 2.5% |

这 10 秒在 DSH 启动器自身的初始化里，**Studio 无法消除**，只能避免重复支付。

**关键架构事实：DSH 本身是多工作区服务。** `ctx.workspaceRegistry` 维护持久项目列表（`workspace/create`、`insertBefore` 等 Remote 方法），**每个会话自带 `cwd`**（`session.header.cwd`），进程的工作目录只是默认值。因此切工作区**不需要重启进程**：

- `HostManager.canAdoptWorkspace()` 比较运行时、`DSH_HOME`、profile、端口与额外参数（`processIdentity()`）——这些是进程无法被改变的，任一变化仍需真正重启；
- 全部相同时 `adoptWorkspace()` 只更新 `HostStatus.workspaceId`，目录由 Host 自己的注册表处理；
- 冷启动时 `bootstrap()` 在窗口创建后**立即并行**探测运行时并启动 Host（`warmup`），把等待藏在界面加载与更新检查背后。

### 发送确认

内嵌界面按下回车就立即提交，误触无法撤回，且队列里的待发消息会被一并提交。Studio 在 webview preload 里拦下这两个入口：

- **捕获阶段**监听 `keydown`（Enter，排除 Shift/Alt/Ctrl/Cmd 与输入法合成）与发送按钮的 `click`；
- 命中后通过 `guest:confirm-send` **同步**询问主进程，弹原生确认框（同步是必须的：捕获阶段的事件处理器无法等待 Promise）；
- 队列里有消息时，确认框会写明「会连同 N 条排队消息一起提交」；
- 设置 → 通用 → 发送确认 可分别开关「每次发送前确认」与「队列额外提醒」，默认只开后者；
- 拿不到答复时**放行**（fail-open），保证外壳故障不会堵住发送。

**两个实现细节**（改动此处必读）：

1. 输入框是 Lexical 渲染的 `<div role="textbox" contenteditable="…">`，`contenteditable` 的值不可靠，必须按 `[role="textbox"]` 或 `[data-composer-card]` 内查找；
2. preload 运行在 `contextIsolation` 的隔离世界，**页面看不到 preload 的 `window` 属性**。这不妨碍拦截——隔离世界的捕获阶段监听一样能收到并取消 DOM 事件——但意味着自动化验证不能靠 `window.__hsGuardTest`，preload 因此额外监听跨世界的 `hs-guard-test` 事件供测试驱动。

**已知限制**：拦截依赖官方输入框与按钮的 DOM 结构，上游改版可能让它失效；失效时退回「直接发送」，不会报错也不会卡住。

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

### 会话 / 档案被占用

Harness 对「一个 profile 只能被一个进程写入」和「一个会话只能被一个写入者持有」做了跨进程加锁：Windows 上档案锁是 `package.json.lock` 文件，会话锁是内核命名信号量。因此当你在别处还开着 `dsh web`、桌面端或另一个 Studio 时，界面会弹出：

> 当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。

这条提示**原本既不能选中也不能关闭**：它是官方 UI 的一个瞬态 toast，`position: fixed` + `pointer-events: none`，3 秒后自己淡出。Studio 从两侧修掉这个问题：

1. **镜像提示**（`src/preload/workspace.ts`）：webview 的 preload 用 `MutationObserver` 观察 `role="alert"` 且 `pointer-events: none` 的节点，读出文本后通过 `guest:notice` 交给主进程，并给原节点打上 `data-hs-mirrored` 隐藏。Studio 自己的 toast 可选中、可复制、可关闭、默认不自动消失，并把文案归类成 `session/writer-held` 或 `profile/locked`，只有这两类才附带「结束其他 DSH 进程」按钮。
2. **进程可见**（`src/main/instances.ts` + 设置 → 运行时 → 其他 DSH 进程）：列出本机所有 `dsh` 进程（PID、profile、web/命令行、完整命令行），标出 Studio 自己的那个并禁用其「结束」按钮；结束前弹确认框，执行 `taskkill /T /F`。

### 模型请求 400：`reasoning_content` 必须回传

走第三方中转（profile 里 `baseURL` 指向非 `deepseek.com` 域名）时，多轮对话可能报：

> The `reasoning_content` in the thinking mode must be passed back to the API. (`invalid_request_error`, HTTP 400)

**根因**：pi-ai 靠 URL 猜协议兼容性——

```js
const isDeepSeek = provider === "deepseek" || baseUrl.toLowerCase().includes("deepseek.com")
// ...
requiresReasoningContentOnAssistantMessages: isDeepSeek
```

中转域名既不是 `deepseek` 也不是 `deepseek.com`，所以这个开关是 `false`，[openai-completions.js] 里补空字段的分支不执行；一旦历史中某条 assistant 消息没有有效的 `thinkingSignature`，重放时就不会带 `reasoning_content`，而 DeepSeek 在 thinking 模式下要求该字段必须存在。**这是确定性的**：只要历史里有这样一条消息，之后每次请求都会 400。

**修复**：在 profile 的路由级 `compat` 里显式打开（该字段在 pi-ai 的 `offer` 白名单内，profile 可设置；`model.compat.X ?? detected.X`，配置优先于探测）：

```yaml
providers:
  primerelay:
    api: openai-completions
    baseURL: https://primerelay.online/v1
    compat:
      requiresReasoningContentOnAssistantMessages: true
    retryPolicy:
      mode: normal
      maxRetries: 25
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]
```

**为什么不能只加重试次数**：该错误经 `classifyPiAiError` 归类为 `INVALID_REQUEST`（`/\b400\b|invalid.?request/i`），不在默认重试集合内，所以默认直接中断。但把它加进重试集合也**解决不了问题**——历史里那条消息一直在，重试 N 次就是 N 次相同的 400，只会延迟失败并白烧请求额度。必须是先修 `compat`，重试次数只用于真正的瞬时故障（限流、5xx、超时）。

**实测对照**（同一轮两回合的 `--session-id` 续跑，抓取真实请求体）：

| 配置 | 重放的 assistant 消息字段 | 结果 |
| --- | --- | --- |
| 有 `compat` | `content \| reasoning_content \| role` | 全部 200 |
| 无 `compat` | `content \| role` | 字段缺失，触发 400 |

配置改动后在**下次启动 Host 时**生效，改完需要重启运行时。


**权限受限时会明说。** `Win32_Process` 按调用者的完整性级别过滤：Low 完整性令牌（`S-1-16-4096`）只能看到机器的一小部分，而且**不报错**。这会把手里的「看不到」伪装成「没有」，正好给出错误的建议。所以扫描同时检查两件事——能不能枚举到自己、令牌是不是 Low——任一成立就把 `DshProcessReport.restricted` 置为 `true`，界面显示琥珀色警告而不是「没有发现其他 DSH 进程」。

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

### preload 必须自包含（构建时强制）

两个 preload 都跑在 `sandbox: true` 下，只能 `require('electron')` 和 Node 内置模块。如果两个入口 import 同一个 `@shared/*` 模块，Rollup 会把它拆成 `chunks/*.js`，preload 顶部随之出现 `require("./chunks/...")`，在沙箱里直接抛错——**整个 preload 失效，`window.studio` 不存在，界面永远停在启动页，而且控制台之外没有任何提示**。

这个坑在 v0.1.5 真实踩到过（workspace preload 引了 `@shared/channels`）。现在的约束是：

- 类型可以 import（`import type` 会被擦除），**值不行**；
- 需要在 preload 里用的通道名，就地写成常量，并在主进程侧保持一致；
- `scripts/check-preload.mjs` 在每次 `build` / `dist` 后检查产物里有没有相对 `require`，发现即让构建失败。

## 浏览器预览（无需 Electron）

`npm run build && npm run preview:ui` 会启动一个仅用于 UI 开发的本地服务器，用 mock 的 `window.studio` 渲染真实 React 包。它用于截图、样式回归和设计评审，不参与生产构建。

## 能不能不用官方 Web UI（自建会话界面）

这个问题被实测验证过，结论写在这里，避免重复调研。**回答：技术上可行，但会丢失两项关键体验。**

DSH 除了 Web UI 的私有 RPC，还对外提供两条**官方支持的**驱动线路：

| 线路 | 形态 | 定位 |
| --- | --- | --- |
| **ACP** | `@agentclientprotocol` 公开标准，profile 模板 `acp` | 跨 agent 通用，有官方第三方 SDK |
| **SDK** | DSH 自有 stdio JSON-RPC，profile 模板 `sdk` | 面向外部客户端，无版本协商承诺 |

实测能力对照（两条线路都不需要私有 RPC）：

| 能力 | ACP | SDK |
| --- | --- | --- |
| 建会话 / 恢复 / 取消 | ✅ | ✅（无 cancel，靠关进程中止） |
| 列出会话 | ✅ 带游标分页 | ❌ |
| 模型与 reasoning effort 切换 | ✅ | ❌（仅初始化时） |
| 工具调用事件、审批交互、图片 | ✅ | ✅ / ❌ 审批 |
| **逐字流式输出** | ❌ 整轮结束才一次性到达 | ❌ 同左 |
| **队列增删改 / 插话** | ❌ 并发直接报错 | ⚠️ 只能追加（等同 `queue`），无编辑/删除/steer |

**两个决定性缺口**：

1. **没有实时流式。** token 级 delta 确实存在且被完整保留（平均 13 字符/条），但只在**轮末**随 durable 事件一次性下发。真流式只存在于 Web UI 的私有通道（进程内 `agent/assistant-stream` 瞬时帧），ACP 与 SDK 对它的订阅数都是 0。自建 UI 只能"整段蹦出来"。
2. **没有队列管理。** `session/updateQueue` 的 edit/remove/steer 在两条线上全部 method-not-found；ACP 甚至硬拒并发提交（`a prompt is already in flight`）。

**对决策有利的一点**：ACP/SDK 与官方 Web UI **共用同一个 `$DSH_HOME/sessions` 存储**——外部客户端能列出、甚至接管 Web UI 创建的会话（实测 resume 成功）。自建 UI 不会把用户锁在既有历史之外；历史渲染需自己解析日志（注意 `session.v4.jsonl.zstd` 是**多帧拼接**容器，整文件解压只出第一帧，必须扫帧魔数逐帧解）。

**因此**：

- 要**逐字流式**或**队列编辑/插话** → 只能继续用 webview 加载官方 Web UI（现状）；
- 能接受"整段显示 + 客户端自行排队" → 走 ACP 自建 UI 可行，且能顺带支持其他 ACP agent；
- **不要**反向调用私有 RPC：无文档、无稳定承诺，还要挂载 web-app bundle，比 webview 更脆弱。

## 已知取舍

- 会话界面复用官方 Web UI，因此上游改版会直接影响外观；外壳只注入滚动条、选中色、减少动效样式，以及发送确认与提示镜像这类**在 webview 内注入**的补丁。
- 凡是"对话界面内部"的能力（排队消息拖动排序、逐字流式的渲染细节等）都属于 DSH 上游；npm 分发的 `@deepseek-ai/dsh-*` 是**压缩后的产物，不含源码**，因此只能注入或打补丁，不能像改本仓库一样直接改。
- Host 与 `dsh` CLI 共用 `~/.dsh`，但 Studio 自己管理进程与端口。
- 当前安装包未签名，正式分发建议配置代码签名。

## 配置档案（profile）

`dsh` 同一时间只允许一个进程写入某个 profile。为了避免和用户正在运行的 `dsh web` 争用 `profiles/web`，Studio 默认使用独立的 `studio` 档案：

1. 首次启动时，把 `$DSH_HOME/profiles/web` 的配置文件复制到 `profiles/studio`（含用户自定义的模型 provider）；
2. 重写 `package.json` 里的 profile 名称；
3. 用 `dsh --profile studio --no-open --port 0` 启动 Host。

会话、凭据仍保存在 `$DSH_HOME` 顶层，因此与 CLI 共用；只有插件配置和 profile 写锁是隔离的。可以在「设置 → 运行时 → 配置档案」把它改回 `web`，或换成任意合法名称。