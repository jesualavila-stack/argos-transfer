import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import DockApp from './DockApp'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('No se encontró #root')
}

const isDock = window.location.hash === '#dock'
createRoot(rootEl).render(<StrictMode>{isDock ? <DockApp /> : <App />}</StrictMode>)
