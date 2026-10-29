import { useEffect, useState } from 'react'
import { useApp } from './store'
import { Titlebar } from './components/Titlebar'
import { Rail } from './components/Rail'
import { StatusBar } from './components/StatusBar'
import { ToastHost } from './components/ToastHost'
import { Splash } from './components/Splash'
import { Home } from './pages/Home'
import { WorkspacePage } from './pages/WorkspacePage'
import { Insights } from './pages/Insights'
import { Prompts } from './pages/Prompts'
import { Logs } from './pages/Logs'
import { SettingsPage } from './pages/Settings'
import { InstallStrip } from './components/InstallStrip'

export default function App(): React.JSX.Element {
  const initialized = useApp((state) => state.initialized)
  const view = useApp((state) => state.view)
  const focusMode = useApp((state) => state.focusMode)
  const install = useApp((state) => state.install)
  const installing = useApp((state) => state.installing)
  const init = useApp((state) => state.init)
  const setView = useApp((state) => state.setView)
  const newTab = useApp((state) => state.newTab)
  const closeTab = useApp((state) => state.closeTab)
  const cycleTab = useApp((state) => state.cycleTab)

  // The workspace page holds one webview per session tab, and unmounting it
  // would destroy them all, so after its first visit it stays mounted and is
  // only parked while another page is shown. Until then it is not rendered at
  // all: a cold start must not create a webview the user never opened.
  const [workspaceMounted, setWorkspaceMounted] = useState(false)
  if (view === 'workspace' && !workspaceMounted) setWorkspaceMounted(true)

  useEffect(() => {
    void init()
  }, [init])

  // Only sees keys while focus is in Studio's own DOM. Keys typed inside a
  // session webview reach the store as actions from the workspace preload.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || event.altKey) return
      const inWorkspace = useApp.getState().view === 'workspace'
      if (event.key === 'Tab' && event.ctrlKey && inWorkspace) {
        event.preventDefault()
        cycleTab(event.shiftKey ? -1 : 1)
        return
      }
      if (event.shiftKey) return
      const key = event.key.toLowerCase()
      const map: Record<string, () => void> = {
        '1': () => setView('home'),
        '2': () => setView('workspace'),
        '3': () => setView('insights'),
        '4': () => setView('prompts'),
        '5': () => setView('logs'),
        t: () => newTab()
      }
      if (inWorkspace) map.w = () => closeTab()
      const action = map[key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [setView, newTab, closeTab, cycleTab])

  if (!initialized) return <Splash />

  const focused = focusMode && view === 'workspace'

  return (
    <div className={`app ${focused ? 'is-focused' : ''}`}>
      <div className="atmosphere" aria-hidden="true">
        <span className="atmosphere-orb orb-one" />
        <span className="atmosphere-orb orb-two" />
        <span className="atmosphere-grid" />
      </div>
      <Titlebar />
      {installing && install ? <InstallStrip progress={install} /> : null}
      <div className="shell">
        {focused ? null : <Rail />}
        <main className={`content view-${view}`}>
          {view === 'home' ? <Home /> : null}
          {workspaceMounted ? (
            <div className={`workspace-pane ${view === 'workspace' ? 'is-active' : 'is-parked'}`}>
              <WorkspacePage />
            </div>
          ) : null}
          {view === 'insights' ? <Insights /> : null}
          {view === 'prompts' ? <Prompts /> : null}
          {view === 'logs' ? <Logs /> : null}
          {view === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>
      {focused ? null : <StatusBar />}
      <ToastHost />
    </div>
  )
}
