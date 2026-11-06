# DeepSeek Harness 上游复核

复核日期：2026-11-06。资料来自 GitHub 公共 API、npm registry 和公开 GitHub Discussions；脱敏响应保存在 `.tools/upstream-review-2026-11-06/`。官方 README 的反馈入口是 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)，仓库关闭了 Issues（`has_issues=false`），因此不能把 Issues API 返回空列表解读为没有用户反馈，也不把 Discussions 称为 Issues。本项目 `yunhanhai/harness-studio` 的 Issues 已开启，本次 `state=all` 查询未返回条目。

## 版本与已发布基线

官方默认分支为 [`master`](https://github.com/deepseek-ai/deepseek-harness/commits/master/)，本次查询记录的最近推送为 2026-11-04。npm `latest` 与 `next` 均指向 [@deepseek-ai/dsh 0.2.2-rc.1](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.2-rc.1)，发布时间为 2026-11-04；对应 GitHub [预发布版本](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)。Studio 当前验收和安装基线仍是 2026-10-17 发布的 [DSH 0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。

DSH `0.2.2-rc.1` 要求 Node.js >=24.9.0，同步 Cordis 4.1、Loader/Include 1.1、pi-ai 1.3.0，新增 `dsh-official-bundles`，并调整按步骤启用插件工具、PTC 配置和自定义模型容量默认值，增加 `maxRequestImages` / `imageOffloadCountQuantum` 等配置。Studio 的便携安装下载 Node 22，因此 v0.1.12 发布前已将原先的 `@deepseek-ai/dsh@latest` 固定为实际验收过的 `@deepseek-ai/dsh@0.2.1-rc.2`。两个版本的差异不能仅靠版本号检测消除；在独立 Node 24.9+ 环境验证前，不升级默认基线。

## 首项优化已实现：检查所选 DSH 的 Node 要求

发布后主线已实现程序包 `engines.node` 检测，属于 **Unreleased**，不在已公开的 v0.1.12 安装包内：

- `src/main/runtime/detect.ts` 读取当前选中的 DSH 程序包元数据，与实际 Node 版本进行 semver 匹配，不根据 npm dist-tag 或硬编码版本表猜测兼容性。
- Node 版本不兼容、声明无效或程序包元数据无法读取时返回错误并阻止启动；诊断显示具体原因。不带 `engines.node` 的旧 DSH 包保留原有行为。
- 运行时设置与启动台展示要求和错误；保存运行时配置后重新检测。需要匹配版本时，引导用户在运行时设置选择兼容 Node，不将安装另一份便携运行时误称为已替换当前自定义 DSH。
- `npm run test:runtime` 的 10 组使用内存元数据和模拟 Node 探测覆盖主要分支。根主线 `npm ci`、类型检查、构建/preload、运行时 10 组及语言 11 组已通过；这些本地结果不代表远端 CI 或真实新版 DSH 启动已通过。

配套兼容工作流已增加 Electron 显式安装与可执行文件检查，并支持手动选择 Node 22 或 24。默认门槛保持 DSH `0.2.1-rc.2` + Node 22。v0.1.12 发布源 CI / Release 成功，但首次 DSH compatibility 在 Electron 缺失处失败，GUI 未启动；修复后的远端执行结果以 `.tools/v0.1.12-publication-status.json` 为准，不能由本地验证推定成功。

这项检测只检查**所选 DSH 程序包明确声明的要求**。它不递归计算依赖和插件的 Node 要求，不探测全部运行时 API，也不能替代实际 Host、工具或模型验收。

## 公开反馈与检测边界

本次匿名 REST Discussions 列表只采样首页；条目均创建于 2026-08-13，部分后来有更新，**不是近期全量调研**。这些反馈不等于当前版本仍能复现或已获维护者确认。可用于形成回归方向的样本包括：

| 公开反馈 | 可用于 Studio 的判断 |
| --- | --- |
| [#30 文件夹选择失败](https://github.com/deepseek-ai/deepseek-harness/discussions/30)、[#92 选择窗口不在前台](https://github.com/deepseek-ai/deepseek-harness/discussions/92)、[#107 中文路径截断](https://github.com/deepseek-ai/deepseek-harness/discussions/107) | 保留原生文件夹选择、中文路径和当前工作区确认的隔离检查；不能由历史讨论推定当前上游仍有同一缺陷 |
| [#65 磁盘根目录工作区异常](https://github.com/deepseek-ai/deepseek-harness/discussions/65) | 根目录名称与实际 cwd 应单独覆盖，避免仅测试普通英文目录 |
| [#53 Windows 快速模式使用 Linux 命令](https://github.com/deepseek-ai/deepseek-harness/discussions/53) | 属于工具与运行时行为，不能靠外壳模型入口通过宣称解决 |
| [#112 第三方视觉模型无法识图](https://github.com/deepseek-ai/deepseek-harness/discussions/112) | 模型表单可用不代表图片能力，后续新版本需要单独的图像验收 |
| [#106 模型反选](https://github.com/deepseek-ai/deepseek-harness/discussions/106)、[#14 会话记忆迁移](https://github.com/deepseek-ai/deepseek-harness/discussions/14) | 保留为产品需求线索，暂不将上游内部能力重做为桌面外壳功能 |

[Discussion #100](https://github.com/deepseek-ai/deepseek-harness/discussions/100) 是本次运行时检查的直接历史线索：创建于 2026-08-13 13:44:56 UTC，更新于 2026-08-30 02:35:21 UTC，采样状态为 open（Q&A）。用户在 Windows 上运行 `npx @deepseek-ai/dsh web`；日志显示 DSH `0.1.0-rc.6`、Node `22.14.0`、npm `11.4.2`。npm 提示依赖 `@earendil-works/pi-ai@0.82.1` 要求 Node `>=22.19.0`，随后 `session-persistence-jsonl` 导入 `node:zlib` 时因缺少 `createZstdDecompress` 导出失败。

这条旧版报告不能证明当前 `0.2.1-rc.2` 或 `0.2.2-rc.1` 会出现同一故障。Studio 的新检查仅在所选 DSH 顶层包明确声明不兼容时提前拦截，不能由该依赖警告推定整棵包树要求，更不能承诺拦截所有缺失运行时 API 的问题。条目与评论摘要见 `.tools/upstream-review-2026-11-06/discussions-initial-page.json` 中的 number 100。

## 后续验证

1. 完成 `Unreleased` 检测和兼容工作流修复的主线同步，记录精确提交的 CI / DSH compatibility 结果。已发布的 v0.1.12 标签和附件保持冻结。
2. 在独立 Node 24.9+ 环境运行 `0.2.2-rc.1` 的技能、模型适配器、工作区和多标签检查，再对需要模型执行的工具/PTC、图像能力单独验收。充分验证后再考虑调整安装基线，不升级用户日常运行时来做实验。
3. 增加技能根目录部分失败场景。上游新版会跳过失败根、保留其他技能并标记清单不完整，Studio 应验证不可读根不会掩盖其他来源。
4. 持续核对官方 DOM 合同。新版仍保留 `data-shortcut-modal="settings"`、`settings.launcher`、`settings.section`、`data-conversation-session` 和工作区/新会话入口；这些标记不是永久 API，变动时应先定位适配和等待条件，再修改产品逻辑。

## 来源

- [官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)
- [默认分支提交](https://github.com/deepseek-ai/deepseek-harness/commits/master/)
- [0.2.1-rc.2 与 0.2.2-rc.1 比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.2-rc.1)
- [npm @deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)
- [上游 Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- [Harness Studio Issues](https://github.com/yunhanhai/harness-studio/issues)
