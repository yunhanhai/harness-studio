# 交接说明（新对话从这里开始）

本文面向"接手继续开发"的人或 AI 助手。读完这一页就能知道项目在哪、怎么跑、下一步做什么。

## 当前状态

| 项目 | 值 |
| --- | --- |
| 版本 | `0.1.9`（已本地安装，正在发布；已完成公开下载校验的版本为 v0.1.8） |
| 开发分支 | `codex/plugin-entry`（从 v0.1.8 发布后的 `main` 开发插件管理入口） |
| 本地 HEAD | `git log --oneline -1` 确认 |
| 工作区 | `git status` 确认 |
| 已发布 | GitHub：v0.1.0～v0.1.8；Gitee：v0.1.0～v0.1.4、v0.1.6～v0.1.8（v0.1.5 只有标签；v0.1.0 / v0.1.1 / v0.1.2 仅保留说明与源码包，旧安装包已移除并备份） |
| 远端 | `origin` → GitHub，`gitee` → Gitee |
| 平台 | Windows 10/11 x64（主要目标） |

> **注意**：GitHub 与本地沿用不同的提交历史，因此相同内容的 commit SHA 可能不同。**tree SHA 是一致的**，所以文件内容逐字节相同。校验同步时比较 `git rev-parse HEAD^{tree}` 与远端 commit 的 tree，不要比较 commit SHA。

各版本的功能：

| 版本 | 内容 |
| --- | --- |
| v0.1.0 | 桌面外壳、多工作区、提示词库、实时日志、命令面板、托盘、主题 |
| v0.1.1 | 会话洞察（token / 缓存命中 / 成本估算 / 14 天趋势 / 模型与工作区分布） |
| v0.1.2 | 全局快速提问 `Ctrl+Alt+Space` |
| v0.1.3 | 快速提问历史记录（持久化 + 一键回填） |
| v0.1.4 | Host 崩溃自动恢复（指数退避 + 界面倒计时） |
| v0.1.5 | 会话/档案被占用诊断：提示可选中可关闭、DSH 进程列表与一键结束 |
| v0.1.6 | 会话标签页：一个 Host 上并排打开多个会话；工作区页面常驻，切页不再重新加载 |
| v0.1.7 | 当前标签页工作区联动、切换期间快速提问保护、发送确认与 preload 校验修复 |
| v0.1.8 | 中文、English 与跟随系统；跨窗口语言同步，保留会话与草稿 |
| v0.1.9 | 启动台与命令面板打开当前标签页的官方插件管理 |

## 当前收尾状态：v0.1.9 插件管理入口

用户在 v0.1.8 发布完成后授权按推荐继续，启动台快捷操作与命令面板的「插件管理」已完成本地开发并提交到 `codex/plugin-entry`。`store.openPlugins()` 切回工作区，在明确的当前 tab 内打开官方 Harness 的 `plugins` 面板；不增加 Host，不改 URL，插件操作仍在上游管理界面中完成。上游没有默认的官方插件市场。

实现覆盖冷挂载等待、前台 guest 核验、唯一可用中英文侧栏按钮、选中态确认、编号匹配取消、切页/切 tab/关闭/刷新/Host 重启取消与悬挂求值超时。通过现有工作区 preload 同步核验点击授权，迟到脚本不能继续点击。回归脚本为 `npm run test:plugin-navigation`，已接入 CI 与发布工作流。

`npm run typecheck`、`npm run build`、34 项插件入口回归、15 项工作区回归、11 项语言回归与独立代码审查全部通过。插件回归保留 26 项主进程场景，另有 8 项实际 store 检查，覆盖冷挂载期间 guest 连续替换、永不返回的 IPC、超时、迟到结果、订阅/监听清理与双语提示；连续绑定旧 guest 的竞态经修复前失败、修复后通过验证。

最终构建 `index-DOSvQfq1.js` 的 18 项隔离 Electron fixture 检查通过，报告与截图为 `.tools/plugin-entry-verification/`。包括中英 Home/Palette 在 1040px 下可用、前台定位、幂等、草稿与文档保留、缺失/禁用/重复/不匹配入口、未确认点击、切页/切 tab/关闭/Host 重启取消，以及 18 秒冷加载在约 15 秒提示超时，迟到文档不点击，手动重试成功。fixture 验证不等同于正式上游 UI 验证。

