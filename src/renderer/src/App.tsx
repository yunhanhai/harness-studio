import { useEffect } from 'react'
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

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod || event.shiftKey || event.altKey) return
      const map: Record<string, () => void> = {
        '1': () => setView('home'),
        '2': () => setView('workspace'),
        '3': () => setView('insights'),
        '4': () => setView('prompts'),
        '5': () => setView('logs')
      }
      const action = map[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [setView])

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
          {view === 'workspace' ? <WorkspacePage /> : null}
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
