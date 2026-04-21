import { lazy, Suspense, useState, useCallback, useRef } from 'react';
import { ResponsiveGridLayout, Layout, LayoutItem, ResponsiveLayouts, useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { WidgetWrapper } from './WidgetWrapper';
import { StatsWidget } from './StatsWidget';
import { LogsWidget } from './LogsWidget';
import { AgentSettingsWidget } from './AgentSettingsWidget';
import { TelegramSettingsWidget } from './TelegramSettingsWidget';
import { ExecSettingsWidget } from './ExecSettingsWidget';
import { PredictionsWidget } from './PredictionsWidget';
import { CacheWidget } from './CacheWidget';
import { QuickActions } from '../QuickActions';
import { HealthCheck } from '../HealthCheck';
import { StatusData } from '../../lib/api';
import { ProviderMeta } from '../../hooks/useConfigState';

const TokenUsageChart = lazy(() =>
  import('../charts/TokenUsageChart').then((m) => ({ default: m.TokenUsageChart }))
);
const ToolUsageChart = lazy(() =>
  import('../charts/ToolUsageChart').then((m) => ({ default: m.ToolUsageChart }))
);
const ActivityHeatmap = lazy(() =>
  import('../charts/ActivityHeatmap').then((m) => ({ default: m.ActivityHeatmap }))
);

const STORAGE_KEY = 'dashboard-layout';

// Widget IDs
export type WidgetId =
  | 'stats'
  | 'logs'
  | 'agent'
  | 'telegram'
  | 'exec'
  | 'predictions'
  | 'cache'
  | 'quick-actions'
  | 'token-chart'
  | 'tool-chart'
  | 'activity-heatmap'
  | 'health-check';

interface WidgetMeta {
  id: WidgetId;
  title: string;
  defaultItem: { lg: LayoutItem; md: LayoutItem };
}

const WIDGET_REGISTRY: WidgetMeta[] = [
  {
    id: 'stats',
    title: 'System Stats',
    defaultItem: {
      lg: { i: 'stats', x: 0, y: 0, w: 12, h: 2, minH: 2, maxH: 3 },
      md: { i: 'stats', x: 0, y: 0, w: 10, h: 2, minH: 2, maxH: 3 },
    },
  },
  {
    id: 'agent',
    title: 'Agent Settings',
    defaultItem: {
      lg: { i: 'agent', x: 0, y: 2, w: 6, h: 6, minH: 4 },
      md: { i: 'agent', x: 0, y: 2, w: 5, h: 6, minH: 4 },
    },
  },
  {
    id: 'telegram',
    title: 'Telegram Settings',
    defaultItem: {
      lg: { i: 'telegram', x: 6, y: 2, w: 6, h: 6, minH: 4 },
      md: { i: 'telegram', x: 5, y: 2, w: 5, h: 6, minH: 4 },
    },
  },
  {
    id: 'exec',
    title: 'Exec Settings',
    defaultItem: {
      lg: { i: 'exec', x: 0, y: 8, w: 12, h: 5, minH: 3 },
      md: { i: 'exec', x: 0, y: 8, w: 10, h: 5, minH: 3 },
    },
  },
  {
    id: 'quick-actions',
    title: 'Quick Actions',
    defaultItem: {
      lg: { i: 'quick-actions', x: 0, y: 13, w: 12, h: 3, minH: 2 },
      md: { i: 'quick-actions', x: 0, y: 13, w: 10, h: 3, minH: 2 },
    },
  },
  {
    id: 'predictions',
    title: 'Suggested Next Actions',
    defaultItem: {
      lg: { i: 'predictions', x: 0, y: 16, w: 12, h: 5, minH: 3 },
      md: { i: 'predictions', x: 0, y: 16, w: 10, h: 5, minH: 3 },
    },
  },
  {
    id: 'cache',
    title: 'Predictive Cache',
    defaultItem: {
      lg: { i: 'cache', x: 0, y: 21, w: 12, h: 5, minH: 3 },
      md: { i: 'cache', x: 0, y: 21, w: 10, h: 5, minH: 3 },
    },
  },
  {
    id: 'token-chart',
    title: 'Token Usage',
    defaultItem: {
      lg: { i: 'token-chart', x: 0, y: 26, w: 6, h: 6, minH: 4 },
      md: { i: 'token-chart', x: 0, y: 26, w: 5, h: 6, minH: 4 },
    },
  },
  {
    id: 'tool-chart',
    title: 'Tool Calls',
    defaultItem: {
      lg: { i: 'tool-chart', x: 6, y: 26, w: 6, h: 6, minH: 4 },
      md: { i: 'tool-chart', x: 5, y: 26, w: 5, h: 6, minH: 4 },
    },
  },
  {
    id: 'activity-heatmap',
    title: 'Activity Heatmap',
    defaultItem: {
      lg: { i: 'activity-heatmap', x: 0, y: 32, w: 12, h: 6, minH: 4 },
      md: { i: 'activity-heatmap', x: 0, y: 32, w: 10, h: 6, minH: 4 },
    },
  },
  {
    id: 'health-check',
    title: 'System Health',
    defaultItem: {
      lg: { i: 'health-check', x: 0, y: 38, w: 12, h: 5, minH: 3 },
      md: { i: 'health-check', x: 0, y: 38, w: 10, h: 5, minH: 3 },
    },
  },
  {
    id: 'logs',
    title: 'Live Logs',
    defaultItem: {
      lg: { i: 'logs', x: 0, y: 43, w: 12, h: 8, minH: 4 },
      md: { i: 'logs', x: 0, y: 43, w: 10, h: 8, minH: 4 },
    },
  },
];

function buildDefaultLayouts(visibleIds: WidgetId[]): ResponsiveLayouts {
  const lg: LayoutItem[] = [];
  const md: LayoutItem[] = [];
  for (const meta of WIDGET_REGISTRY) {
    if (visibleIds.includes(meta.id)) {
      lg.push(meta.defaultItem.lg);
      md.push(meta.defaultItem.md);
    }
  }
  return { lg, md };
}

interface SavedState {
  layouts: ResponsiveLayouts;
  visible: WidgetId[];
}

function loadSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedState;
  } catch {
    // ignore
  }
  return null;
}