官方 DSH `0.2.1-rc.2` 的 9 项实际 Electron 检查也通过，报告与截图为 `.tools/plugin-entry-upstream-verification/`，与上述 fixture 的全部 6 个 out 文件哈希一致。首次 Home 冷挂载打开真实 Plugins；Home/Palette 与切 tab 后的入口只导航前台；两个独立 Session 的草稿、文档标识与 timeOrigin 保留，Host PID 不变，重复打开不重载。按既有设计，新标签可能打开上次会话位置，验收在第二标签通过官方「新建会话」建立独立会话；首次纯说明/开始使用介绍仅在隔离环境关闭或跳过。A 草稿使用 CDP `Input.insertText`，B 因自动化焦点限制改用实际 QuickAsk IPC → Electron `WebContents.insertText`（`autoSend: false`），返回 `inserted`，没有发送。使用独立 `userData` / `DSH_HOME` / `DSH_AGENTS_HOME` / Documents 覆盖；仅允许官方生成的本地浏览器认证 grant，没有模型/账号凭据，未访问用户凭据，未提交模型请求或修改插件。所有自建 Electron、Host、后代与 helper 进程均已退出。两项既有系统键盘行为仍需人工确认，不能用这轮输入验证替代。

用户在本地功能提交 `1712782` 后授权按推荐继续 v0.1.9 的安装与双平台发布。三个根版本字段为 `0.1.9`，`duplexer2` 保持 `0.1.4`；新版本 bridge 已通过隔离 fixture 验证，保留不同提交历史并核对 tree，不强推、不改既有标签。

本地构建与原地安装已完成，安装 exe ProductVersion 为 `0.1.9.0`。安装、`.tools/v0.1.9-staging/win-unpacked` 与此前通过 18 项 fixture / 9 项官方 DSH 检查的 6 个 out 文件逐字节一致；exe、app.asar 与两份语言资源也与新 staging 一致，两个快捷方式复用安装路径并带 `--open-workspace`。app.asar SHA-256 为 `dc17360b006400b2f58da7b8236fc3e45c138883093d91d80508a9e33a428c59`。Setup 为 103,998,552 bytes，Portable 为 103,729,012 bytes，另含 blockmap 与 latest.yml；更新清单的文件名、版本、大小与两处 SHA-512 均匹配本地 Setup。报告 `.tools/v0.1.9-installed-verification.json` / `.tools/v0.1.9-artifacts.json`。安装脚本仅替换已核对路径的程序目录，没有启动日常 Host、读取模型凭据或改用户数据。此前被自动审批拒绝清理的 `dist/win-unpacked` 与本次新 staging 均保留，旧 exe/asar 哈希再次核对未变。

公开包目前仍为 v0.1.8，v0.1.9 正在发布。Gitee 新预检与旧内容快照已保存到 `.tools/v0.1.9-gitee-preflight.json` / `.tools/v0.1.9-gitee-preservation-before.json`，现有附件 1,038,426,884 bytes，剩 35,314,940 bytes；本次两件新包共 207,727,564 bytes。具体方案为仅移除 v0.1.3 Setup（3462777）/ Portable（3462787），共 207,658,948 bytes，安装包已备份到 `.tools/gitee-v0.1.3-backup/` 并独立二次公开完整下载核对 SHA-256/SHA-512，GitHub 同版两件仍可匿名下载。移除并上传后剩 35,246,324 bytes。既有 v0.1.2 删除授权不涵盖 v0.1.3；本次具体确认问题已发出，尚未删除，不能按旧授权执行。

## 在新对话中如何继续

工作区就在 `D:\Program Files\develop\vscode\her`（以 `pwd` 为准），新对话里直接说清楚下面三件事即可：

**1. 指明工作目录**

> 在 `D:\Program Files\develop\vscode\her` 继续开发 Harness Studio，先读 `docs/HANDOFF.md`。

**2. 说明要做什么**

从下面挑一个，或者提你自己的需求：

- "按 HANDOFF「下一步建议」选择后续功能"
- "在已发布的 v0.1.8 基础上继续开发，先读当前状态与下一步建议"
- "给 xxx 页面加 yyy 功能"

**3. 需要时提供凭据**

推送 GitHub 需要一个有 `repo` + `workflow` 权限的 PAT；推 Gitee 需要一个 `projects` 权限的私有令牌。先检查环境变量或 Git Credential Manager 中的认证是否有效；缺失或失效时，令牌可保存到已忽略的 `.tools/github-token.txt`、`.tools/gitee-token.txt`，无需粘贴进对话。不要提交令牌。

### 新对话的第一条消息可以直接复制

```text
在 D:\Program Files\develop\vscode\her 继续开发 Harness Studio。
先读 docs/HANDOFF.md 和 docs/ARCHITECTURE.md。
v0.1.8 界面语言已合入 main、本地安装并在 GitHub 与 Gitee 发布。
两平台公开安装包完整下载验收通过，发布收尾已完成。
插件管理入口在 codex/plugin-entry 分支，先读「当前开发」与验收记录。
不要重复发布或移动已存在的标签，先读当前收尾状态与发布记录。
接下来做：<写清楚新需求>。
```

