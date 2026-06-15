import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { Toaster } from './lib/toast'

initTheme()

// Self-heal stale code-split chunks: after a rebuild, an open tab may hold an
// index.html that references chunk hashes that no longer exist, so the dynamic
// import gets index.html (text/html) instead of JS. Reload once to fetch the
// fresh manifest. Guard with sessionStorage to avoid a reload loop.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('chunk-reloaded')) {
    sessionStorage.setItem('chunk-reloaded', '1');
    window.location.reload();
  }
});
window.addEventListener('load', () => sessionStorage.removeItem('chunk-reloaded'));

// Apply saved theme before first render to avoid flash
try {
  const saved = localStorage.getItem('teleton-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch { /* localStorage not available */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
)
