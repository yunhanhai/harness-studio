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
- `npm run test:runtime` 的 10 组使用内存元数据和模拟 Node 探测覆盖主要分支。根主线 `npm ci`、类型检查、构建/preload、运行时 10 组及语言 11 组已通过；对应代码的完整 CI 和当前基线兼容检查也已通过。

配套兼容工作流已增加 Electron 显式安装与可执行文件检查，并支持手动选择 Node 22 或 24。默认门槛保持 DSH `0.2.1-rc.2` + Node 22。首次因 Electron 缺失而失败的问题已解决：GitHub 提交 `58eebf6f376342d6ece1bab0beb02c82bcfbf1cc` 的 [完整 CI](https://github.com/yunhanhai/harness-studio/actions/runs/42164874020) 和 [基线 DSH compatibility](https://github.com/yunhanhai/harness-studio/actions/runs/42164874071) 均成功，包含 9 项技能对照、6 项适配器协议与 8 项实际 Electron 检查。报告已下载到 `.tools/postrelease-actions/42164874071/`。

这项检测只检查**所选 DSH 程序包明确声明的要求**。它不递归计算依赖和插件的 Node 要求，不探测全部运行时 API，也不能替代实际 Host、工具或模型验收。

## 新版隔离兼容实验

已启动独立的 DSH `0.2.2-rc.1` + Node 24 [首次实验](https://github.com/yunhanhai/harness-studio/actions/runs/42164978335)。9 项技能对照通过；适配器测试尚未发起 HTTP 就在请求头准备阶段停止，后续 Electron 步骤未运行。已核对精确 npm 发布包及 Cordis 4.1.0 实现：新版会调用同步 `ctx.waterfall('llm-pi-ai/request-headers', request, headers, fallback)`，旧测试模拟缺少该方法，产生的 `TypeError` 被上游归一化为 `REQUEST_HEADERS` 错误。这是测试模拟未覆盖的新接口，不能据此宣称模型或 Studio 不兼容。

验收脚本已补齐无扩展监听器时调用 `fallback()`、保持原 `Headers` 的行为，严格检查事件名并记录 `requestHeaderHookCalls`；没有放宽原无密钥错误断言或跳过协议检查。当前 `0.2.1-rc.2` 的 6 项协议回归通过。新版复跑结果待记录；模型/PTC/图片与第三方插件仍需独立验收，默认安装基线不变。

## 近期反馈与改进优先级

2026-11-06 04:47:43 UTC（北京时间 12:47:43），另通过 GitHub GraphQL 读取按 `UPDATED_AT DESC` 排序的最近 20 条公开 Discussions，补充下方历史样本。排序代表最近活动，并非全部新建问题；正文最多保留 5,000 字符，每条只取前两条评论、每条最多 2,500 字符，保留截断标记。这不是全量反馈审计，也不保证已读到最新评论。原始数据为 `.tools/upstream-review-2026-11-06/discussions-latest-updated.json`，详细源码对照为同目录 `LATEST_FEEDBACK_REVIEW.md`。只读取公开内容，没有留言或发帖。

| 优先级与反馈 | 与 Studio 的关系及下一步 |
| --- | --- |
| 1. 本地状态保护；[#12384 认证失败与 profile 重置](https://github.com/deepseek-ai/deepseek-harness/discussions/12384) | 报告涉及官方 Desktop 的一次非确定恢复事件，不是 Studio 的复现。但独立源码复核发现 `src/main/store.ts` 的 `JsonStore.load()` 对读取/解析异常统一回退并写默认值，`persist()` 吞掉 I/O 错误。下一迭代优先设计仅在文件不存在时初始化、其余错误保留原件、写失败提示和内存状态回滚，并覆盖损坏 JSON、权限错误和重启后的数据保留。尚未修复，不能把 Node 兼容检查视为数据保护。 |
| 2. 会话中断恢复；[#12179 pending 工具调用导致恢复失败](https://github.com/deepseek-ai/deepseek-harness/discussions/12179) | 报告使用 DSH `0.2.1-rc.2` 与 Chat Completions，和当前基线及协议类别相同，但模型不同。现有 fixture 只覆盖正常工具 ID，未覆盖持久化恢复；应在隔离 Host 中测试空/正常工具 ID、调用中途停止及重启读取，保留原始记录，不自动改写会话或重发工具。 |
| 3. 自托管模型容量；[#3973 未识别 max_model_len](https://github.com/deepseek-ai/deepseek-harness/discussions/3973) | 新评论指出未识别部署容量可能叠加新版 1M context / 128K output 默认值，属于代码推论，尚无实际请求抓取。现有 adapter fixture 固定 8192/1024 且关闭 discovery；应补 loopback 模型列表、显式容量优先级和请求上限断言。模型宣称的最大值不能直接当作部署容量。 |
| 4. 托盘失效后的窗口恢复；[#12369 Windows 10 托盘创建失败](https://github.com/deepseek-ai/deepseek-harness/discussions/12369) | 反馈针对官方 Desktop，不能据此判定 Studio 复现。Studio 自建托盘并支持关闭隐藏，已有第二次启动显示主窗口的入口；应验证 Win10/11、Explorer 重启及竖排任务栏下仍可找回窗口。 |
| 5. 中文链接与路径；[#11030 裸 URL 吞中文标点、单波浪线吞路径](https://github.com/deepseek-ai/deepseek-harness/discussions/11030) | 正文由上游 UI 渲染，近期评论未给出准确新版号。把 `~/a`、`~/b` 与中文标点 URL 加入升级回归，先复现和定位解析器，不添加全局 DOM 替换。 |

其他相关反馈包括插件依赖混用（[#12378](https://github.com/deepseek-ai/deepseek-harness/discussions/12378)）、插件并发加载中的 CJS/ESM 交互（[#12386](https://github.com/deepseek-ai/deepseek-harness/discussions/12386)）、非法工具参数的失败与重试（[#8976](https://github.com/deepseek-ai/deepseek-harness/discussions/8976)、[#11577](https://github.com/deepseek-ai/deepseek-harness/discussions/11577)）及孤立 UTF-16 代理项（[#12380](https://github.com/deepseek-ai/deepseek-harness/discussions/12380)）。这些需要各自的失败场景验收，不能由正常模型调用通过推出已解决。

本次也排除了不适用的直接归因：Studio Insights 使用字符串搜索和记录中的 token usage，未使用相关反馈中的 FTS5 分词或 `chars/4` 估算；官方 Desktop 的安装器和安全模式实现也不等于 Studio 的 NSIS 与 CLI Host。反馈中的比例、根因和修复建议均需验证后才能采用。

## 历史公开反馈与检测边界

最初的匿名 REST Discussions 列表只采样首页；条目均创建于 2026-08-13，部分后来有更新，**不是近期全量调研**；最新活动的补充采样见上一节。这些反馈不等于当前版本仍能复现或已获维护者确认。可用于形成回归方向的样本包括：

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

1. 运行时版本检测已同步并通过主线 CI 与基线 DSH compatibility。后续首先处理上方确认的本地状态保留问题，并补会话中断恢复验收。已发布的 v0.1.12 标签和附件保持冻结。
2. 完成请求头接口模拟后的 `0.2.2-rc.1` + Node 24 隔离复跑，再对需要模型执行的工具/PTC、图像能力单独验收。充分验证后再考虑调整安装基线，不升级用户日常运行时来做实验。
3. 增加技能根目录部分失败场景。上游新版会跳过失败根、保留其他技能并标记清单不完整，Studio 应验证不可读根不会掩盖其他来源。
4. 持续核对官方 DOM 合同。新版仍保留 `data-shortcut-modal="settings"`、`settings.launcher`、`settings.section`、`data-conversation-session` 和工作区/新会话入口；这些标记不是永久 API，变动时应先定位适配和等待条件，再修改产品逻辑。

## 来源

- [官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)
- [默认分支提交](https://github.com/deepseek-ai/deepseek-harness/commits/master/)
- [0.2.1-rc.2 与 0.2.2-rc.1 比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.2-rc.1)
- [npm @deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)
- [上游 Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- [Harness Studio Issues](https://github.com/yunhanhai/harness-studio/issues)
