# 发布指南：GitHub 与 Gitee

本文把 Harness Studio 从本地构建推到公开下载页。仓库当前已配置为 `yunhanhai/harness-studio`；如果要发布到你自己的账号，先把第 0 节的 4 处所有者改成你的用户名。

## 0. 先替换 4 处占位符

| 文件 | 字段 | 示例 |
| --- | --- | --- |
| `src/shared/defaults.ts` | `GITHUB_REPO` / `GITEE_REPO` | `yourname/harness-studio` |
| `package.json` | `homepage` / `repository.url` | `https://github.com/yourname/harness-studio` |
| `electron-builder.yml` | `publish.owner` / `publish.repo` | `yourname` / `harness-studio` |
| `README.md` | 顶部徽章与下载链接 | 同上 |

替换后执行一次：

```powershell
npm run typecheck
npm run build
npm run dist
```

确认 `dist/` 中生成：

- `Harness-Studio-0.1.0-x64-Setup.exe`（NSIS 安装包）
- `Harness-Studio-0.1.0-x64-Portable.exe`（免安装）
- `latest.yml`（更新清单，GitHub Release 需要）

## 1. 初始化本地仓库

```powershell
git init
git add .
git commit -m "feat: initial Harness Studio desktop client"
git branch -M main
```

## 2. GitHub

### 2.1 创建仓库

在 GitHub 新建一个空仓库（不要勾选 README / .gitignore），然后：

```powershell
git remote add origin https://github.com/<你的用户名>/harness-studio.git
git push -u origin main
```

### 2.2 用 Actions 自动发布

仓库已包含 `.github/workflows/release.yml`。推一个语义化版本标签即可：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Workflow 会在 `windows-latest` 上完成构建，并把安装包、便携版与 `latest.yml` 附加到对应的 GitHub Release。

首次发布前确认：

- 仓库 **Settings → Actions → General → Workflow permissions** 允许读写；
- 如果使用私有仓库，Release 资产对未登录用户不可见；
- 安装包未做代码签名，Windows SmartScreen 可能提示"未知发布者"。这是预期行为，可在 README 中说明，或购买代码签名证书后在 `electron-builder.yml` 的 `win` 段配置 `certificateFile` / `certificatePassword`。

### 2.3 手动发布（可选）

```powershell
npm run dist
gh release create v0.1.0 dist/Harness-Studio-0.1.0-x64-Setup.exe dist/Harness-Studio-0.1.0-x64-Portable.exe dist/latest.yml --title "Harness Studio v0.1.0" --notes-file CHANGELOG.md
```

## 3. Gitee

### 3.1 创建仓库并推送

在 Gitee 新建空仓库，然后把它加为第二个远端：

```powershell
git remote add gitee https://gitee.com/<你的用户名>/harness-studio.git
git push gitee main
git push gitee --tags
```

日常同步：

```powershell
git push origin main --tags
git push gitee main --tags
```

### 3.2 在 Gitee 发布附件

Gitee 的 Release 不会自动运行 GitHub Actions，需要上传已构建的安装包。可以通过网页操作：

1. 打开 Gitee 仓库 → **发行版** → **新建发行版**；
2. 标签填 `v0.1.0`，标题填 `Harness Studio v0.1.0`；
3. 上传 `dist/` 下的 Setup / Portable 安装包；
4. 发布说明可以从 GitHub Release 直接复制。

