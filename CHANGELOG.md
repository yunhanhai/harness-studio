# Changelog

所有值得记录的变更都会写在这里。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## 0.1.0 — 2026-10-21

首个公开版本。

### 新增

- Electron 桌面外壳：无边框窗口、自定义标题栏、窗口状态恢复、单实例锁
- 启动台：运行时状态、端口、版本、运行时长、最近工作区、运行时诊断
- 多工作区：每个项目独立目录，切换时自动重启 `dsh web` Host
- 运行时检测：自定义路径、便携运行时、npm 全局、PATH
- 独立配置档案：默认克隆 `web` 配置到 `studio`，避免与正在运行的 `dsh web` 争用 profile
- Host 启动使用工作区内的临时目录，减少系统 Temp 权限问题
- 一键安装便携运行时：下载 Node.js、安装 `@deepseek-ai/dsh`、分阶段进度、取消与超时
- 内嵌官方 Harness Web UI：隔离 webview、origin 校验、外链交给系统浏览器
- 提示词库：6 条内置提示词、标签、使用次数、增删改、一键复制
- 实时日志：stdout / stderr / 系统消息、筛选、搜索、跟随、复制、令牌脱敏
- 命令面板：`Ctrl+K`，支持命令、工作区、提示词、主题切换
- 托盘菜单与全局快捷键：`Ctrl+Alt+H`、`Ctrl+Alt+K`
- 关闭到托盘 / 最小化到托盘 / 开机自启 / 启动最小化
- 主题：深色、浅色、跟随系统、6 种强调色、自定义取色、界面缩放、减少动效
- 设置页：通用、外观、运行时、高级、关于
- 更新：检查 GitHub Releases，后台下载并重启安装（electron-updater）
- Windows 安装包（NSIS）与免安装便携版
- GitHub Actions：CI、打标签自动发布、Gitee 镜像工作流
- 浏览器 UI 预览与截图脚本，便于无 Electron 环境做设计评审

### 已知限制

- 仅提供 Windows x64 产物；macOS / Linux 目标已配置但未验收
- 安装包未签名，可能出现 SmartScreen 提示
- 自动更新依赖 GitHub Release 的 `latest.yml` 与安装包同批上传
- 会话界面复用官方 Web UI，上游改版可能影响外观
- 便携运行时依赖网络；离线环境需自备 Node.js 与 `dsh`