function saveSaved(state: SavedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ── Props ────────────────────────────────────────────────────────────────────

interface DashboardGridProps {
  status: StatusData;
  stats: { knowledge: number; messages: number; chats: number };
  showExec: boolean;
  // AgentSettingsWidget props
  getLocal: (key: string) => string;
  getServer: (key: string) => string;
  setLocal: (key: string, value: string) => void;
  saveConfig: (key: string, value: string) => Promise<void>;
  cancelLocal: (key: string) => void;
  modelOptions: Array<{ value: string; name: string }>;
  pendingProvider: string | null;
  pendingMeta: ProviderMeta | null;
  pendingApiKey: string;
  setPendingApiKey: (v: string) => void;
  pendingValidating: boolean;
  pendingError: string | null;
  setPendingError: (v: string | null) => void;
  handleProviderChange: (provider: string) => Promise<void>;
  handleProviderConfirm: () => Promise<void>;
  handleProviderCancel: () => void;
}

// Inner grid that knows its container width
function InnerGrid(props: DashboardGridProps & { width: number }) {
  const { showExec, width } = props;

  const ALL_VISIBLE: WidgetId[] = showExec
    ? [
        'stats',
        'agent',
        'telegram',
        'exec',
        'quick-actions',
        'predictions',
        'cache',
        'token-chart',
        'tool-chart',
        'activity-heatmap',
        'health-check',
        'logs',
      ]
    : [
        'stats',
        'agent',
        'telegram',
        'quick-actions',
        'predictions',
        'cache',
        'token-chart',
        'tool-chart',
        'activity-heatmap',
        'health-check',
        'logs',
      ];

  const saved = loadSaved();
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(
    saved?.layouts ?? buildDefaultLayouts(ALL_VISIBLE)
  );
  const [visible, setVisible] = useState<WidgetId[]>(
    saved?.visible ?? ALL_VISIBLE
  );
  const [editMode, setEditMode] = useState(false);

  // Keep visible ref in sync for callbacks
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;

  const handleLayoutChange = useCallback((_layout: Layout, allLayouts: ResponsiveLayouts) => {
    setLayouts(allLayouts);
    saveSaved({ layouts: allLayouts, visible: visibleRef.current });
  }, []);

  const removeWidget = useCallback((id: WidgetId) => {
    const nextVisible = visibleRef.current.filter((v) => v !== id);
    setVisible(nextVisible);
    saveSaved({ layouts: layoutsRef.current, visible: nextVisible });
  }, []);

  const addWidget = useCallback((id: WidgetId) => {
    if (visibleRef.current.includes(id)) return;
    const nextVisible = [...visibleRef.current, id];
    const meta = WIDGET_REGISTRY.find((m) => m.id === id)!;
    // Inject default layout item so the widget restores at its default size
    const currentLayouts = layoutsRef.current;
    const nextLayouts: ResponsiveLayouts = {
      ...currentLayouts,
      lg: [...(currentLayouts.lg ?? []).filter((item) => item.i !== id), meta.defaultItem.lg],
      md: [...(currentLayouts.md ?? []).filter((item) => item.i !== id), meta.defaultItem.md],
    };
    setVisible(nextVisible);
    setLayouts(nextLayouts);
    saveSaved({ layouts: nextLayouts, visible: nextVisible });
  }, []);

  const resetLayout = useCallback(() => {
    const next = showExec
      ? ([
          'stats',
          'agent',
          'telegram',
          'exec',
          'quick-actions',
          'predictions',
          'cache',
          'token-chart',
          'tool-chart',
          'activity-heatmap',
          'health-check',
          'logs',
        ] as WidgetId[])
      : ([
          'stats',
          'agent',
          'telegram',
          'quick-actions',
          'predictions',
          'cache',
          'token-chart',
          'tool-chart',
          'activity-heatmap',
          'health-check',
          'logs',
        ] as WidgetId[]);
    const nextLayouts = buildDefaultLayouts(next);
    setVisible(next);
    setLayouts(nextLayouts);
    saveSaved({ layouts: nextLayouts, visible: next });
  }, [showExec]);

  const hidden = WIDGET_REGISTRY
    .map((m) => m.id)
    .filter((id) => !visible.includes(id))
    .filter((id) => id !== 'exec' || showExec) as WidgetId[];

  function renderWidget(id: WidgetId) {
    const meta = WIDGET_REGISTRY.find((m) => m.id === id)!;
    return (
      <div key={id} style={{ overflow: 'hidden' }}>
        <WidgetWrapper
          title={meta.title}
          editMode={editMode}
          onRemove={() => removeWidget(id)}
          className={id === 'logs' ? 'widget-logs' : id === 'stats' ? 'widget-stats' : ''}
        >
          {id === 'stats' && (
            <StatsWidget status={props.status} stats={props.stats} />
          )}
          {id === 'logs' && <LogsWidget />}
          {id === 'agent' && (
            <AgentSettingsWidget
              getLocal={props.getLocal}
              getServer={props.getServer}
              setLocal={props.setLocal}
              saveConfig={props.saveConfig}
              cancelLocal={props.cancelLocal}
              modelOptions={props.modelOptions}
              pendingProvider={props.pendingProvider}
              pendingMeta={props.pendingMeta}
              pendingApiKey={props.pendingApiKey}
              setPendingApiKey={props.setPendingApiKey}
              pendingValidating={props.pendingValidating}
              pendingError={props.pendingError}
              setPendingError={props.setPendingError}
              handleProviderChange={props.handleProviderChange}
              handleProviderConfirm={props.handleProviderConfirm}
              handleProviderCancel={props.handleProviderCancel}
            />
          )}
          {id === 'telegram' && (
            <TelegramSettingsWidget
              getLocal={props.getLocal}
              getServer={props.getServer}
              setLocal={props.setLocal}
              saveConfig={props.saveConfig}
              cancelLocal={props.cancelLocal}
            />
          )}
          {id === 'exec' && showExec && (
            <ExecSettingsWidget
              getLocal={props.getLocal}
              saveConfig={props.saveConfig}
            />
          )}
          {id === 'quick-actions' && <QuickActions />}
          {id === 'predictions' && <PredictionsWidget />}
          {id === 'cache' && <CacheWidget />}
          {id === 'token-chart' && (
            <Suspense fallback={<div className="chart-loading">Loading…</div>}>
              <TokenUsageChart />
            </Suspense>
          )}
          {id === 'tool-chart' && (
            <Suspense fallback={<div className="chart-loading">Loading…</div>}>
              <ToolUsageChart />
            </Suspense>
          )}
          {id === 'activity-heatmap' && (
            <Suspense fallback={<div className="chart-loading">Loading…</div>}>
              <ActivityHeatmap />
            </Suspense>
          )}
          {id === 'health-check' && <HealthCheck />}
        </WidgetWrapper>
      </div>
    );
  }

  return (
    <div className="dashboard-grid-root">
      {/* ── Toolbar ── */}
      <div className="dashboard-toolbar">
        <button
          className={`btn-ghost btn-sm${editMode ? ' active' : ''}`}
          onClick={() => setEditMode((v) => !v)}
        >
          {editMode ? 'Done' : 'Edit Layout'}
        </button>

        {editMode && (
          <>
            {hidden.length > 0 && (
              <div className="widget-add-dropdown">
                <span className="text-muted" style={{ fontSize: 12 }}>Add:</span>
                {hidden.map((id) => {
                  const meta = WIDGET_REGISTRY.find((m) => m.id === id)!;
                  return (
                    <button
                      key={id}
                      className="btn-ghost btn-sm"
                      onClick={() => addWidget(id)}
                    >
                      + {meta.title}
                    </button>
                  );
                })}
              </div>
            )}
            <button className="btn-ghost btn-sm" onClick={resetLayout}>
              Reset Layout
            </button>
          </>
        )}
      </div>

      {/* ── Grid ── */}
      <ResponsiveGridLayout
        width={width}
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 768, sm: 480, xs: 320, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 4, xs: 2, xxs: 2 }}
        rowHeight={60}
        dragConfig={{ enabled: editMode, handle: '.widget-drag-handle' }}
        resizeConfig={{ enabled: editMode }}
        onLayoutChange={handleLayoutChange}
        margin={[12, 12]}
        containerPadding={[0, 0]}
      >
        {visible.map(renderWidget)}
      </ResponsiveGridLayout>
    </div>
  );
}

export function DashboardGrid(props: DashboardGridProps) {
  const { width, containerRef } = useContainerWidth();

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div ref={containerRef as any} style={{ width: '100%' }}>
      {width > 0 && <InnerGrid {...props} width={width} />}
    </div>
  );
}
