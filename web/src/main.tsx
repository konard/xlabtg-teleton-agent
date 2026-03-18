import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply saved theme before first render to avoid flash
try {
  const saved = localStorage.getItem('teleton-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch { /* localStorage not available */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
