import { useCallback, useEffect, useState } from 'react';
import { api, PredictionEndpoint, PredictionSuggestion } from '../../lib/api';

const TABS: Array<{ id: PredictionEndpoint; label: string }> = [
  { id: 'next', label: 'Next' },
  { id: 'tools', label: 'Tools' },
  { id: 'topics', label: 'Topics' },
];

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function PredictionsWidget() {
  const [active, setActive] = useState<PredictionEndpoint>('next');
  const [context, setContext] = useState('');
  const [items, setItems] = useState<PredictionSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPredictions(active, context.trim() || undefined);
      setItems(res.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [active, context]);

  useEffect(() => {
    load();
  }, [load]);

  function showStatus(message: string) {
    setStatus(message);
    setTimeout(() => setStatus(null), 3000);
  }

  async function handleNotHelpful(item: PredictionSuggestion) {
    setBusyAction(item.action);
    try {
      await api.sendPredictionFeedback({
        endpoint: active,
        action: item.action,
        confidence: item.confidence,
        reason: item.reason,
        helpful: false,
      });
      setItems((current) => current.filter((entry) => entry.action !== item.action));
      showStatus('Feedback recorded');
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Feedback failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQueue(item: PredictionSuggestion) {
    setBusyAction(item.action);
    try {
      await api.executePrediction({
        endpoint: active,
        action: item.action,
        confidence: item.confidence,
        reason: item.reason,
      });
      showStatus('Task queued');
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Queue failed');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="predictions-widget">
      <div className="prediction-controls">
        <div className="prediction-tabs" role="tablist" aria-label="Prediction type">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`prediction-tab${active === tab.id ? ' active' : ''}`}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost btn-sm" type="button" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <input
        className="prediction-context-input"
        value={context}
        onChange={(event) => setContext(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') load();
          if (event.key === 'Escape') setContext('');
        }}
        placeholder="Context"
      />

      {status && <div className="prediction-status">{status}</div>}

      <div className="prediction-list">
        {loading ? (
          <div className="prediction-empty">Loading...</div>
        ) : items.length === 0 ? (
          <div className="prediction-empty">No predictions yet</div>
        ) : (
          items.map((item) => (
            <div className="prediction-row" key={`${active}:${item.action}`}>
              <div className="prediction-main">
                <div className="prediction-action">{item.action}</div>
                <div className="prediction-reason">{item.reason}</div>
                <div
                  className="prediction-confidence"
                  aria-label={`${percent(item.confidence)} percent`}
                >
                  <span style={{ width: `${percent(item.confidence)}%` }} />
                </div>
              </div>
              <div className="prediction-actions">
                <button
                  className="btn-ghost btn-sm"
                  type="button"
                  title="Queue task"
                  disabled={busyAction !== null}
                  onClick={() => handleQueue(item)}
                >
                  +
                </button>
                <button
                  className="btn-ghost btn-sm"
                  type="button"
                  title="Not helpful"
                  disabled={busyAction !== null}
                  onClick={() => handleNotHelpful(item)}
                >
                  x
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
