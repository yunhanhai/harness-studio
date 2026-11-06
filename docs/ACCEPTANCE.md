# v0.1.12 验收

本版范围为模型设置、首次选择、DSH 本地技能中心及其可靠性修复。**v0.1.12 已于 2026-11-06 在 [GitHub](https://github.com/yunhanhai/harness-studio/releases/tag/v0.1.12) 与 [Gitee](https://gitee.com/yunhanhai/harness-studio/releases) 公开发布**，两平台全部公开附件均已完整匿名下载并核对哈希；GitHub 更新清单与 Setup 一致。汇总证据 `.tools/v0.1.12-publication-status.json`。功能验收、协议 fixture、真实模型及人工操作分别记录，不互相替代。

最终发布包的一键安装固定使用已验收的 DSH `0.2.1-rc.2` 与 Node 22，避免移动的 `latest` 已变为要求 Node.js 24.9+ 的 `0.2.2-rc.1`。发布目录为 `.tools/v0.1.12-release-staging`，完整性报告 `.tools/v0.1.12-release-artifacts.json`；Setup、Portable、更新清单、blockmap 和 app.asar 均通过校验。最终实际打包程序的 **8/8 项官方 DSH 检查通过**，报告 `.qa-upstream/electron-kyhicV/report/report.json`，确认 `version=0.1.12`、`isPackaged=true`、打包内容与对应 `out` 一致且执行前后稳定、无未捕获异常、模型请求或提供商凭据写入，所有本轮进程已退出。此前 `.qa-upstream/electron-z5OLGw/report/report.json` 属于安装版本固定前的候选验收，不能替代这份最终报告。

发布源的 GitHub [CI](https://github.com/yunhanhai/harness-studio/actions/runs/42158592498) 与 [Release](https://github.com/yunhanhai/harness-studio/actions/runs/42158592330) 成功。独立 [DSH compatibility](https://github.com/yunhanhai/harness-studio/actions/runs/42158592362) 首次执行在 Electron 程序缺失处失败：技能和适配器步骤已通过，GUI 未启动。后续工作流增加 Electron 显式安装与存在检查后，GitHub 主线提交 `58eebf6f376342d6ece1bab0beb02c82bcfbf1cc` 的 [完整 CI](https://github.com/yunhanhai/harness-studio/actions/runs/42164874020) 和 [基线 DSH compatibility](https://github.com/yunhanhai/harness-studio/actions/runs/42164874071) 均成功，包括实际 Electron 界面步骤；这些后续改动属于 `Unreleased`。

安装升级与两项人工键盘检查仍 **pending**，已在发行说明中披露。本机安装记录仍为 `0.1.11.0`；升级前程序、四项用户状态及快捷方式已备份，自动安装被 Windows 安全提示阻挡后交由用户手动操作。实际打包程序通过不等于安装成功。人工准备会话 `.qa-upstream/electron-dxySnr/report/keyboard-session.json` 是当时快照，相关 runner、GUI 和 Host 目前均无进程，未收到人工结果；不能将旧快照的 `awaiting` 当作窗口仍开着，也不能将自动输入或用户“继续”记为人工通过。

Gitee 清理仅执行了直接授权的 v0.1.7 Setup `3554461` 与 Portable `3554462`，删除前完整备份并核对哈希；该版标签、说明、源码及 GitHub 安装包保留。证据 `.tools/v0.1.12-gitee-prune-verification.json`，授权不涵盖其他附件。

2026-11-05 的功能验收记录：类型检查、构建、179 项/组仓库回归和 4 项同步回归通过；官方 DSH `0.2.1-rc.2` 的解析对照 9 项、loopback 协议 6 项、Electron 默认检查 8 项通过。用户指定的 `ultrarouter.org` / `deepseek-v4.1-flash` / Chat Completions 最终三轮真实验收通过，含技能指令加载与实际 `read` 工具读取；报告 `.qa-upstream/electron-L0Hpgp/report/report.json` 和同目录 `live-tool-evidence.json`。最终发布前的变更仅涉及安装版本固定，两个 preload 与 renderer 保留该验收构建内容，未重复付费调用。测试进程和临时凭据已清理。

发布后的 `Unreleased` 优化已检查所选 DSH 程序包的 `engines.node`，在不兼容、声明无效或元数据无法读取时阻止启动，并补充运行时诊断与保存后重新检测。根主线的 `npm ci`、运行时 10 组、语言 11 组回归、类型检查、构建与 preload 校验已通过，完整 CI 与基线 DSH 兼容检查也已通过。该优化不改变已发布的 v0.1.12 标签或附件，检测范围及上游依据见 [UPSTREAM_REVIEW.md](UPSTREAM_REVIEW.md)。

## 仓库回归

在 Windows、Node.js 22+、已安装依赖的 checkout 中运行：

```powershell
npm run typecheck
npm run test:workspace-navigation
npm run test:plugin-navigation
npm run test:model-navigation
npm run test:skills
npm run test:session-tab-focus
npm run test:conversation-font
npm run test:i18n
npm run test:gitee-sync
npm run test:runtime
npm run build
```

技能测试包含保存/删除/恢复时的文件 API 故障、新服务实例重试、外部编辑保护，以及 Windows 指令文件大小写和历史备份恢复。它不代表断电或磁盘硬件故障测试。Gitee 测试只使用临时本地 Git 仓库，执行工作流的实际同步脚本。

`test:runtime` 是发布后新增的 `Unreleased` 检查，使用内存中的程序包元数据与模拟 Node 探测验证版本兼容分支；它不启动 DSH，也不验证完整依赖树或模型调用能力。

## 官方 DSH 兼容检查

基线版本为 `@deepseek-ai/dsh@0.2.1-rc.2`。参数指向安装的 **程序包目录**，不是含账号和会话的 `DSH_HOME`。可复用已有程序安装，也可在专用目录安装：

```powershell
npm install --prefix .qa-upstream/runtime --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.2
$dshPackage = Join-Path (Get-Location) '.qa-upstream/runtime/node_modules/@deepseek-ai/dsh'
npm run test:upstream:skills -- --dsh-package "$dshPackage" --expect-version 0.2.1-rc.2 --report .qa-upstream/reports/skills.json
npm run test:upstream:adapter -- --dsh-package "$dshPackage" --expect-version 0.2.1-rc.2 --report .qa-upstream/reports/adapter.json
npm run build
npm run test:upstream:electron -- --dsh-package "$dshPackage" --expect-version 0.2.1-rc.2
```

| 检查 | 验证范围 | 不代表 |
| --- | --- | --- |
| `test:upstream:skills` | 实际 filesystem provider 与 Studio 的技能元数据解析对照 | 实际会话技能目录或调用 |
| `test:upstream:adapter` | 实际模型适配器连接 loopback SSE；文本、两轮历史、分片工具调用和合成工具结果回传 | 真实模型推理、系统工具执行、其他协议 |
| `test:upstream:electron` | 构建后的 Studio + 官方 Web UI；首次选择、模型入口、两标签草稿与英文布局 | 真实模型连通性、人工键盘 |

Electron 检查会打开独立测试窗口，设置独立 userData、DSH_HOME、agents、用户目录、默认工作区和临时目录，禁用全局快捷键。它只从传入路径读取 DSH 程序包，不复制日常账号。输入草稿前同时等待 Studio 项目切换结束与官方会话实际 cwd 确认；退出时核对本轮进程，不把复用的父 PID 当作归属依据。

默认报告和截图在 `.qa-upstream/electron-<随机值>/report/`，命令会打印准确路径。`--report-dir` 可指定一个尚不存在的目录。`--expect-version` 在测试其他具体版本时替换成该版本，省略时记录实际版本。

使用 `--app-executable` 可测试已安装或 `win-unpacked` 中的实际程序。启动前后核对 exe / app.asar，并校验程序版本、完整应用构建哈希、`isPackaged` 与隔离数据路径。用于测试的程序须与当前 checkout 和 `out` 一致。

```powershell
npm run test:upstream:electron -- --dsh-package "$dshPackage" --expect-version 0.2.1-rc.2 --app-executable "$env:LOCALAPPDATA/Programs/Harness Studio/Harness Studio.exe" --keep-open-for-keyboard
```

`--keep-open-for-keyboard` 在 8 项自动检查通过后保留两个独立草稿，切回中文工作区，并开启、读回「每次发送前确认」。见命令打印的 `keyboard-session.json`。人工使用 `Ctrl+Tab` / `Ctrl+Shift+Tab` 后直接打字，确认只进入当前会话；再真实按 Enter，确认弹框，选择取消后草稿保留。此模式不配置模型凭据，不能与真实模型模式合用。关闭测试窗口或创建报告指定的 `stopRequestFile` 后，脚本退出并清理本轮隔离账户和浏览器状态；关闭窗口不代表人工验收通过。报告的无模型请求结论只覆盖自动阶段，人工结果单独记录。

`.github/workflows/upstream-compatibility.yml` 在相关 main/PR 变更时固定使用 Node.js 22 检查 `0.2.1-rc.2` 基线，不以 `latest` 作为自动门槛。手动运行可填写另一个精确 `dsh_version`，并从 `node_version` 选择 22 或 24，默认仍为 22。DSH `0.2.2-rc.1` 要求 Node.js 24.9+，检查该版本时需手动选择 24；工作流只在 CI 的临时目录安装所选版本，不升级用户运行时，也不改变默认基线。

工作流在 `npm ci` 后显式运行 Electron 安装脚本，并确认 `node_modules/electron/dist/electron.exe` 存在后再开始验收，避免依赖安装结束但 Electron 未下载造成误报。报告与截图作为 artifact 保存；它不配置真实服务或发送付费请求。

## 显式真实模型验收

真实模式只支持本次指定的 OpenAI Chat Completions 端点。它会在隔离的 Harness 原生表单中保存专用测试提供商，然后最多提交三个提示词：短回答、多轮历史，以及技能/文件读取。先确认服务支持该协议与工具调用，并使用可供本次测试使用的凭据。

在被忽略的 `.qa-upstream/live-input/` 中准备 `config.json` 和 `api-key.txt`。配置只引用密钥文件，密钥不放在命令行、源码、报告或配置示例中：

```json
{
  "baseURL": "http://127.0.0.1:1234/v1",
  "model": "your-model-id",
  "api": "openai-completions",
  "apiKeyFile": "api-key.txt"
}
```

本地服务确实不验证密钥时，`api-key.txt` 可写 `local-placeholder`。远程服务使用其要求的密钥。

```powershell
npm run test:upstream:electron -- --dsh-package "$dshPackage" --expect-version 0.2.1-rc.2 --live-config .qa-upstream/live-input/config.json
```

真实模式完成或失败退出时清除它自己创建的浏览器与 DSH 凭据状态，保留脱敏报告；不会删除调用者提供的密钥文件。测试完成后自行移除临时 `api-key.txt`。不要上传整个 QA 目录，报告目录足够复核结果。

验收应确认以下各项，失败保持失败，不能用 loopback 结果替代：

- 从 Studio 入口配置第三方模型，不登录 DeepSeek 账号，并在会话中选择该模型。
- 第一轮产生实际回答；第二轮能使用第一轮上下文。
- Studio 管理的测试技能在官方调用入口可见，实际调用成功；读取隔离项目内随机标记文件，模型返回该标记。DSH 的 `/技能名` 会直接注入技能指令，验收同时认可日志中该注入或成功的 `skill` 工具调用，并单独核对成功的 `read` 工具及返回标记。
- 原先两个标签的草稿、会话和文档保留；测试进程退出，临时凭据副本清理成功。

这只验证所选服务、模型和协议的组合；不据此宣称 OpenAI Responses、Anthropic Messages 或所有社区插件组合已经验收。

## 发布候选门槛

独立打包后运行以下检查；它验证 PE 格式、清单 SHA-512 / 大小、blockmap 全文件覆盖、根版本与 app.asar 内全部应用构建文件，不执行安装或发布：

```powershell
npm run verify:release -- --dir .tools/v0.1.12-release-staging --version 0.1.12 --report .qa-upstream/reports/release-recheck.json
```

- 上述仓库检查与官方 DSH 基线通过，真实服务结果有明确记录。
- 人工检查双向切标签后直接打字只进入当前会话；开启每次发送确认后按 Enter 弹框，取消后草稿保留。自动输入不能替代人工结果。
- 更新版本与本版 CHANGELOG，独立打包，验证安装/升级、更新清单和安装包一致。
- 按 [发布指南](PUBLISHING.md) 同步两个平台的 main/tag；发布前重新核算 Gitee 额度和附件保留方案。

校验已发布的 v0.1.12 时，应使用对应发布标签的源码与构建；包含 `Unreleased` 改动的当前 out 不再是该包的比较基线。已有版本标签与安装包不用于复用新版本号。发布后的完整下载核验完成后，再更新 README 下载链接。
