# v0.1.12 验收

本版范围为模型设置、首次选择、DSH 本地技能中心及其可靠性修复。本地 v0.1.12 候选包已生成；公开下载目前仍为 v0.1.11。功能验收、协议 fixture 与真实模型结果分别记录，不用其中一种代替另一种。

2026-11-05 当前结果：类型检查、构建、179 项/组仓库回归和 4 项同步回归通过；官方 DSH `0.2.1-rc.2` 的解析对照 9 项、loopback 协议 6 项、Electron 默认检查 8 项通过。用户指定的 `ultrarouter.org` / `deepseek-v4.1-flash` / Chat Completions 最终三轮真实验收通过，含技能指令加载与实际 `read` 工具读取；报告 `.qa-upstream/electron-L0Hpgp/report/report.json` 和同目录 `live-tool-evidence.json`。测试进程和临时凭据已清理。人工键盘、安装/升级与发布仍待完成。

2026-11-06 发布候选：三个根版本字段已升为 `0.1.12`，独立目录 `.tools/v0.1.12-staging` 的 Setup / Portable、更新清单、blockmap 与 app.asar 校验通过。全部 6 个应用构建文件与上述真实模型验收一致，因此未重复调用付费服务。安装前已备份现有 v0.1.11 程序、四项用户状态和快捷方式参数；自动启动安装被 Windows 安全提示暂停，已关闭本次等待进程并交由用户手动确认，不能据此标记安装通过。Gitee 配额审计与 v0.1.7 两件旧包的可恢复备份完成，尚未删除附件或发布新版。

实际打包程序的 8 项官方 DSH 检查也通过：报告 `.qa-upstream/electron-z5OLGw/report/report.json` 确认版本 `0.1.12`、`isPackaged=true`、完整构建匹配、无未捕获异常和模型请求，测试进程已退出。此结果覆盖 `win-unpacked` 程序，不替代安装升级验证。

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
npm run build
```

技能测试包含保存/删除/恢复时的文件 API 故障、新服务实例重试、外部编辑保护，以及 Windows 指令文件大小写和历史备份恢复。它不代表断电或磁盘硬件故障测试。Gitee 测试只使用临时本地 Git 仓库，执行工作流的实际同步脚本。

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

`.github/workflows/upstream-compatibility.yml` 在相关 main/PR 变更时自动检查基线版本，也支持手动指定另一个精确 DSH 版本。报告与截图作为 artifact 保存；它不配置真实服务或发送付费请求。

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
npm run verify:release -- --dir .tools/v0.1.12-staging --version 0.1.12 --report .tools/v0.1.12-artifacts.json
```

- 上述仓库检查与官方 DSH 基线通过，真实服务结果有明确记录。
- 人工检查双向切标签后直接打字只进入当前会话；开启每次发送确认后按 Enter 弹框，取消后草稿保留。自动输入不能替代人工结果。
- 更新版本与本版 CHANGELOG，独立打包，验证安装/升级、更新清单和安装包一致。
- 按 [发布指南](PUBLISHING.md) 同步两个平台的 main/tag；发布前重新核算 Gitee 额度和附件保留方案。

已有版本标签与安装包不用于复用新版本号。发布后的完整下载核验完成后，再更新 README 下载链接。
