export const mainMessages = {
  'main.pluginsNotReady': ['运行时尚未就绪，请先打开工作区并启动 Harness。', 'The runtime is not ready. Open a workspace and start Harness first.'],
  'main.pluginsUnavailable': ['当前 Harness 的插件管理入口不可用，请检查运行时版本后重试。', 'Plugin management is unavailable in this Harness interface. Check the runtime version and try again.'],
  'main.pluginsFailed': ['插件管理页未能打开，请重试。', 'The plugin manager could not be opened. Please try again.'],
  "main.quickAskUnavailable": [
    "运行时尚未就绪，无法快速提问",
    "The runtime is not ready for Quick Ask"
  ],
  "main.noWorkspace": [
    "还没有工作区",
    "No workspace has been added"
  ],
  "main.openWorkspaceFirst": [
    "运行时尚未就绪，请先打开工作区",
    "The runtime is not ready. Open a workspace first."
  ],
  "main.guestLoading": [
    "会话界面没有加载完成，请稍后重试",
    "The session view is still loading. Try again shortly."
  ],
  "main.workspaceSwitching": [
    "工作区正在切换，请就绪后再发送",
    "The workspace is switching. Wait until it is ready before sending."
  ],
  "main.sentToHarness": [
    "已发送到 Harness",
    "Sent to Harness"
  ],
  "main.inserted": [
    "已填入输入框",
    "Inserted into the composer"
  ],
  "main.chooseProjectFirst": [
    "还没有工作区。请先选择一个项目文件夹。",
    "No workspace has been added. Choose a project folder first."
  ],
  "main.runtimeNotReady": [
    "运行时尚未就绪。",
    "The runtime is not ready."
  ],
  "main.stillRunning": [
    "Harness Studio 仍在运行",
    "Harness Studio is still running"
  ],
  "main.hideOrQuit": [
    "要隐藏到系统托盘，还是退出应用？",
    "Hide to the system tray or quit the app?"
  ],
  "main.hideDetail": [
    "隐藏后，正在运行的会话和任务不会中断。可以从托盘图标或全局快捷键重新打开。",
    "Running sessions and tasks will continue while hidden. Reopen the window from the tray icon or a global shortcut."
  ],
  "main.hideToTray": [
    "隐藏到托盘",
    "Hide to tray"
  ],
  "main.quitApp": [
    "退出应用",
    "Quit app"
  ],
  "main.directoryUnavailable": [
    "项目目录不存在或无法访问",
    "The project folder does not exist or cannot be accessed"
  ],
  "main.workspaceMissing": [
    "找不到这个 Studio 工作区",
    "This Studio workspace could not be found"
  ],
  "main.cannotKillOwnHost": [
    "不能在这里结束 Studio 自己的运行时，请使用「重启运行时」。",
    "Use Restart runtime to stop Studio’s own runtime."
  ],
  "main.cliMode": [
    "命令行",
    "CLI"
  ],
  "main.otherMode": [
    "其他",
    "Other"
  ],
  "main.stopOtherProcesses": [
    "结束其他 DSH 进程",
    "Stop other DSH processes"
  ],
  "main.stopTheseProcesses": [
    "结束这些进程",
    "Stop these processes"
  ],
  "main.cancel": [
    "取消",
    "Cancel"
  ],
  "main.chooseWorkspaceFolder": [
    "选择工作区文件夹",
    "Choose a workspace folder"
  ],
  "main.folderMissing": [
    "文件夹不存在",
    "The folder does not exist"
  ],
  "main.promptRequired": [
    "标题和内容不能为空",
    "Title and content are required"
  ],
  "main.startupFailed": [
    "Harness Studio 启动失败",
    "Harness Studio failed to start"
  ],
  "main.shortcutsOccupied": [
    "全局快捷键被占用：{shortcuts}",
    "Global shortcuts are already in use: {shortcuts}"
  ],
  "main.processLine": [
    "· PID {pid}（profile: {profile}，{mode}）",
    "· PID {pid} (profile: {profile}, {mode})"
  ],
  "main.forceStopProcesses": [
    "将强制结束 {count} 个 DeepSeek Harness 进程。",
    "Force-stop {count} DeepSeek Harness processes."
  ],
  "main.forceStopDetail": [
    "{processes}\n\n这些进程里正在运行的会话会被中断。若只是想避免「会话已被占用」，结束后回到会话界面重试即可。",
    "{processes}\n\nSessions running in these processes will be interrupted. If a session was already in use, return to its view and retry after stopping the process."
  ],
  "main.processesStopped": [
    "已结束 {count} 个 DSH 进程，回到会话界面重试即可。",
    "Stopped {count} DSH processes. Return to the session view and retry."
  ],
  "main.processesNotStopped": [
    "{count} 个进程无法结束（可能权限不足或已退出）。",
    "Could not stop {count} processes. They may have exited or require more permissions."
  ],
  "main.newVersion": [
    "发现新版本 {version}",
    "Version {version} is available"
  ],
  "main.confirmSend": [
    "确认发送",
    "Confirm send"
  ],
  "main.sendMessage": [
    "发送这条消息？",
    "Send this message?"
  ],
  "main.sendQueuedOne": [
    "发送这条消息，并连同 {count} 条排队消息？",
    "Send this message together with {count} queued message?"
  ],
  "main.sendQueued": [
    "发送这条消息，并连同 {count} 条排队消息？",
    "Send this message together with {count} queued messages?"
  ],
  "main.sendQueueDetailOne": [
    "注意：队列里还有 {count} 条消息，本次发送会连同它们一起提交。如果不想一起发出，先取消，在队列面板里删除或插话发送。",
    "The queue contains {count} message, which will be submitted with this send. To avoid sending it, cancel first, then remove it or send it separately from the queue panel."
  ],
  "main.sendQueueDetail": [
    "注意：队列里还有 {count} 条消息，本次发送会连同它们一起提交。如果不想一起发出，先取消，在队列面板里删除或插话发送。",
    "The queue contains {count} messages, which will be submitted with this send. To avoid sending them, cancel first, then remove them or send them separately from the queue panel."
  ],
  "main.send": [
    "发送",
    "Send"
  ],
  "main.guestClosed": [
    "会话界面已关闭",
    "The session view was closed"
  ],
  "main.guestTimeout": [
    "会话界面响应超时",
    "The session view did not respond in time"
  ],
  "main.emptyContent": [
    "内容为空",
    "The message is empty"
  ],
  "main.guestNotReady": [
    "会话界面尚未就绪",
    "The session view is not ready"
  ],
  "main.composerMissing": [
    "找不到输入框，请先打开一个会话",
    "The composer could not be found. Open a session first."
  ],
  "main.composerFocusFailed": [
    "无法聚焦输入框",
    "Could not focus the composer"
  ],
  "main.targetChanged": [
    "目标会话已切换，请就绪后再发送",
    "The target session changed. Wait until it is ready before sending."
  ],
  "main.insertFailed": [
    "内容没有进入输入框",
    "The message was not inserted into the composer"
  ],
  "main.insertedBeforeSwitch": [
    "已填入原会话，切换后请检查并手动发送",
    "Inserted into the original session. Check it and send manually after switching."
  ],
  "main.sendManually": [
    "已填入输入框，请手动发送",
    "Inserted into the composer. Send it manually."
  ],
  "main.navigationCancelled": [
    "工作区切换已取消",
    "Workspace switch cancelled"
  ],
  "main.navigationTimeout": [
    "会话界面响应超时，请稍后重试",
    "The session view did not respond in time. Try again shortly."
  ],
  "main.workspaceMismatch": [
    "Harness 返回的项目目录不匹配，工作区未切换",
    "Harness returned a different project folder. The workspace was not switched."
  ],
  "main.navigationUnsupported": [
    "无法找到 Harness 的打开会话入口，请在内嵌界面左侧选择项目",
    "Could not find the Harness session controls. Choose a project in the embedded sidebar."
  ],
  "main.projectsLoading": [
    "项目列表尚未就绪，请稍后重试",
    "The project list is not ready. Try again shortly."
  ],
  "main.workspaceUnconfirmed": [
    "未能确认会话的项目目录，请在内嵌界面检查后重试",
    "Could not confirm the session’s project folder. Check the embedded view and retry."
  ],
  "main.navigationFailed": [
    "工作区切换失败",
    "Workspace switch failed"
  ],
  "main.rpcUnavailable": [
    "Harness 工作区接口不可用，请稍后重试或查看运行时日志",
    "The Harness workspace API is unavailable. Try again shortly or check runtime logs."
  ],
  "main.nodeMissing": [
    "未找到 Node.js。请安装 Node.js 22+，或使用「安装便携运行时」。",
    "Node.js was not found. Install Node.js 22+ or use Install portable runtime."
  ],
  "main.nodeNotExecutable": [
    "Node.js 无法执行，请检查路径。",
    "Node.js could not be started. Check its path."
  ],
  "main.nodeVersionInvalid": [
    "无法识别 Node.js 版本。请在设置 → 运行时检查 Node.js 路径。",
    "Could not recognize the Node.js version. Check its path in Settings → Runtime."
  ],
  "main.nodeEngineInvalid": [
    "DSH 程序包声明了无效的 Node.js 版本要求。请重新安装该运行时，或在设置 → 运行时选择有效的 DSH 程序包。",
    "The DSH package declares an invalid Node.js requirement. Reinstall that runtime or select a valid DSH package in Settings → Runtime."
  ],
  "main.runtimePackageInvalid": [
    "无法读取或解析所选 DSH 程序包的 package.json，暂不能确认 Node.js 兼容性。请检查程序包权限或重新安装运行时。",
    "Could not read or parse the selected DSH package.json to verify Node.js compatibility. Check package permissions or reinstall the runtime."
  ],
  "main.nodeEngineMismatch": [
    "DSH {version} 要求 Node.js {required}，当前检测到 {actual}。请在设置 → 运行时选择兼容的 Node.js，或安装便携运行时。",
    "DSH {version} requires Node.js {required}; detected {actual}. Choose a compatible Node.js in Settings → Runtime, or install the portable runtime."
  ],
  "main.dshMissing": [
    "未找到 DeepSeek Harness CLI。可以使用「安装便携运行时」一键部署。",
    "DeepSeek Harness CLI was not found. Use Install portable runtime to set it up."
  ],
  "main.processListInvalid": [
    "无法解析进程列表输出",
    "Could not parse the process list"
  ],
  "main.unknownDirectory": [
    "（未知目录）",
    "(Unknown folder)"
  ],
  "main.modelUnrecorded": [
    "未记录",
    "Not recorded"
  ],
  "main.installCancelled": [
    "安装已取消",
    "Installation cancelled"
  ],
  "main.installInProgress": [
    "已有安装任务正在进行",
    "An installation is already in progress"
  ],
  "main.downloadNodePreparing": [
    "准备下载 Node.js 运行时…",
    "Preparing to download Node.js…"
  ],
  "main.extractingRuntime": [
    "正在解压运行时…",
    "Extracting the runtime…"
  ],
  "main.runtimeIncomplete": [
    "解压后的运行时目录不完整",
    "The extracted runtime folder is incomplete"
  ],
  "main.nodeReady": [
    "Node.js 已就绪",
    "Node.js is ready"
  ],
  "main.installingDshPackage": [
    "正在安装 @deepseek-ai/dsh…",
    "Installing @deepseek-ai/dsh…"
  ],
  "main.installDependenciesDetail": [
    "这一步会下载全部依赖，通常需要 1–3 分钟。",
    "This downloads all dependencies and usually takes 1–3 minutes."
  ],
  "main.installingDsh": [
    "正在安装 DeepSeek Harness…",
    "Installing DeepSeek Harness…"
  ],
  "main.verifyingRuntime": [
    "正在校验运行时…",
    "Verifying the runtime…"
  ],
  "main.runtimeVerificationFailed": [
    "运行时校验失败",
    "Runtime verification failed"
  ],
  "main.unknownVersion": [
    "未知版本",
    "unknown version"
  ],
  "main.downloadHttpFailed": [
    "下载失败：HTTP {status}",
    "Download failed: HTTP {status}"
  ],
  "main.npmInstallFailed": [
    "npm 安装失败（退出码 {code}）",
    "npm installation failed (exit code {code})"
  ],
  "main.downloadingNodeTarget": [
    "正在下载 Node.js {version}（{target}）…",
    "Downloading Node.js {version} ({target})…"
  ],
  "main.downloadingNode": [
    "正在下载 Node.js {version}…",
    "Downloading Node.js {version}…"
  ],
  "main.runtimeInstalled": [
    "运行时安装完成（dsh {version}）",
    "Runtime installed (dsh {version})"
  ],
  "main.installFailed": [
    "安装失败：{message}",
    "Installation failed: {message}"
  ],
  "main.releaseVersionMissing": [
    "发布源未返回版本号。",
    "The release source did not return a version number."
  ],
  "main.latestVersion": [
    "已经是最新版本。",
    "You are using the latest version."
  ],
  "main.updatesDevelopment": [
    "开发模式下不检查更新；打包后会自动连接发布源。",
    "Updates are disabled in development mode. Packaged builds use the release source."
  ],
  "main.releaseNotConfigured": [
    "尚未配置发布仓库（src/shared/defaults.ts 中的 GITHUB_REPO）。",
    "The release repository is not configured (GITHUB_REPO in src/shared/defaults.ts)."
  ],
  "main.downloadUpdateDevelopment": [
    "开发模式下不能下载更新。",
    "Updates cannot be downloaded in development mode."
  ],
  "main.updateDownloaded": [
    "更新已下载，重启应用即可完成安装。",
    "The update is downloaded. Restart the app to install it."
  ],
  "main.updateCheckHttpFailed": [
    "检查更新失败：HTTP {status}",
    "Update check failed: HTTP {status}"
  ],
  "main.updateCheckFailed": [
    "检查更新失败：{message}",
    "Update check failed: {message}"
  ],
  "main.updateDownloadFailed": [
    "下载更新失败：{message}",
    "Update download failed: {message}"
  ],
  "main.runtimePartsMissing": [
    "运行时尚未就绪：缺少 Node.js 或 dsh CLI。",
    "The runtime is not ready: Node.js or the dsh CLI is missing."
  ],
  "main.hostStopped": [
    "Host 已停止。",
    "Host stopped."
  ],
  "main.hostProfileLocked": [
    "Host 无法写入配置档案，已被另一个 DSH 进程占用。可在「设置 → 运行时 → 其他 DSH 进程」里看清是哪个进程并结束它，或更换配置档案后重试。",
    "The Host cannot write to its profile because another DSH process is using it. Open Settings → Runtime → Other DSH processes to find and stop that process, or choose a different profile and retry."
  ],
  "main.profileRecoverySkipped": [
    "配置档案被占用，已跳过自动重启。",
    "Automatic restart skipped: the profile is in use."
  ],
  "main.hostStartupTimeout": [
    "Host 启动超时（150 秒）。请查看日志，或检查模型凭据与端口占用。",
    "Host startup timed out after 150 seconds. Check the logs, model credentials, and port availability."
  ],
  "main.permissionRecoverySkipped": [
    "权限不足，已跳过自动重启。",
    "Automatic restart skipped: insufficient permissions."
  ],
  "main.hostRestarting": [
    "正在自动重启 Host…",
    "Restarting the Host automatically…"
  ],
  "main.unknown": [
    "未知",
    "unknown"
  ],
  "main.workspaceAdoptedLog": [
    "切换工作区（复用运行中的 Host）: {path}",
    "Workspace switched using the running Host: {path}"
  ],
  "main.workingDirectoryLog": [
    "工作目录: {path}",
    "Working directory: {path}"
  ],
  "main.profileCreatedLog": [
    "已从 web 配置创建独立档案: {profile}",
    "Created an isolated profile from the web profile: {profile}"
  ],
  "main.profileTemplateNote": [
    "（首次启动，将从内置模板创建）",
    " (first launch; will be created from the built-in template)"
  ],
  "main.profileLog": [
    "配置档案: {profile}{note}",
    "Profile: {profile}{note}"
  ],
  "main.hostLaunchFailedLog": [
    "启动失败: {message}",
    "Launch failed: {message}"
  ],
  "main.hostSignal": [
    "信号 {signal}",
    "signal {signal}"
  ],
  "main.hostExitCode": [
    "退出码 {code}",
    "exit code {code}"
  ],
  "main.hostExited": [
    "Host 进程意外退出（{reason}）。",
    "The Host exited unexpectedly ({reason})."
  ],
  "main.hostStartFailedLog": [
    "无法启动 Host: {message}",
    "Could not start the Host: {message}"
  ],
  "main.recoveryExhaustedLog": [
    "自动重启已尝试 {count} 次仍失败，已停止重试。",
    "Automatic restart failed after {count} attempts. No more retries."
  ],
  "main.recoveryScheduledLog": [
    "将在 {seconds} 秒后自动重启（第 {attempt}/{total} 次）。",
    "Automatic restart in {seconds}s (attempt {attempt}/{total})."
  ],
  "main.hostReadyLog": [
    "Host 已就绪，监听端口 {port}。",
    "Host ready on port {port}."
  ],
  "main.recoverySucceededLog": [
    "自动重启成功（第 {attempt} 次尝试）。",
    "Automatic restart succeeded on attempt {attempt}."
  ],
  "main.settingsMenu": [
    "设置…",
    "Settings…"
  ],
  "main.checkUpdatesMenu": [
    "检查更新…",
    "Check for updates…"
  ],
  "main.logsMenu": [
    "运行日志",
    "Runtime logs"
  ],
  "main.githubMenu": [
    "GitHub 仓库",
    "GitHub repository"
  ],
  "main.giteeMenu": [
    "Gitee 仓库",
    "Gitee repository"
  ],
  "main.hideOthersMenu": [
    "隐藏其他",
    "Hide others"
  ],
  "main.showAllMenu": [
    "全部显示",
    "Show all"
  ],
  "main.fileMenu": [
    "文件",
    "File"
  ],
  "main.openWorkspaceMenu": [
    "打开工作区…",
    "Open workspace…"
  ],
  "main.hideWindowMenu": [
    "隐藏窗口",
    "Hide window"
  ],
  "main.editMenu": [
    "编辑",
    "Edit"
  ],
  "main.undoMenu": [
    "撤销",
    "Undo"
  ],
  "main.redoMenu": [
    "重做",
    "Redo"
  ],
  "main.cutMenu": [
    "剪切",
    "Cut"
  ],
  "main.copyMenu": [
    "复制",
    "Copy"
  ],
  "main.pasteMenu": [
    "粘贴",
    "Paste"
  ],
  "main.selectAllMenu": [
    "全选",
    "Select all"
  ],
  "main.viewMenu": [
    "视图",
    "View"
  ],
  "main.reloadMenu": [
    "重新加载界面",
    "Reload interface"
  ],
  "main.devToolsMenu": [
    "开发者工具",
    "Developer tools"
  ],
  "main.actualSizeMenu": [
    "实际大小",
    "Actual size"
  ],
  "main.zoomInMenu": [
    "放大",
    "Zoom in"
  ],
  "main.zoomOutMenu": [
    "缩小",
    "Zoom out"
  ],
  "main.fullscreenMenu": [
    "全屏",
    "Full screen"
  ],
  "main.runtimeMenu": [
    "运行时",
    "Runtime"
  ],
  "main.restartHarnessMenu": [
    "重启 Harness 运行时",
    "Restart Harness runtime"
  ],
  "main.windowMenu": [
    "窗口",
    "Window"
  ],
  "main.minimizeMenu": [
    "最小化",
    "Minimize"
  ],
  "main.zoomMenu": [
    "缩放",
    "Zoom"
  ],
  "main.frontMenu": [
    "前置全部窗口",
    "Bring all to front"
  ],
  "main.helpMenu": [
    "帮助",
    "Help"
  ],
  "main.aboutProductMenu": [
    "关于 {product}",
    "About {product}"
  ],
  "main.hideProductMenu": [
    "隐藏 {product}",
    "Hide {product}"
  ],
  "main.quitProductMenu": [
    "退出 {product}",
    "Quit {product}"
  ],
  "main.versionMenu": [
    "版本 {version}",
    "Version {version}"
  ],
  "main.openStudioMenu": [
    "打开 Harness Studio",
    "Open Harness Studio"
  ],
  "main.openWorkspaceTray": [
    "打开工作区",
    "Open workspace"
  ],
  "main.restartRuntimeTray": [
    "重启运行时",
    "Restart runtime"
  ],
  "main.quitMenu": [
    "退出",
    "Quit"
  ]
} as const
