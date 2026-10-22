# 贡献指南

感谢你愿意一起把 Harness Studio 做得更好。这个项目优先保证三件事：**能启动、能恢复、界面不退化**。

> 第一次接触这个仓库？先读 [docs/HANDOFF.md](docs/HANDOFF.md)：一份页面讲清代码地图、环境坑、验证方式和下一步建议。

## 开发环境

- Windows 10/11（当前主要目标）
- Node.js 22+
- npm 10+

```powershell
npm install --ignore-scripts
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
npm run dev
```

如果 Electron 二进制下载失败，可改用其他镜像：

```powershell
$env:ELECTRON_MIRROR = "https://github.com/electron/electron/releases/download/"
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Electron 开发模式（含 HMR） |
| `npm run typecheck` | 主进程 + 渲染进程类型检查 |
| `npm run build` | 构建 `out/` |
| `npm run preview:ui` | 无需 Electron 的浏览器 UI 预览 |
| `npm run icons` | 从 `resources/brand.svg` 重新生成图标 |
| `npm run dist` | Windows 安装包 + 便携版 |
| `npm run dist:dir` | 仅生成 `dist/win-unpacked` |

浏览器预览的 mock 数据在 `scripts/preview-mock.mjs`，适合改样式和截图：

```powershell
npm run build
npm run preview:ui
# 另开终端，需要本机有 Edge：
node scripts/shot.mjs "http://127.0.0.1:4179/?view=home" ".preview/home.png" 1360 860
```

## 代码约定

- TypeScript 严格模式，不使用 `any` 逃逸；
- 主进程能力通过 `src/shared/types.ts` 的 `StudioApi` 暴露，新增 IPC 必须同时补 preload 与类型；
- 渲染进程不直接访问 Node / 文件系统；
- 所有写盘操作使用 `JsonStore`，保持原子写入；
- 日志中的启动令牌必须脱敏；
- 新增文案先写中文，保持简洁；不引入远程字体或远程脚本。

## 提交信息

使用 Conventional Commits：

```text
feat: add workspace switcher to palette
fix: keep host alive when window hides
docs: document Gitee release flow
chore: bump electron to 44.x
```

## Pull Request

1. 从 `main` 开分支；
2. 本地跑 `npm run typecheck` 与 `npm run build`；
3. UI 改动附截图（可用浏览器预览生成）；
4. 描述里写清：改了什么、为什么、如何验证、有什么风险；
5. 不要提交 `dist/`、`.preview/`、日志或任何密钥。

## 发布

发布流程见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。不要手动修改 `dist/` 里的产物；所有版本都从源码构建。
