import { createRoot } from 'react-dom/client'
import App from './App'
import Palette from './components/Palette'
import QuickAsk from './components/QuickAsk'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

const hash = window.location.hash
const surface = hash.startsWith('#palette') ? 'palette' : hash.startsWith('#quickask') ? 'quickask' : 'app'

createRoot(container).render(
  <ErrorBoundary>
    {surface === 'palette' ? <Palette /> : surface === 'quickask' ? <QuickAsk /> : <App />}
  </ErrorBoundary>
)