如果这条消息里包含令牌，注意它们会留在对话记录里，事后应当轮换。

## 当前收尾状态（v0.1.8 界面语言）

界面语言提交 `c4ee807` 已从 `codex/interface-language` 快进合入 `main`，新增中文、英文和跟随系统选项，入口为「设置 → 通用 → 界面语言」。语言会保存，并即时同步主窗口、命令面板与快速提问；页面、日期、托盘、菜单、原生确认及新生成的诊断使用当前语言。切换时保留会话、QuickAsk 本次输入和自动发送选择、设置草稿。词典在 `src/shared/locales/`，实现见 ARCHITECTURE「界面语言」。

`npm run typecheck`、`npm run build`、11 项语言回归、15 项导航回归和独立代码审查已通过。最终构建 `index-CXMCYaDH.js` 的 11 项隔离 Electron 检查全部通过：三窗口中英/系统语言同步、QuickAsk 输入与本次自动发送选择保留、两种设置草稿保留、六页与四标签在 1040px 下不溢出、洞察缺省标签即时翻译而不重扫、用户提示词不改写、四个 webview 的 ID/文档/草稿不变且切语言零次加载、重启后语言持久化。报告和截图为 `.tools/i18n-electron-verification/`；使用独立 `userData` / `DSH_HOME` 与无模型功能的本地 Host fixture，运行的是实际 Studio Electron/preload/IPC，没有访问用户目录或发送模型请求，隔离进程均已退出。这不替代官方 DSH 或 macOS 真机测试，前述两项真实键盘检查仍待人工确认。

官方内嵌界面、用户内容和原始日志未翻译；已显示的诊断和进度快照保留生成时的语言，后续新提示使用当前选择。版本三个根字段为 `0.1.8`，`duplexer2` 保持 `0.1.4`，发布工作流也执行语言回归。用户已授权继续安装与发布；发布准备提交为 `ab68f0013ba441045190568a76da5d8e0afbfa22`。

`npm run install:local` 与 `npm run dist -- --publish never` 已完成。安装版 ProductVersion 为 `0.1.8.0`，两个快捷方式带 `--open-workspace`；安装版、打包 staging 与此前通过 11 项 Electron 检查的全部 6 个 out 文件逐字节一致。安装版与 staging 的 app.asar、exe、两份语言资源也一致，app.asar SHA-256 为 `7ef651f621b72f93f5b84db479fdaac48f6c1bde1107406db1db16057e7c3244`。本地 Setup 为 103,996,357 bytes，Portable 为 103,726,816 bytes；latest.yml 的版本、大小及两处 SHA-512 匹配 Setup。报告：`.tools/v0.1.8-installed-verification.json` / `.tools/v0.1.8-artifacts.json`。没有启动用户日常 Host 或访问模型凭据。

