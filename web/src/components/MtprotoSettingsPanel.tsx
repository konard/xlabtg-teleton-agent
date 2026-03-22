import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { InfoTip } from './InfoTip';

interface MtprotoProxy {
  server: string;
  port: number;
  secret: string;
}

interface MtprotoSettingsPanelProps {
  showSuccess: (msg: string) => void;
  setError: (msg: string | null) => void;
}

const EMPTY_PROXY: MtprotoProxy = { server: '', port: 443, secret: '' };

export function MtprotoSettingsPanel({ showSuccess, setError }: MtprotoSettingsPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [proxies, setProxies] = useState<MtprotoProxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load current config
  useEffect(() => {
    api.getMtprotoConfig()
      .then((res) => {
        if (res.data) {
          setEnabled(res.data.enabled ?? false);
          setProxies(res.data.proxies ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggleEnabled = async (val: boolean) => {
    setEnabled(val);
    try {
      await api.setMtprotoEnabled(val);
      showSuccess(val ? 'MTProto proxy enabled (restart required)' : 'MTProto proxy disabled (restart required)');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnabled(!val); // revert
    }
  };

  const handleSaveProxies = async () => {
    // Validate
    for (let i = 0; i < proxies.length; i++) {
      const p = proxies[i];
      if (!p.server.trim()) {
        setError(`Proxy ${i + 1}: Server is required`);
        return;
      }
      if (!p.port || p.port < 1 || p.port > 65535) {
        setError(`Proxy ${i + 1}: Port must be between 1 and 65535`);
        return;
      }
      if (!p.secret.trim() || p.secret.trim().length < 32) {
        setError(`Proxy ${i + 1}: Secret must be at least 32 hex characters`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const cleaned = proxies.map((p) => ({
        server: p.server.trim(),
        port: Number(p.port),
        secret: p.secret.trim(),
      }));
      await api.setMtprotoProxies(cleaned);
      showSuccess('MTProto proxy list saved (restart required to take effect)');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addProxy = () => setProxies((prev) => [...prev, { ...EMPTY_PROXY }]);

  const removeProxy = (idx: number) =>
    setProxies((prev) => prev.filter((_, i) => i !== idx));

  const updateProxy = (idx: number, field: keyof MtprotoProxy, value: string | number) =>
    setProxies((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  if (loading) return null;

  return (
    <>
      <div className="card-header">
        <div className="section-title">
          MRTPOTO / MTProto Proxy
          <InfoTip text="Configure MTProto proxy servers for Telegram connectivity. When enabled, Teleton tries each proxy in order and falls back to a direct connection if all fail. Requires restart to take effect." />
        </div>
        <p className="card-description">
          Add proxy servers to route Telegram traffic through MTProto proxies. Useful when Telegram is blocked or unreachable on your network. Multiple servers are tried in order — automatic failover to the next available one.
        </p>
      </div>
      <div className="card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Enable toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label className="toggle" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => handleToggleEnabled(e.target.checked)}
                />
                <span className="toggle-track" />
                <span className="toggle-thumb" />
              </label>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Enabled</span>
              <InfoTip text="When enabled, Teleton routes Telegram connections through the configured MTProto proxies. Requires restart." />
            </div>
            {enabled && (
              <span style={{ fontSize: 12, color: 'var(--yellow, #f59e0b)' }}>
                ⚠ Restart required
              </span>
            )}
          </div>

          {/* Proxy list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 500 }}>
                Proxy Servers
                <InfoTip text="Servers are tried in order. If the first fails, Teleton automatically tries the next one. All fields are required." />
              </label>
              <button
                className="btn-sm"
                onClick={addProxy}
                style={{ flexShrink: 0 }}
              >
                + Add Server
              </button>
            </div>

            {proxies.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                No proxy servers configured. Click "Add Server" to add one.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {proxies.map((proxy, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--separator)',
                      borderRadius: 8,
                      padding: 12,
                      background: 'var(--bg-secondary)',
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Server {idx + 1}
                      </span>
                      <button
                        onClick={() => removeProxy(idx)}
                        style={{
                          padding: '2px 8px',
                          fontSize: 12,
                          background: 'var(--red, #ef4444)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </div>

                    {/* Row: Server + Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            🖥 Server
                            <InfoTip text="MTProto proxy server hostname or IP address" />
                          </span>
                        </label>
                        <input
                          type="text"
                          value={proxy.server}
                          onChange={(e) => updateProxy(idx, 'server', e.target.value)}
                          placeholder="e.g. proxy.example.com"
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0, minWidth: 100 }}>
                        <label style={{ fontSize: 12 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            🔌 Port
                            <InfoTip text="MTProto proxy server port (usually 443 or 8888)" />
                          </span>
                        </label>
                        <input
                          type="number"
                          value={proxy.port}
                          onChange={(e) => updateProxy(idx, 'port', Number(e.target.value))}
                          placeholder="443"
                          min={1}
                          max={65535}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    {/* Secret */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: 12 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          🔑 Secret
                          <InfoTip text="MTProto proxy secret (32+ hex characters, optionally prefixed with 'dd' for TLS obfuscation). Get it from your proxy provider or @MTProxybot." />
                        </span>
                      </label>
                      <input
                        type="text"
                        value={proxy.secret}
                        onChange={(e) => updateProxy(idx, 'secret', e.target.value)}
                        placeholder="e.g. dd1234abcd...  (hex string)"
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save button */}
          {proxies.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveProxies}
                disabled={saving}
                style={{ minWidth: 100 }}
              >
                {saving ? <><span className="spinner sm" /> Saving...</> : 'Save Proxies'}
              </button>
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
            Proxy settings require a <strong>restart</strong> to take effect. Servers are tried in order — if one fails, the next is automatically used.
          </p>
        </div>
      </div>
    </>
  );
}
