# 本地安装与升级

这个项目有**两种使用方式**，不要混用：

| 方式 | 适合谁 | 命令 |
| --- | --- | --- |
| 安装使用 | 日常使用，双击桌面图标 | `npm run install:local` |
| 开发调试 | 改代码、看热更新 | `npm run dev` |

## 一次装好，之后原地升级

```powershell
npm run install:local
```

这条命令会：

1. 构建应用（`dist:dir`）；
2. 结束正在运行的实例；
3. **清空并覆盖** `%LOCALAPPDATA%\Programs\Harness Studio`，旧版本文件不会残留；
4. 重建桌面与开始菜单快捷方式（始终指向同一路径，不会堆出多个图标）。

只想重新部署、不重新构建：

```powershell
powershell -File scripts/install-local.ps1 -SkipBuild
```

## 三个目录的分工

```
%LOCALAPPDATA%\Programs\Harness Studio\   程序本体（约 325 MB）
    升级时整个替换，不做增量，所以永远只有一份

%APPDATA%\Harness Studio\                 用户数据（约 7 MB）
    settings.json        设置
    workspaces.json      工作区列表
    prompts.json         提示词库
    quickask-recent.json 快速提问历史
    logs\                运行日志
    runtime\             便携运行时（如果选了"一键安装"）
    ↑ 升级时保留，不会重复占用

<仓库目录>                                 源码与构建产物（开发用）
    out\                 构建输出（可删，重新构建即可）
    dist\                安装包与 win-unpacked（可删）
```

**关键点**：程序本体和用户数据是分开的。升级只替换前者，你的设置、工作区、提示词、历史记录都不会丢。

## 清理开发垃圾

开发过程中会产生预览副本、截图缓存、旧版本安装包。一条命令清掉：

```powershell
npm run clean:dist
```

它会删除：

- `.preview/`、`.edge-profile/`、`.run-*/` 等测试目录；
- `dist/win-unpacked/`（约 325 MB 的临时解包）；
- `dist/` 里**除当前版本外**的历史安装包。

不会动 `node_modules`、源码或当前版本的安装包。

## 与发布流程的关系

本地安装和对外发布是两条独立的路：

- `npm run install:local` —— 只影响你自己这台机器，不发版；
- 打 tag 推送到 GitHub —— 触发 Actions 构建并发布到 Release，Gitee 需手动传附件。

发布流程见 [PUBLISHING.md](PUBLISHING.md)。

## 卸载

```powershell
# 删除程序
Remove-Item "$env:LOCALAPPDATA\Programs\Harness Studio" -Recurse -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Harness Studio.lnk') -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'Harness Studio.lnk') -Force

# 可选：删除用户数据（会丢失设置、工作区、提示词）
Remove-Item "$env:APPDATA\Harness Studio" -Recurse -Force
```
