# 发布指南：GitHub 与 Gitee

本文首先说明当前 `yunhanhai/harness-studio` 的维护流程。新 fork 的首次初始化见最后一节。

## 当前仓库的历史与同步

本地/Gitee 与 GitHub 保留不同的提交历史。同一版本的 commit SHA、annotated tag object 可以不同，**发布文件内容必须具有相同 tree SHA**。已有版本标签固定对应已经发布的内容，不移动、不重建。

日常维护只同步 `main`；发布时只增加本次版本的精确标签。不要使用全量标签推送、强推、镜像推送或删除远端引用来消除历史差异。

### 1. 确认当前状态

先检查工作区和远端地址，然后只抓取两个 main，避免导入与本地同名但不同对象的发布标签：

```powershell
git status --short --branch
git remote -v
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
git fetch --no-tags gitee refs/heads/main:refs/remotes/gitee/main
git rev-parse 'HEAD^{tree}' 'origin/main^{tree}' 'gitee/main^{tree}'
```

tree 相同表示当前文件内容一致，不能据此认定提交历史一致。tree 不同时先检查差异和远端新增提交，不能直接用本地覆盖。

### 2. 同步 main

若目标 main 是本地 main 的祖先，可以正常快进；每个目标单独检查，任何检查失败都先停止该目标的推送：

```powershell
git merge-base --is-ancestor gitee/main main
if ($LASTEXITCODE -ne 0) { throw 'Gitee main cannot fast-forward; inspect history first.' }
git push --no-follow-tags gitee main:refs/heads/main
```

GitHub 当前使用等 tree 的桥接提交。维护者需记录已同步的本地基线与远端 main，并遵循以下流程：

1. 在干净工作区确认本地基线的 tree 等于刚抓取的 GitHub main tree，且后续待同步提交属于预期范围；基线不匹配时先处理远端新增内容。
2. 在专用临时引用上准备 bridge：父提交沿用 GitHub main，按顺序复制待同步提交的 tree 与提交说明，不改本地 main 或既有标签。合并提交、签名和非线性历史需单独审阅。
3. 核对 bridge 最终 tree 与本地目标提交一致，GitHub main 是 bridge 的祖先。推送前重新查询远端 main，确认仍是准备时的基线。
4. 审阅后仅推送 `<bridge-ref>:refs/heads/main`，显式加 `--no-follow-tags`，不强推。若远端已变化，重新审阅和准备。
5. 再次抓取并核对已发布 main 的 tree，记录两个平台各自的 commit SHA 和下一次本地基线。

过去的版本专用 bridge 脚本及记录在本机忽略的 `.tools/`，不是新 checkout 的依赖；不能把 v0.1.11 脚本中的版本、基线或发布校验直接用于下一版。任何迁移到正式脚本的工具都应保留上述检查。

### 3. 手动同步工作流

`.github/workflows/mirror-gitee.yml` 的显示名称为 **Sync main to Gitee**，保留文件名以便查找历史。配置 `GITEE_USERNAME` 与具备 `projects` 权限的 `GITEE_TOKEN` 后手动运行；目标为该 Gitee 用户名下的 `harness-studio`，目标 main 必须已存在。

该工作流只检出 GitHub main：目标 tree 相同则不做变更；目标能快进时只推 main；历史分叉且 tree 不同则失败并要求维护者按上一节桥接。它不会同步标签、删除分支、生成 bridge 或发布安装包。当前仓库的历史分叉属于预期情况，不能为让工作流通过而强推。

## 发布前验收

1. 先按 [验收流程](ACCEPTANCE.md) 完成本版功能的验收，更新 `CHANGELOG.md`。类型检查、仓库内回归和构建需通过；实际 DSH 验收与 mock 测试分别记录。
2. 同步 `package.json`、`package-lock.json` 顶层与根 package 的版本号。版本号应与计划新增的 `vX.Y.Z` 标签一致。
3. 在独立输出目录打包，避免混用旧版本产物。示例：

```powershell
npm run typecheck
# 执行 package.json 中各 test:* 回归；实际 DSH 验收按本版验收文档运行。
npm run build
npx electron-builder --win --publish never --config.directories.output=.run-release/vX.Y.Z
npm run verify:release -- --dir .run-release/vX.Y.Z --version X.Y.Z --report .run-release/vX.Y.Z/artifacts.json
```

`verify:release` 检查 Setup、Portable、`latest.yml` 与 blockmap，核对清单版本、文件名、大小和 SHA-512 与同次构建 Setup 一致，以及打包应用与当前构建的一致性。另行验证实际安装/升级和安装后的关键行为，再形成发布候选。临时产物目录不要提交。

每次 Gitee 发布前分页统计全部 Release 附件大小，并与待上传文件总量比较。上次 v0.1.11 记录仅剩约 35 MB，不是当前额度保证。空间不足时先确定具体保留/备份方案；旧版本清理授权不自动适用于其他附件。保留已有标签、发行说明与源码包。

