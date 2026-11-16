# Feature details

[Back to the project homepage](../README.en.md) · [中文](FEATURES.md)

The current public packages are **v0.1.12**. Sections marked development describe unpublished work; they do not imply that the public packages or remote main already include every local implementation.

## Projects and conversation tabs

Each Studio workspace is a project bookmark. Opening a project registers its directory and navigates the active Harness tab, then checks the session's working directory. Other tabs retain their conversations and input. All tabs share one local Host.

Tabs retain their own conversation, scroll position and input. The default limit is four, configurable from one to eight. Restarting the Host rebuilds the foreground workspace in one tab. Keep a tab open when you need its unsent draft; returning through the project list may open a new blank conversation.

## Models and skills

Settings, Home, and the command palette now offer model setup. First use presents **Use a custom model / Sign in to DeepSeek / Configure later**. Third-party APIs and local compatible services do not require a DeepSeek account. Harness retains its native model forms and credential storage. A local server that does not validate keys can use `local-placeholder` with the current adapter; authenticated servers require their own key. Reply generation and tool support depend on the configured API and model.

The sidebar and `Ctrl+6` open the DSH skill center: source and scope labels, search, instruction/resource preview, invalid declarations, and local name conflicts. Standard project `.dsh/skills` and current DSH_HOME `skills` support creation, Markdown or complete-folder import, editing with backups, deletion, and restore. Supporting files and empty folders are preserved. Shared agents, custom, and bundled sources are read only.

This is a default disk inventory with statically identified custom candidates. Full preset composition, virtual/remote providers, and the live invocation catalog are not included; check the Harness `/` menu for availability and refresh. Backups are stored under Studio data in `skill-backups` and cannot overwrite subsequent edits. Plugin picks link to community projects and official discovery documentation; installation remains in Harness and plugin combinations are not Studio-verified.

These features are available in **v0.1.12** on GitHub and Gitee. A selected Chat Completions service passed multi-turn conversation, skill instruction, and real `read` tool checks. This does not establish compatibility with every provider, protocol, or community plugin combination.

## Everyday tools

- **Prompts:** built-in templates and local custom prompts, with tags and usage counts.
- **Logs:** live stdout, stderr and system messages, filtering, copy and launch-token redaction.
- **Insights:** local session usage, cache-hit rate, model/workspace breakdown and 14-day activity. Cost estimates use prices configured in Settings.
- **Quick ask:** sends or inserts into the active conversation, with recent questions and configurable behavior.
- **Plugin manager:** opens Harness's native manager in the active tab. Harness handles plugin installation, configuration and sources.
- **Desktop:** tray, global shortcuts, single instance, window-state restore and Host crash recovery.
- **Appearance:** dark/light/system themes, accents, zoom, reduced motion and conversation reading size.
- **Language:** Chinese, English or Follow system for the Studio shell; Harness conversation content and raw logs stay unchanged.

## Development records and architecture

The development version expands **Skill center → Plugin picks** with search, categories, package versions, author-declared DSH ranges, license notes and pinned source links. better-sidebar `0.30.1` and Skills Manager `1.4.1` passed isolated core-scenario tests on DSH `0.2.2-rc.1`; the directory states their exact scope. Six entries remain untested. Browsing works offline; the pinned evidence and limited test scope will be documented with the corresponding development release.

Node runtime downloads now retry temporary HTTP and transfer failures with visible source and attempt information. Backup between the built-in `npmmirror.com` and `nodejs.org` sources is an explicit mirror-setting option, disabled by default. Custom sources never switch automatically. Download timeouts, cancellation and disk errors have distinct feedback; the previous runtime is retained until the replacement passes verification.

The development version also includes **Settings → Runtime → Environment diagnostics and configuration recovery**. Inspect the saved Profile when DSH cannot start, save a local configuration snapshot, and restore it after stopping the runtime. Restoration saves the current configuration first and checks other processes and configuration write locks. Snapshots cover six configuration files, including package manifests, Cordis configuration, pnpm configuration and `.npmrc`; they do not reinstall dependencies or include sessions and skills. They may contain credentials and should stay local. This feature is not included in the published v0.1.12 packages.

The same page can disable unambiguously identified community plugins and repair dependencies while the runtime is stopped. Both actions save a configuration snapshot first. Dependency repair prepares and checks an isolated installation, supports cancellation and keeps the previous dependencies in a backup directory shown on completion. The initial implementation supports verified DSH `0.2.1-rc.2` / `0.2.2-rc.1` configuration; dependency repair requires Windows and standard registry version declarations. Local path dependencies and custom workspaces are reported as unsupported. Install scripts are skipped; start the runtime afterwards to check plugin compatibility.

The development version also lists configuration profiles under the saved DSH_HOME, identifies the saved selection and running profile, and supports Studio-only labels and notes. With the runtime stopped, preview and create a copy of the six configuration files. Dependencies and compatibility exemptions are excluded; creation does not select or start the copy. Profiles still share global DSH_HOME configuration and sources. Relative dependencies, additional environment files and custom hooks/workspaces are reported as unsupported. Configuration credentials are retained, so keep copies local.

Once the runtime has fully stopped, use **Select this profile** to save an existing readable Profile. Selection changes only its saved name; inspect configuration and dependencies below, then explicitly start it. A failed save retains the previous selection, and unsaved advanced arguments and mirror drafts are preserved. Switching active environments, version libraries and presets across different homes remain future work.

Profile operations refresh the inventory and diagnostics when they finish. **Check again** detects the saved runtime before inspecting configuration and dependencies, with an explicit retry after failure. Repairs refresh configuration revisions in the list. Checking does not start or install anything; use the existing Home or workspace action to start explicitly.

```
Electron main  →  spawns `dsh web` on 127.0.0.1:<free port>
      │                     │
      │ IPC                 │ launch-token URL
      ▼                     ▼
React workspace shell  →  <webview> official Harness UI
```

The renderer has no Node access. The webview only trusts the current host origin; external links open in the system browser. The launch token is redacted before anything is written to logs.

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Data locations

| Data | Path |
| --- | --- |
| Settings | `%APPDATA%\Harness Studio\settings.json` |
| Workspaces | `%APPDATA%\Harness Studio\workspaces.json` |
| Prompts | `%APPDATA%\Harness Studio\prompts.json` |
| Logs | `%APPDATA%\Harness Studio\logs\` |
| Portable runtime | `%APPDATA%\Harness Studio\runtime\` |
| Harness sessions / credentials | `~/.dsh` (shared with the `dsh` CLI) |

The portable build keeps its data next to the executable in `HarnessStudioData/`.
