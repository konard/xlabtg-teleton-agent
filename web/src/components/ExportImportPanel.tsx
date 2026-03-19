import { useState, useRef } from 'react';
import { api, ConfigBundle } from '../lib/api';
import { toast } from '../lib/toast-store';

export function ExportImportPanel() {
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOptions, setImportOptions] = useState({ config: true, hooks: true, soul: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.exportConfig();
      const bundle = res.data;
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teleton-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Configuration exported successfully');
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as ConfigBundle;

      if (!bundle.version || bundle.version !== '1.0') {
        toast.error('Invalid configuration bundle format');
        return;
      }

      const res = await api.importConfig(bundle, importOptions);
      toast.success(`Configuration imported: ${res.data.applied.join(', ')}`);
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      // Reset file input
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="card-header">
        <div className="section-title">Export / Import</div>
      </div>
      <div className="card">
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          Export your complete configuration as a JSON bundle, or import a previously exported bundle.
          Sensitive values (API keys, tokens) are excluded from exports.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
            Import sections
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {(['config', 'hooks', 'soul'] as const).map((key) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={importOptions[key]}
                  onChange={(e) => setImportOptions((o) => ({ ...o, [key]: e.target.checked }))}
                />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export Configuration'}
          </button>
          <label>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
              disabled={importing}
            />
            <span
              className="btn-ghost"
              style={{
                display: 'inline-block',
                cursor: importing ? 'not-allowed' : 'pointer',
                opacity: importing ? 0.6 : 1,
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              onClick={() => !importing && fileRef.current?.click()}
            >
              {importing ? 'Importing...' : 'Import Configuration'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
