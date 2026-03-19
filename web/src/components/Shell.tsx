import { ReactNode, useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

interface ShellProps {
  sidebar: ReactNode;
  topBar?: ReactNode;
  children?: ReactNode;
}

export function Shell({ sidebar, topBar, children }: ShellProps) {
  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile nav)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="container">
      {/* Skip navigation link for accessibility */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <img src={theme === 'light' ? '/logo_light.png' : '/logo_dark.png'} alt="Teleton" style={{ height: '64px' }} />
        </div>
        {sidebar}
      </aside>

      <div className="main-wrapper">
        <div className="topbar">
          {/* Hamburger menu button (mobile only) */}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="main-sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {sidebarOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
          {topBar}
        </div>
        <main className="main" id="main-content">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