两平台 main / v0.1.8 标签已原子推送，未强推，既有标签均保持不变。本地/Gitee 标签指向 `ab68f00`，GitHub 标签指向 `e41b332f5ad24e8b619dbc7bd6060ed1735800b0`，发布 tree 同为 `e8797b40a6e1a012306ec63e173a93a7aa63e8d9`。GitHub [v0.1.8 发行版](https://github.com/yunhanhai/harness-studio/releases/tag/v0.1.8)（ID `430383391`）已公开，包含 Setup / Portable / blockmap / latest.yml；[Release 工作流](https://github.com/yunhanhai/harness-studio/actions/runs/41277112720) 与 [CI](https://github.com/yunhanhai/harness-studio/actions/runs/41277112679) 均成功，发行说明已按 CHANGELOG 更新。元数据记录为 `.tools/v0.1.8-github-release-verification.json`。

GitHub 四件公开附件均已完整下载，大小与整文件 SHA-256 全部匹配 API digest。公开 Setup 为 103,996,351 bytes，Portable 为 103,726,818 bytes；Setup 完整 SHA-512 与公开 latest.yml 两处值、文件名、版本及大小均一致，报告 `.tools/v0.1.8-github-download-verification.json`。下载使用无鉴权公开 API / CDN，先校验各片段的 Content-Range 与大小，再合并并核对整文件哈希；下载辅助 Node / curl 均已退出。`.tools/v0.1.8-github-download-progress.json` 已标记 `complete: true`，不再需要续跑。GitHub 与本地分别构建，各自下载哈希核对通过，不要求两平台产物逐字节相同。README 两平台下载入口均指向 v0.1.8。

Gitee [v0.1.8 发行版](https://gitee.com/yunhanhai/harness-studio/releases)（ID `1262285`）已发布，Setup（ID `3558749`，103,996,357 bytes）与 Portable（ID `3558750`，103,726,816 bytes）已完整公开直连下载，大小、SHA-256 和 SHA-512 均与本地上传文件一致，报告 `.tools/v0.1.8-gitee-download-verification.json`。发行标题与说明、所有旧标签、旧发行说明及其他附件保留情况审计通过，记录 `.tools/v0.1.8-gitee-final-audit.json`。

用户针对具体方案回复「按照你的推荐继续下一步」，已仅删除 Gitee v0.1.2 Setup（ID `3457439`，103,964,000 bytes）与 Portable（ID `3457440`，103,694,460 bytes），释放 207,658,460 bytes。两件删除前备份到 `.tools/gitee-v0.1.2-backup/` 并二次完整下载校验，最终审计再次核对备份哈希；该版发行说明、标签、源码包与 GitHub 安装包保留。授权记录 `.tools/v0.1.8-gitee-deletion-authorization.json`。最终附件合计 1,038,426,884 bytes，按 1 GiB 上限剩余 35,314,940 bytes；下次发布需重新审计配额，现有授权不涵盖其他版本附件。预检与旧说明快照分别为 `.tools/v0.1.8-gitee-preflight.json` / `.tools/v0.1.8-gitee-preservation-before.json`。

v0.1.8 的安装、构建、双平台发布与公开下载验收已完成，发布记录见 `.tools/v0.1.8-publication-status.json`；两项既有真实键盘检查仍需人工验证。禁止重复发布、重跑 bridge 的 release 模式或移动现有标签。继续同步 v0.1.8 文档时使用 `.tools/github-bridge-v0.1.8.mjs --sync-main --base <上次成功同步的本地提交> --push`，基线从状态记录的 `githubBridgeNextBaseline` 读取。下个版本需另准备匹配新版本的 bridge，不能照搬旧版本硬编码。

自动审批拒绝 `dist/win-unpacked` 清理，原因仅为 `blocked by policy`，打包副本约 325 MiB 暂时保留。仓库外旧验证脚本和 stash 也保留，不重试此前被拒绝的清理操作。

## v0.1.7 发布收尾记录

维护修复已本地提交为 `a8b9508`，工作区联动提交为 `5b3ce82`。版本号三个根字段均已升为 0.1.7，`duplexer2` 保持正确的 0.1.4。`npm run typecheck`、15 个导航回归、构建与 preload 校验全部通过；功能代码已通过前述 15 项隔离 Electron 检查，两项真实键盘检查仍待人工确认。

`npm run install:local` 当时已将桌面版原地更新为 0.1.7，exe ProductVersion 为 0.1.7.0，两份快捷方式复用同一安装路径并带 `--open-workspace`。安装版全部 6 个 out 文件与当时构建逐字节一致，app.asar SHA-256 为 `cb4b1d6e0f1f763c95d37438a17ed26148a78676bacd84188bdb3d5594fa0848`，与该版 dist staging 一致。没有启动用户日常的 Host 或读取模型凭据。这是 v0.1.7 的历史核验记录；当前安装版已为 v0.1.8，见顶部收尾状态。

`npm run dist -- --publish never` 已完成：本地 Setup 为 103,983,344 bytes，Portable 为 103,713,805 bytes，另含 blockmap、latest.yml；公开 GitHub 产物已由 Actions 单独构建。latest.yml 的大小与两处 SHA-512 均匹配本地 Setup。验收记录位于已忽略的 `.tools/v0.1.7-artifacts.json` 与 `.tools/v0.1.7-installed-verification.json`。

两平台 main / v0.1.7 标签均已推送。GitHub 不同历史通过 `.tools/github-bridge-v0.1.7.mjs` 桥接，保留 tree、提交元数据与原有标签：本地/Gitee 发布提交为 `817fef6`，GitHub 为 `8e3b753`，tree 同为 `9350addd6f0acef3ac802c2fbc8af84dc32477f8`。GitHub [v0.1.7 发行版](https://github.com/yunhanhai/harness-studio/releases/tag/v0.1.7)（ID 430015660）已公开发布，包含 Setup / Portable / blockmap / latest.yml；[Release 工作流](https://github.com/yunhanhai/harness-studio/actions/runs/41214542918) 与 [CI](https://github.com/yunhanhai/harness-studio/actions/runs/41214542733) 均成功，发行说明已按 CHANGELOG 更新。四件公开附件已完整下载，大小与 API SHA-256 digest 全部匹配；公开 Setup 为 103,983,338 bytes，Portable 为 103,713,803 bytes，Setup 的 SHA-512 与公开 latest.yml 两处值一致。验收记录为 `.tools/v0.1.7-github-download-verification.json`。两平台分别构建，下载哈希各自核对，不要求与另一平台构建逐字节相同。

Gitee [v0.1.7 发行版](https://gitee.com/yunhanhai/harness-studio/releases)（ID 1260876）已发布，两件附件为 Setup（ID 3554461，103,983,344 bytes）与 Portable（ID 3554462，103,713,805 bytes）。两件公开安装包已完整下载，大小及 SHA-256 / SHA-512 均与本地上传文件一致，报告为 `.tools/v0.1.7-gitee-download-verification.json`。公开 API 返回 403，附件元数据通过令牌在进程内只读核验；安装包下载无需鉴权。README 的两平台下载链接与 Gitee 徽章均已更新为 v0.1.7。

经用户本次确认，仅删除了 Gitee v0.1.1 的两件旧安装附件（ID 3455589 / 3455592），释放 207,651,144 bytes。删除前完整备份到 `.tools/gitee-v0.1.1-backup/` 并复核哈希；GitHub 同版安装包、Gitee 标签/发行说明/源码包及其他版本均保留。最终附件合计 1,038,362,171 bytes，按 1 GiB 上限尚余 35,379,653 bytes；下次发布仍需检查配额。发行说明、所有原发行版与其他附件保留情况已核验，记录为 `.tools/v0.1.7-gitee-final-audit.json`。

已清理约 619.5 MiB 测试环境、旧安装包与 staging。Electron 报告和截图已复制到 `.tools/v0.1.7-workspace-verification/`，`npm run status` 确认一个程序目录、两个快捷方式、安装版本 0.1.7.0，没有 staging 副本。旧 stash 和仓库外未获准删除的验证脚本仍保留。v0.1.6 标签和公开安装包保持原样。

## v0.1.6 发布记录

v0.1.6（会话标签页）的代码在 `0620838` 提交，发布文档提交为 `6ba8677`。2026-10-31 已完成本地原地安装、发布包构建、双平台 main 与 v0.1.6 标签推送及发行版发布。[GitHub Release](https://github.com/yunhanhai/harness-studio/releases/tag/v0.1.6) 包含 Setup / Portable / blockmap / latest.yml 四件附件，[Gitee 发行版](https://gitee.com/yunhanhai/harness-studio/releases) 包含 v0.1.6 Setup / Portable 两件附件（发行版 ID `1260636`）。[Release 工作流](https://github.com/yunhanhai/harness-studio/actions/runs/41158548249) 与 CI 均通过。

GitHub 使用本机 Git Credential Manager 中的有效 PAT（`repo` + `workflow`）。Gitee 通过用户提供的 `projects` 令牌调用官方 API 创建发行版、上传附件，令牌保存在已忽略的 `.tools/gitee-token.txt`。当时 README 的两平台下载链接与 Gitee 徽章均指向 v0.1.6。

GitHub 发布标签指向 `d59c4b2`，Gitee 与本地标签指向 `6ba8677`，tree 都是 `37adaf493d1db16aab826c9447f08021f3844173`。本次通过 `git commit-tree` 在远端历史后追加内容一致的提交，再原子推送 main/tag，没有强推；本地原提交、main 与标签均保留。

| 项目 | 结果 |
| --- | --- |
| 代码检查 | `npm run typecheck` 与 `npm run build` 均通过；preload 自包含检查通过 |
| 真机验证 | 用仓库内 Electron 跑 `out/`，独立 `userData` + 独立 `DSH_HOME`（不碰 `~/.dsh`），CDP 驱动，结果见下 |
| 版本号 | `package.json` / `package-lock.json` 三个根字段均为 `0.1.6`；README 两平台下载链接与 Gitee 徽章均为 v0.1.6，CHANGELOG 日期为 2026-10-31 |
| 本地安装 | `npm run install:local` 完成；exe ProductVersion 为 `0.1.6.0`，app.asar 内版本为 `0.1.6`；`npm run status` 确认一个程序目录、两个快捷方式 |
| 发布产物 | `npm run dist -- --publish never` 完成；Setup / Portable / blockmap / latest.yml 齐全；安装版与构建版 app.asar 完全一致，latest.yml 的 SHA-512 与文件大小均匹配 Setup |
| 公开下载 | GitHub 四件附件已完整下载核对 SHA-256，Setup 的 SHA-512 与公开 latest.yml 一致；Gitee 两件附件已完整下载核对 SHA-256，与本地待上传文件一致 |

真机验证覆盖的行为（全部通过）：

- 冷启动停在启动台时不创建任何 webview；第一次进入工作区才挂载；
- 两个标签用同一个带令牌的 `host.url` 都能进入会话界面；
- 切标签、切到启动台再切回，两个标签的页面都没有重新加载，各自的输入框内容还在；
- 停在启动台时，藏起来的工作区页面不接收点击（真实鼠标事件只落到启动台）；
- 快速提问只写入前台标签；切标签后跟着换目标；停在启动台时先切回工作区再写入；关掉一个标签、重启运行时之后都还能找到正确的 guest；
- `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` / `Ctrl+Shift+Tab` 在 Studio 界面和内嵌会话界面里都生效；焦点在 `.xterm` 内时按键原样交给终端，不新建也不关闭；最后一个标签按 `Ctrl+W` 不会被关掉；
- 达到上限时「+」禁用、提示上限文案；从命令面板在别的页面「关闭当前会话标签页」会先切回工作区；
- 重启运行时后收拢成一个标签，指向新端口；主题切换推到所有标签；
- 1040px 最小窗口宽度下 4 个长标题标签与工具栏同在一行，不换行、不重叠；
- 多开一个空会话标签，Electron 进程私有内存合计从 368 MB 到 474 MB（单次测量，会话内容越多占用越大）。

**剩余人工确认**：

- 真实键盘焦点：`Ctrl+Tab` 切换后，Studio 一侧的 `document.activeElement` 已确认指向新标签的 webview，但测试窗口拿不到系统焦点，「接着打字是否落在新标签」需要手动试一次；
- v0.1.5 遗留：开启「每次发送前确认」后，在输入框里真实按回车应弹出确认框（Lexical 忽略 CDP 合成事件，无法自动验证）。

**v0.1.6 发布已完成**：本地安装、构建、打标签、代码推送、两平台发行版与附件下载校验均已完成。不要重复打标签或发布；上面的两项真实键盘行为仍待人工确认，v0.1.7 的工作区联动实现见「下一步建议」。

本次 Gitee 发布包：Setup 为 103,977,982 bytes（约 99.2 MiB），Portable 为 103,708,449 bytes（约 98.9 MiB），均已上传成功。GitHub 使用 Actions 构建的附件，Setup 为 103,977,976 bytes、Portable 为 103,708,446 bytes；两平台来自相同源码，但构建产物字节略有差别，各自的下载校验分别通过。

Gitee 初次上传返回 `400`：「文件大小已超出仓库附件配额：1 GB」。经用户确认，已仅删除 Gitee v0.1.0 的两个旧安装附件（ID `3452550` / `3452553`），释放 207,636,134 bytes；标签、发行说明、源码包、其他版本及 GitHub 安装包均保留。旧安装包先完整备份到 `.tools/gitee-v0.1.0-backup/`，核对了大小与 SHA-256，后续可恢复。v0.1.6 发布后安装附件合计 1,038,316,166 bytes，当前配额见顶部 v0.1.7 记录。

v0.1.6 发布后的 `npm run clean:dist` 已清掉测试目录、旧安装包和 staging 副本，共释放约 1051.8 MiB；当时 `npm run status` 确认只有一个程序目录、两个快捷方式，安装版本为 0.1.6.0。`stash@{0}` 仍保留；仓库外 `C:\Users\Administrator\AppData\Local\Temp\hs-tabs-verify` 的删除被自动审批策略拒绝，也仍保留。

### 不需要重新做的事

- 仓库已建好、双平台已发布，不用重新初始化；
- 依赖已装好（`node_modules` 在），除非你要升级依赖；
- v0.1.6 / v0.1.7 的功能、typecheck、build、导航回归与隔离 Electron 验证已完成，不用重做；两项真实键盘检查仍待人工确认（见发布记录）。

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
    plugin-navigation.ts   当前标签页插件面板导航、同步点击授权、确认与取消
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
    pages/HarnessPane.tsx  每个会话标签一个 <webview>，常驻挂载，只切可见性
    components/            Rail、Titlebar、Palette、QuickAsk、ErrorBoundary 等
    components/TabStrip.tsx 工作区工具栏里的会话标签条
    store.ts               zustand 全局状态
    styles/index.css       全部样式（约 3800 行，Tailwind v4 + 自定义 CSS 变量）
  shared/
    types.ts               所有跨进程类型与 StudioApi 契约
    channels.ts            IPC 频道常量（preload 里只能复制字面量，不能 import）
    defaults.ts            默认设置、内置提示词、仓库地址
scripts/
  check-preload.mjs        build 后校验 preload 自包含与 workspace IPC 通道契约
  test-workspace-navigation.mjs 工作区导航与取消回归（npm run test:workspace-navigation，CI 自动执行）
  test-plugin-navigation.mjs 插件面板导航与前端等待回归（npm run test:plugin-navigation，CI 自动执行）
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
- **从 VS Code 集成终端（包括其中的 AI 助手）启动 Electron 前要清掉 `ELECTRON_RUN_AS_NODE`**：VS Code 会导出 `ELECTRON_RUN_AS_NODE=1`，Electron 随之当成纯 Node 运行，`out/main/index.js` 一加载就报 `Cannot read properties of undefined (reading 'getVersion')`（electron-updater 拿不到 `app`）。
- **模型凭据与路由在 `~/.dsh/profiles/<name>/cordis.patch.yml`，不在本仓库**。本机 `studio` 与 `web` 两个 profile 都走中转：`primerelay`（默认模型 `deepseek-v4.1-flash-1017`，注意该中转**已不再提供** `deepseek-v4.1-flash`，用错 id 会得到 404 `model_not_found`）、`ultrarouter`、`wzw`。改这个文件前先备份，且必须用 Node 脚本写（PowerShell 会写 BOM，DSH 解析 `package.json` 时会直接报 `Unexpected token '\uFEFF'` 起不来）。
- 排查模型请求问题最有效的手段是**在 `baseURL` 前挂一个抓包代理**，把 profile 临时指向 `http://127.0.0.1:<port>/v1`，就能看到 DSH 实际发出的请求体（roles、字段、重试次数）与提供方返回体。比翻日志快得多，也是确认 `reasoning_content` 这类字段问题的唯一可靠方式。
- 验证多轮场景用 `dsh --profile <name> --json "<task>"` 拿到 `sessionId`，再用 `--session-id <id>` 续跑——只有续跑那次请求才会带上 assistant 历史。
- `dsh --profile headless` 需要凭据走环境变量；密钥在 `~/.dsh/.credentials.yaml`（`PRIMERELAY_API_KEY` / `ULTRAROUTER_API_KEY` / `WZW_API_KEY`），读取时不要打印明文。

## 验证方式

改完一定要跑：

```powershell
npm run typecheck
npm run test:workspace-navigation
npm run test:plugin-navigation
npm run test:i18n
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

**不想碰本机 `~/.dsh` 时**（v0.1.6 的真机验证就是这么做的）：在隔离的 `userData` 里写一份 `settings.json`，把 `runtime.dshHome` 指向一个空目录、`shortcuts` 三项设为空字符串（不抢本机全局快捷键），再用 `HARNESS_STUDIO_USER_DATA` 指向它启动。首次启动会从内置模板建 `studio` 档案（本机实测约 47 秒），之后几秒就绪。没有凭据也能进入会话界面，只是会弹「开始使用」登录框。注意内嵌界面仍会把「默认工作区」放在系统「文档」目录下的 `deepseek-harness\default-workspace`。

插件入口验收时查到官方 DSH `0.2.1-rc.2` 支持覆盖默认工作区基目录：在隔离 `DSH_HOME/cordis.patch.yml` 中为 `id: workspace-controller` 设置 `config.documentsDirectory` 为隔离目录内的绝对路径；它完全跳过系统 Documents 查找，并在该路径下追加 `deepseek-harness/default-workspace`。同时隔离 `DSH_AGENTS_HOME`，为 `id: credentials` 设置隔离的 `config.path` 与 `watch: false`，启动环境只保留所需系统变量和测试变量。这样正式上游 UI 验收也能把会话、凭据文件、技能和默认工作区写入位置限定在 QA 目录。仅改进程 cwd 不足以覆盖默认工作区位置。

**注意**：截图脚本必须禁用缓存，否则会拿到旧构建的图（这个坑踩过）。`shot.mjs` 已加 `Network.setCacheDisabled`。

## 下一步建议

按我评估的性价比排序：

### 1. 工作区联动（v0.1.7）

v0.1.6 的切换只改 Studio 自己的项目标签，内嵌会话不跟随。v0.1.7 已将目录登记与内嵌导航接起来：只打开捕获的当前 tab，核对会话实际 `cwd` 后确认项目；其他 tab 保留原会话和草稿，Host 不重启。标题栏、状态栏和工具栏都跟随前台 tab，在内嵌界面手动导航也会反向同步。未知项目保留实际路径、不自动添加 Studio 书签；删除书签不停止共享 Host。

导航按 guest 串行，新目标、关 tab、刷新、重启和取消均使旧请求失效；实际点击时同步检查主进程令牌，取消会立即结算，不会被已经销毁的 guest Promise 卡住。快速提问只认明确前台，在聚焦或发送期间发生切换会中止对应步骤。实现与协议细节见 `docs/ARCHITECTURE.md`「当前标签页的工作区联动」。

**仍有边界**：上游没有 URL 路由，登记/查询 RPC 与侧栏 DOM 可能随版本变化，失败时提示并保留最后确认的目录。返回旧项目时优先复用记住的可见会话；官方侧栏隐藏非当前空会话，只有草稿而无消息的旧会话可能被新的空会话替代显示，原草稿仍保留在原会话。没有通过空会话项目下拉复用，因为上游该入口会转移草稿和附件。

验证已完成：`npm run typecheck`、`npm run build`（两个 preload 自包含、7 个 workspace IPC 调用）、`npm run test:workspace-navigation`（15 场景）均通过；独立只读复核的 8 个 QuickAsk 场景也通过。导航回归覆盖已排队点击取消、guest 销毁时 Promise 悬空、新请求不被旧请求阻塞、同端口重启、未知项目和输入目标失效。

隔离 Electron 的 15 项检查全部通过：首次打开目录、只切前台、后台会话/草稿/文档保留、Host 复用、快速连续切换、内嵌导航反向同步、聚焦期间切前台阻止写入、文本插入后切前台阻止自动发送、关闭待切换标签立即结算取消，以及重启后收拢一个标签并恢复前台项目的真实 `cwd`。使用独立 `userData` + `DSH_HOME`，没有读取用户模型凭据或发送模型请求；自动发送按钮被验证脚本临时替换为计数动作。报告 `.tools/v0.1.7-workspace-verification/integration-report.json` 无异常，截图为同目录 `integration-final.png`，隔离 Electron 与 Host 均已退出。首次验证暴露的 guest 绑定被资源加载清掉、销毁 guest 后 Promise 悬空问题均已修复。

这些改动属于 v0.1.7，发布状态见顶部「v0.1.7 发布收尾记录」。不要将这项改动写入已发布的 v0.1.6 功能或移动 v0.1.6 标签。前述两项真实键盘检查仍需要人工验证，不能将 DOM/合成事件验证视作完成。

### 2. 对话界面内部的定制

凡属"对话界面内部"的能力（排队消息拖动排序、逐字流式的渲染细节等）都在 DSH 上游。npm 分发的 `@deepseek-ai/dsh-*` 是**压缩产物、不含源码**，因此只能注入或打补丁。

自建会话界面的可行性已实测（结论见 `docs/ARCHITECTURE.md` 的「能不能不用官方 Web UI」一节）：ACP/SDK 能驱动会话，但两条线路都**没有逐字流式**、**没有队列编辑/插话**。要拿到这两项，只能继续用官方 Web UI。

### 3. 其他

- **macOS 构建**：`.github/workflows/release.yml` 加 `macos-latest` job 即可，但本环境无法验收，需要真机测试。另外 `src/main/menu.ts` 把 `Command+W` 绑在「隐藏窗口」上，而会话标签页把 `Cmd+W` 用作关闭标签：页面 `preventDefault` 之后菜单大概率收不到，结果是 `Cmd+W` 只关标签、焦点在终端时才隐藏窗口。做 macOS 构建前要在真机上确认并决定保留哪一个。
- **插件管理入口（当前开发）**：启动台与命令面板打开当前标签里的官方管理页，进展见顶部。上游没有默认的官方插件市场，入口不能称为市场或承诺一键安装。
- **界面英文化（v0.1.8）**：已合入 main、安装并双平台发布，公开下载完整哈希验收通过，详情见顶部「当前收尾状态」。

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

### 已完成（v0.1.6）

会话标签页，详见 `docs/ARCHITECTURE.md` 的「会话标签页」一节：

- 一个 Host、每个标签一个 `<webview>`，共用 `persist:harness-studio` 分区；没有采用 `stash@{0}` 里那份每个标签一个 Host 的方案（冷启动、内存、profile 写锁三重代价）。那份 stash 已被取代，确认不需要后可以 `git stash drop`；
- 工作区页面第一次进入后常驻，离开时只藏起来（`visibility: hidden`），切页不再重新加载；
- 主进程按 `webContents.id` 记录所有 guest，快速提问写入前台标签；快捷键按焦点分三路处理，内嵌终端里的按键不拦截；
- 设置 → 通用 → 会话标签页：上限 1–8（默认 4）；
- 版本号升到 `0.1.6` 时顺手修了 `package-lock.json` 的两处旧错：`duplexer2` 曾被批量替换成 `0.1.5`（实际 tarball 是 `0.1.4`），根包条目一直停在 `0.1.1`。以后升版本只改这两个根字段，不要全文替换。

**遗留的小事**：

- 内嵌界面会把输入草稿存进浏览器存储，新标签打开某个会话时会带出这个会话之前保存的草稿；之后各标签里的输入互不影响（真机验证过）。

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
# 6. Gitee 用官方附件 API 或网页上传安装包（Gitee 不跑 Actions）
```

两个平台的 Release 都要有 `Setup.exe` 与 `Portable.exe`。Gitee 同时限制单个附件和仓库附件总量；上传前检查总额度，上传后核对公开下载的大小与哈希。操作步骤见 `docs/PUBLISHING.md` 的「在 Gitee 发布附件」。