## GitHub 发布

当前仓库应先完成上述 main 桥接。在 GitHub 历史上为已验收的目标提交准备**新的** annotated tag；本地/Gitee 标签可以指向对应的本地提交，但两者 tree 必须一致。不要把本地同名标签覆盖到 GitHub。

发布前查询目标标签是否已存在。若已存在，核对其内容和 Release 状态后继续未完成步骤，不重新打标签。新 main 与新标签一起发布时使用 `git push --atomic --no-follow-tags origin <bridge-ref>:refs/heads/main <new-tag-ref>:refs/tags/vX.Y.Z`，仅列出本次两个引用。

`.github/workflows/release.yml` 在新增 `v*` 标签后执行回归、构建、打包并公开 GitHub Release；手动触发只生成 workflow artifacts。标签推送就是公开发布动作，应在候选审阅完成后进行。

发布后核对 CI/Release 对应的精确提交、安装包与更新清单，并匿名完整下载核验附件哈希。CI 与本地可各自构建，但 GitHub 的 `latest.yml` 必须匹配 GitHub 实际 Setup，不能混用另一构建的清单。公开下载确认后更新中英文 README 的版本与链接。

首次使用 Actions 发布需在仓库 Settings → Actions → General 中允许所需写权限。未签名安装包可能触发 Windows SmartScreen；代码签名通过 `electron-builder.yml` 配置。

## Gitee 发布

Gitee 不运行 GitHub Actions，需要上传已验收的安装包。先完成配额审计，再只推本次 main 与新版本标签；已有标签直接复用。若同次推 main 和新标签，可使用原子推送，显式列出两个目标引用并禁用 follow-tags。

可在仓库 → 发行版 → 新建发行版中填写版本标签、标题与本版发布说明，上传 Setup 和 Portable。也可使用 [Gitee REST API](https://gitee.com/api/v5/swagger_doc)：

| 操作 | 方法与路径 |
| --- | --- |
| 分页查询发行版 | `GET /repos/{owner}/{repo}/releases` |
| 创建发行版 | `POST /repos/{owner}/{repo}/releases` |
| 分页查询附件 | `GET /repos/{owner}/{repo}/releases/{release_id}/attach_files` |
| 上传附件 | `POST /repos/{owner}/{repo}/releases/{release_id}/attach_files` |

路径相对于 `https://gitee.com/api/v5`。令牌需要 `projects` 权限，使用受保护环境或凭据存储；不要打印、提交或放入命令行。Git 推送可用不代表 Release API 认证可用。

1. 按 `tag_name` 查询已有 Release，不存在才创建，说明只包含本版变更。
2. 查询现有附件，检查名称、大小与内容哈希；同名不同内容时停止核查，不覆盖。
3. 逐个上传缺少的 Setup/Portable，记录 API 返回的附件 ID、大小与公开下载地址。
4. 匿名完整下载两份文件并核对本地 SHA-256/SHA-512；只查 HTTP 状态或大小不足以确认内容。
5. 全部通过后更新 README 的 Gitee 徽章、链接与 `HANDOFF.md`。记录剩余额度、两个平台的提交/tag/tree 以及下一次 bridge 基线。

返回附件配额不足时重新核算，不反复提交同一个超额文件。应用内自动更新当前通过 GitHub；提供 Gitee 下载链接不等于已经有 Gitee 自动更新通道。

## 新 fork 的首次初始化

本节仅用于新仓库。已有 `yunhanhai/harness-studio` 不执行初始化或重建标签。

先替换仓库信息：

| 文件 | 字段 |
| --- | --- |
| `src/shared/defaults.ts` | `GITHUB_REPO` / `GITEE_REPO` |
| `package.json` | `homepage` / `repository.url` |
| `electron-builder.yml` | `publish.owner` / `publish.repo` |
| `README.md` / `README.en.md` | 徽章与下载链接 |

保留 fork 的既有历史，为自己的空远端添加地址并只推 main：

```powershell
git remote add origin https://github.com/<owner>/harness-studio.git
git remote add gitee https://gitee.com/<owner>/harness-studio.git
git push --no-follow-tags -u origin main:refs/heads/main
git push --no-follow-tags gitee main:refs/heads/main
```

若 origin 已存在，先核对地址，再根据需要重命名或修改，勿重复添加。两平台沿用相同历史时无需 bridge；完成验收后创建本次新的版本标签，只向两个远端推送该精确标签。不要一次发布 fork 中所有旧标签。

## 构建下载问题

Electron / NSIS 下载慢时可在 PowerShell 为本次终端配置镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install --ignore-scripts
node node_modules/electron/install.js
```

之后按本版验收流程构建，避免直接复用旧 `dist/` 文件。