也可以使用 [Gitee 官方 REST API](https://gitee.com/api/v5/swagger_doc)。以下路径均相对于 `https://gitee.com/api/v5`：

| 操作 | 方法与路径 | 请求格式 |
| --- | --- | --- |
| 查询发行版 | `GET /repos/{owner}/{repo}/releases` | 查询参数，`per_page` 最大 100 |
| 创建发行版 | `POST /repos/{owner}/{repo}/releases` | JSON：`access_token`、`tag_name`、`name`、`body`、`target_commitish`、`prerelease` |
| 查询附件 | `GET /repos/{owner}/{repo}/releases/{release_id}/attach_files` | 查询参数，`per_page` 最大 100 |
| 上传附件 | `POST /repos/{owner}/{repo}/releases/{release_id}/attach_files` | `multipart/form-data`：`access_token` 与 `file` |

令牌需要 `projects` 权限，可从环境变量或已忽略的 `.tools/gitee-token.txt` 读取，不要打印、提交或写进命令行。Git 推送成功并不代表同一凭据可调用发行版 API，应先验证 API 认证。

1. 确认目标标签已推送；已有标签直接复用，不重复打标签。
2. 分页查询发行版，按 `tag_name` 查找目标版本。不存在时再创建：例如 `tag_name` 为 `v0.1.6`、`name` 为 `Harness Studio v0.1.6`，`body` 为该版本发布说明，`target_commitish` 为 `main`，`prerelease` 为 `false`。创建成功返回 `201` 和发行版 ID。
3. 查询该发行版的附件，再分别上传 Setup 与 Portable。已有同名且大小一致的附件可跳过；大小冲突时停止核查，不覆盖。上传成功返回 `201`，包含附件名、大小与 `browser_download_url`。
4. 重新查询附件，核对两份文件的名称与大小，并验证公开下载 URL。GitHub 的 `latest.yml` 必须匹配 GitHub 实际发布的 Setup 文件名、大小和 SHA-512；不要混用不同构建的更新清单与安装包。
5. 附件下载验收后再更新 README 的 Gitee 徽章、下载链接和 HANDOFF 的发布状态。

如果上传返回 `400` 并提示「文件大小已超出仓库附件配额：1 GB」，需要统计仓库已有附件的总大小。单个安装包满足上传限制，并不代表仓库还有足够的总额度。可在备份并确认保留策略后清理旧安装附件，保留标签、发行说明和源码包，再重试上传；不要反复提交同一个超额文件。

### 3.3 让 Gitee 用户也能收到更新提示

应用内的"检查更新"默认请求 GitHub Releases API。若主要面向国内用户，可以把 `src/main/updater.ts` 中的检查地址替换为 Gitee 的发行版 API，或在 README 中同时给出两个下载入口。

### 3.4 可选：自动镜像到 Gitee

如果要让 GitHub 的提交自动同步到 Gitee，可以在仓库 Secrets 中配置：

- `GITEE_USERNAME`
- `GITEE_TOKEN`（Gitee 私人令牌，勾选 `projects` 权限）

然后参考 `.github/workflows/mirror-gitee.yml` 启用镜像工作流。该工作流只做 `git push --mirror`，不构建、不发布。

## 4. 版本与更新

- 版本号遵循 SemVer，`package.json` 与 git tag 保持一致；
- Release 资产必须包含 `latest.yml` 与安装包，否则客户端无法比较版本或下载；
- 更新逻辑在 `src/main/updater.ts`，使用 `electron-updater`：检查 → 用户确认下载 → 进度 → 重启安装；
- 发布新版本时，先改 `package.json` 版本号、提交、打 tag，Actions 会同时上传 `latest.yml` 与安装包，客户端据此发现更新；
- 未签名安装包在下载/安装阶段仍可能触发 SmartScreen，这是代码签名问题，不是更新逻辑问题。

## 5. 常见问题

**构建时下载 Electron / NSIS 很慢**
在 PowerShell 中设置镜像后重试：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

**`npm install` 在受限环境里失败**
本项目已把 `npm install` 与 Electron 二进制安装拆开：

```powershell
npm install --ignore-scripts
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

**安装包被杀毒软件误报**
未签名 Electron 应用的常见现象。可以考虑代码签名、提交误报，或在发布页提供 SHA-256 校验值：

```powershell
Get-FileHash dist\Harness-Studio-0.1.0-x64-Setup.exe -Algorithm SHA256
```
