import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { OpenTabWorkspaceResult, TabWorkspaceState, Workspace } from '@shared/types'

interface SessionLocation { id: string; cwd: string }
interface GuestState {
  revision: number
  epoch: number
  observing: number
  busy: number
  queue: Promise<unknown>
  history: Map<string, string>
  authorization?: { key: string; valid: () => boolean }
  pending: Set<AbortController>
  inputs: Map<string, () => boolean>
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const pathKey = (path: string): string => process.platform === 'win32'
  ? path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  : path.replace(/\/+$/, '')

// Read the conversation itself, not dsh.sessions.current: browser storage is
// shared by all tabs and can describe a different guest's selection.
const CURRENT_SESSION = `(() => {
  const roots = Array.from(document.querySelectorAll('[data-conversation-content][data-conversation-session]'))
  const root = roots.find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  return root?.getAttribute('data-conversation-session') || null
})()`

function evaluate<T>(contents: WebContents, code: string, signal?: AbortSignal): Promise<T> {
  // Destroying a guest can leave Electron's executeJavaScript promise pending.
  // Settle our operation on cancellation and bound every guest evaluation.
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value?: T, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(value as T)
    }
    const abort = (): void => finish(undefined, new Error('工作区切换已取消'))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(undefined, new Error('会话界面响应超时，请稍后重试')), 12_000)
    try {
      Promise.resolve(contents.executeJavaScript(code, true)).then((value: T) => finish(value), (error: Error) => finish(undefined, error))
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function rpc<T>(contents: WebContents, method: string, request: object, signal?: AbortSignal): Promise<T> {
  // Use the guest's authenticated same-origin fetch. No Host token is copied
  // into another process, URL, log or browser-storage entry.
  return evaluate<T>(contents, `(async () => {
    const method = ${JSON.stringify(method)}
    const rpcId = crypto.randomUUID()
    const response = await fetch('api/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { [method === 'session/list' ? '_request' : 'request']: ${JSON.stringify(request)} } } })
    })
    const body = await response.json()
    if (!response.ok || body.rpcId !== rpcId || body.result?.ok !== true) {
      throw new Error('Harness 工作区接口不可用，请稍后重试或查看运行时日志')
    }
    return body.result.value
  })()`, signal)
}

/** UI navigation stays in one captured guest, with a cancellable serial queue. */
export class WorkspaceNavigator {
  private states = new WeakMap<WebContents, GuestState>()

  constructor(
    private workspaces: () => Workspace[],
    private hostReady: (contents: WebContents) => boolean,
    private changed: (state: TabWorkspaceState) => void
  ) {}

  track(contents: WebContents): void {
    const state: GuestState = { revision: 0, epoch: 0, observing: 0, busy: 0, queue: Promise.resolve(), history: new Map(), pending: new Set(), inputs: new Map() }
    this.states.set(contents, state)
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return
      state.epoch++
      state.revision++
      for (const request of state.pending) request.abort()
    })
    contents.once('destroyed', () => {
      state.epoch++; state.revision++
      for (const request of state.pending) request.abort()
    })
  }

  cancelAll(contents: Iterable<WebContents>): void {
    for (const guest of contents) {
      const state = this.states.get(guest)
      if (state) {
        state.epoch++; state.revision++; state.history.clear()
        for (const request of state.pending) request.abort()
      }
    }
  }

  cancel(contents: WebContents): void {
    const state = this.states.get(contents)
    if (state) {
      state.revision++
      for (const request of state.pending) request.abort()
    }
  }

  authorize(contents: WebContents, key: string): boolean {
    const state = this.states.get(contents)
    const authorization = state?.authorization
    return Boolean((authorization?.key === key && authorization.valid()) || state?.inputs.get(key)?.())
  }

  isBusy(contents: WebContents): boolean {
    return Boolean(this.states.get(contents)?.busy)
  }

  inputGuard(contents: WebContents): () => boolean {
    const state = this.states.get(contents)
    const revision = state?.revision
    const epoch = state?.epoch
    const observing = state?.observing
    return () => Boolean(state && !contents.isDestroyed() && !state.busy && state.revision === revision && state.epoch === epoch && state.observing === observing && this.hostReady(contents))
  }

  authorizeInput(contents: WebContents, inFront: () => boolean): { key: string; valid: () => boolean; release: () => void } {
    const guard = this.inputGuard(contents)
    const key = randomUUID()
    const valid = (): boolean => inFront() && guard()
    const state = this.states.get(contents)
    state?.inputs.set(key, valid)
    return { key, valid, release: () => { state?.inputs.delete(key) } }
  }

  private async location(contents: WebContents, expectedId?: string, signal?: AbortSignal): Promise<SessionLocation | null> {
    const sessionId = await evaluate<string | null>(contents, CURRENT_SESSION, signal)
    if (!sessionId || (expectedId && sessionId !== expectedId)) return null
    const result = await rpc<{ items: Array<{ sessionId: string; cwd: string }> }>(contents, 'session/list', {}, signal)
    const session = result.items?.find((item) => item.sessionId === sessionId && typeof item.cwd === 'string')
    // Selection may have changed while the RPC was running.
    const current = await evaluate(contents, CURRENT_SESSION, signal)
    return current === sessionId && session ? { id: session.sessionId, cwd: session.cwd } : null
  }

  private publish(contents: WebContents, session: SessionLocation): TabWorkspaceState {
    const workspace = this.workspaces().find((item) => pathKey(item.path) === pathKey(session.cwd))
    const value = { guestId: contents.id, sessionId: session.id, path: session.cwd, workspaceId: workspace?.id }
    this.states.get(contents)?.history.set(pathKey(session.cwd), session.id)
    this.changed(value)
    return value
  }

  /** Called when the guest's conversation DOM changes, including manual navigation. */
  async observe(contents: WebContents, sessionId: string): Promise<void> {
    const state = this.states.get(contents)
    if (!state || contents.isDestroyed() || !this.hostReady(contents)) return
    const observation = ++state.observing
    const epoch = state.epoch
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (contents.isDestroyed() || observation !== state.observing || epoch !== state.epoch || !this.hostReady(contents)) return
        const session = await this.location(contents, sessionId)
        if (session && !contents.isDestroyed() && observation === state.observing && epoch === state.epoch && this.hostReady(contents)) {
          this.publish(contents, session)
          return
        }
        await pause(200)
      }
    } catch {
      // A later selection/ready event retries; never invent a directory.
    }
  }

  open(contents: WebContents, workspace: Workspace): Promise<OpenTabWorkspaceResult> {
    const state = this.states.get(contents)
    if (!state) return Promise.resolve({ status: 'failed', message: '会话界面尚未就绪' })
    const revision = ++state.revision
    for (const previous of state.pending) previous.abort()
    const cancellation = new AbortController()
    state.pending.add(cancellation)
    const epoch = state.epoch
    state.busy++
    const valid = (): boolean => !cancellation.signal.aborted && !contents.isDestroyed() && revision === state.revision && epoch === state.epoch && this.hostReady(contents)
    const authorization = { key: randomUUID(), valid }
    state.authorization = authorization
    const run = state.queue.catch(() => undefined).then(async (): Promise<OpenTabWorkspaceResult> => {
      if (!valid()) return { status: 'cancelled' }
      try {
        const previous = await this.location(contents, undefined, cancellation.signal)
        if (!valid()) return { status: 'cancelled' }
        if (previous) state.history.set(pathKey(previous.cwd), previous.id)
        if (previous && pathKey(previous.cwd) === pathKey(workspace.path)) {
          return { status: 'opened', ...this.publish(contents, previous) }
        }
        const registered = await rpc<{ workspace: { workspaceId: string; path: string } }>(contents, 'workspace/create', { path: workspace.path }, cancellation.signal)
        if (!valid()) return { status: 'cancelled' }
        const target = registered.workspace
        if (!target?.workspaceId || typeof target.path !== 'string' || pathKey(target.path) !== pathKey(workspace.path)) {
          throw new Error('Harness 返回的项目目录不匹配，工作区未切换')
        }
        const saved = state.history.get(pathKey(workspace.path))
        let clicked = false
        // The sidebar can be collapsed or still receiving the registry update.
        for (let attempt = 0; attempt < 30 && valid(); attempt++) {
          const action = await evaluate<string>(contents, `(() => {
            // This synchronous preload check runs when the queued script
            // actually executes, immediately before any UI action.
            const gate = document.createElement('span')
            gate.dataset.hsRequest = ${JSON.stringify(authorization.key)}
            document.documentElement.append(gate)
            gate.dispatchEvent(new Event('hs-workspace-check', { bubbles: true }))
            const allowed = gate.dataset.hsAllowed === 'true'
            gate.remove()
            if (!allowed) return 'cancelled'
            const row = Array.from(document.querySelectorAll('[data-row-key]')).find(el => el.getAttribute('data-row-key') === ${JSON.stringify(`workspace:${target.workspaceId}`)})
            if (!row) {
              const toggle = Array.from(document.querySelectorAll('button')).find(el => /^(打开侧边栏|Open sidebar)$/i.test(el.getAttribute('aria-label') || ''))
              if (toggle) toggle.click()
              return 'waiting'
            }
            const saved = ${JSON.stringify(saved ?? '')}
            if (saved && row.getAttribute('aria-expanded') !== 'true') { row.click(); return 'waiting' }
            if (saved) {
              const session = Array.from(document.querySelectorAll('[data-row-key]')).find(el => el.getAttribute('data-row-key') === 'session:' + saved)
              if (session) { session.click(); return 'clicked' }
            }
            const button = Array.from(row.querySelectorAll('button')).find(el => /新.*会话|new.*session/i.test(el.getAttribute('aria-label') || ''))
            if (!button || button.disabled) return 'unsupported'
            button.click()
            return 'clicked'
          })()`, cancellation.signal)
          if (action === 'cancelled') return { status: 'cancelled' }
          if (action === 'clicked') { clicked = true; break }
          if (action === 'unsupported') throw new Error('无法找到 Harness 的打开会话入口，请在内嵌界面左侧选择项目')
          await pause(200)
        }
        if (!valid()) return { status: 'cancelled' }
        if (!clicked) throw new Error('项目列表尚未就绪，请稍后重试')
        // Confirm the actual opened Session's cwd; a click alone is not success.
        for (let attempt = 0; attempt < 40 && valid(); attempt++) {
          const current = await this.location(contents, undefined, cancellation.signal)
          if (!valid()) return { status: 'cancelled' }
          if (current && pathKey(current.cwd) === pathKey(target.path)) {
            return { status: 'opened', ...this.publish(contents, current) }
          }
          await pause(250)
        }
        if (!valid()) return { status: 'cancelled' }
        throw new Error('未能确认会话的项目目录，请在内嵌界面检查后重试')
      } catch (error) {
        if (!valid()) return { status: 'cancelled' }
        return { status: 'failed', message: error instanceof Error ? error.message : '工作区切换失败' }
      }
    }).finally(() => {
      state.busy--
      state.pending.delete(cancellation)
      if (state.authorization === authorization) state.authorization = undefined
    })
    state.queue = run
    return run
  }
}
