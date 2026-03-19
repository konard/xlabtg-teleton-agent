import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';

interface ShellProps {
  sidebar: ReactNode;
  topBar?: ReactNode;
  children?: ReactNode;
}

export function Shell({ sidebar, topBar, children }: ShellProps) {
  const { theme } = useTheme();

  return (
    <div className="container">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={theme === 'light' ? '/logo_light.png' : '/logo_dark.png'} alt="Teleton" style={{ height: '64px' }} />
        </div>
        {sidebar}
      </aside>
      <div className="main-wrapper">
        {topBar && <div className="topbar">{topBar}</div>}
        <main className="main">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
