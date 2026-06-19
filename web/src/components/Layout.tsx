import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Shell } from "./Shell";
import { AgentControl } from "./AgentControl";
import { AgentSwitcher } from "./AgentSwitcher";
import { NotificationBell } from "./NotificationBell";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { logout } from "../lib/api";
import { useTheme } from "../hooks/useTheme";
import { openCommandPalette } from "./CommandPalette";

function DashboardNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  return (
    <>
      <nav aria-label="Main navigation">
        <button
          className="cmd-k-hint"
          onClick={openCommandPalette}
          title={t("nav.commandPaletteTitle")}
          aria-label={t("nav.commandPaletteAria")}
          style={{ width: "100%", marginBottom: "4px", justifyContent: "space-between" }}
        >
          <span>{t("nav.search")}</span>
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <Link to="/" className={isActive("/") ? "active" : ""}>
          {t("nav.dashboard")}
        </Link>
        <Link to="/agents" className={isActive("/agents") ? "active" : ""}>
          {t("nav.agents")}
        </Link>
        <Link to="/tools" className={isActive("/tools") ? "active" : ""}>
          {t("nav.tools")}
        </Link>
        <Link to="/plugins" className={isActive("/plugins") ? "active" : ""}>
          {t("nav.plugins")}
        </Link>
        <Link to="/soul" className={isActive("/soul") ? "active" : ""}>
          {t("nav.soul")}
        </Link>
        <Link to="/memory" className={isActive("/memory") ? "active" : ""}>
          {t("nav.memory")}
        </Link>
        <Link to="/workspace" className={isActive("/workspace") ? "active" : ""}>
          {t("nav.workspace")}
        </Link>
        <Link to="/tasks" className={isActive("/tasks") ? "active" : ""}>
          {t("nav.tasks")}
        </Link>
        <Link to="/workflows" className={isActive("/workflows") ? "active" : ""}>
          {t("nav.workflows")}
        </Link>
        <Link to="/pipelines" className={isActive("/pipelines") ? "active" : ""}>
          {t("nav.pipelines")}
        </Link>
        <Link to="/events" className={isActive("/events") ? "active" : ""}>
          {t("nav.events")}
        </Link>
        <Link to="/mcp" className={isActive("/mcp") ? "active" : ""}>
          {t("nav.mcp")}
        </Link>
        <Link to="/integrations" className={isActive("/integrations") ? "active" : ""}>
          {t("nav.integrations")}
        </Link>
        <Link to="/network" className={isActive("/network") ? "active" : ""}>
          {t("nav.network")}
        </Link>
        <Link to="/hooks" className={isActive("/hooks") ? "active" : ""}>
          {t("nav.hooks")}
        </Link>
        <Link to="/sessions" className={isActive("/sessions") ? "active" : ""}>
          {t("nav.sessions")}
        </Link>
        <Link to="/analytics" className={isActive("/analytics") ? "active" : ""}>
          {t("nav.analytics")}
        </Link>
        <Link to="/feedback" className={isActive("/feedback") ? "active" : ""}>
          {t("nav.feedback")}
        </Link>
        <Link to="/security" className={isActive("/security") ? "active" : ""}>
          {t("nav.security")}
        </Link>
        <Link to="/self-improve" className={isActive("/self-improve") ? "active" : ""}>
          {t("nav.selfImprove")}
        </Link>
        <Link to="/autonomous" className={isActive("/autonomous") ? "active" : ""}>
          {t("nav.autonomous")}
        </Link>
        <Link to="/gocoon" className={isActive("/gocoon") ? "active" : ""}>
          {t("nav.gocoon")}
        </Link>
        <Link to="/config" className={isActive("/config") ? "active" : ""}>
          {t("nav.config")}
        </Link>
      </nav>
      <div style={{ marginTop: "auto" }}>
        <AgentSwitcher />
        <AgentControl />
        <div style={{ padding: "0 12px 14px" }}>
          <div style={{ marginBottom: "8px" }}>
            <LanguageSwitcher variant="block" />
          </div>
          <button
            onClick={toggleTheme}
            className="btn-ghost"
            title={theme === "dark" ? t("common.switchToLight") : t("common.switchToDark")}
            style={{
              width: "100%",
              fontSize: "13px",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            {theme === "dark" ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                {t("common.lightMode")}
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                {t("common.darkMode")}
              </>
            )}
          </button>
          <button onClick={handleLogout} className="btn-ghost" style={{ width: "100%", fontSize: "13px" }}>
            {t("common.logout")}
          </button>
          <div
            style={{
              marginTop: "8px",
              textAlign: "center",
              fontSize: "11px",
              opacity: 0.4,
              userSelect: "none",
            }}
          >
            v{__BUILD_VERSION__} ({__BUILD_COMMIT__})
          </div>
        </div>
      </div>
    </>
  );
}

function TopBar() {
  return (
    <div className="topbar-controls" role="toolbar" aria-label="Top bar controls">
      <NotificationBell />
    </div>
  );
}

export function Layout() {
  return <Shell sidebar={<DashboardNav />} topBar={<TopBar />} />;
}
