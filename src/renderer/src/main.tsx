import { createRoot } from 'react-dom/client'
import App from './App'
import Palette from './components/Palette'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

const isPalette = window.location.hash.startsWith('#palette')

createRoot(container).render(
  <ErrorBoundary>{isPalette ? <Palette /> : <App />}</ErrorBoundary>
)
