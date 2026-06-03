import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/utils';
import { toast } from '../lib/toast';
import { RefreshButton } from './RefreshButton';

interface Wallet {
  fundAddress: string;
  ownerAddress: string;
  balanceTon: string;
  balanceNano: string;
  funded: boolean;
  recommendedFundingTon: string;
}
interface GocoonStatus {
  installed: boolean;
  version: string | null;
  wallet: Wallet | null;
  runner: boolean;
}
type WEvent = { stage: string; status: string; message: string };

// 1 TON: above this free balance the wallet is treated as provisioned, since the
// stake (~15 TON) drops the free balance below gocoon's "funded" threshold.
const PROVISIONED_NANO = 1_000_000_000n;

function GemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}
function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

const successBadge: CSSProperties = {
  color: 'var(--success)',
  borderColor: 'color-mix(in srgb, var(--success) 32%, transparent)',
};

export function GocoonPanel() {
  const [status, setStatus] = useState<GocoonStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [withdrawDest, setWithdrawDest] = useState('');
  const [events, setEvents] = useState<WEvent[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const r = await api.gocoonStatus();
      if (r.success) setStatus(r.data);
    } catch {
      /* keep last known status */
    }
  };

  useEffect(() => {
    void refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const w = status?.wallet ?? null;
  const running = !!status?.runner;
  const balNano = w ? BigInt(w.balanceNano || '0') : 0n;
  const hasFunds = !!w && (w.funded || balNano > PROVISIONED_NANO);
  const awaitingDeposit = !!status?.installed && !!w && !running && !hasFunds;

  // While waiting for the first deposit, poll so the balance is auto-detected.
  useEffect(() => {
    if (!awaitingDeposit) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [awaitingDeposit]);

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
    }
  };

  const onInstall = (): Promise<void> =>
    run('install', async () => {
      const r = await api.gocoonInstall();
      toast.success(`Installed gocoon ${r.data.version}`);
      await refresh();
    });

  const onSetup = (): Promise<void> =>
    run('setup', async () => {
      await api.gocoonInit();
      await refresh();
    });

  const onTopup = (): Promise<void> =>
    run('topup', async () => {
      if (!topupAmount.trim()) return;
      await api.gocoonTopup(topupAmount.trim());
      toast.success(`Topped up ${topupAmount} TON`);
      setTopupAmount('');
      await refresh();
    });

  const onWithdraw = (): Promise<void> =>
    run('withdraw', async () => {
      const dest = withdrawDest.trim();
      if (!dest) return;
      await api.gocoonWithdrawStart(dest);
      setEvents([]);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const s = await api.gocoonWithdrawStatus();
        if (!s.success) return;
        setEvents(s.data.events.map((e) => ({ stage: e.stage, status: e.status, message: e.message })));
        if (s.data.done) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (s.data.error) toast.error(s.data.error);
          else toast.success('Withdraw complete');
          void refresh();
        }
      }, 1500);
    });

  const copy = (s: string): void => {
    void navigator.clipboard?.writeText(s).then(() => toast.success('Address copied')).catch(() => {});
  };

  if (!status) {
    return (
      <div className="wallet-hero">
        <div className="wallet-hero-empty">Loading gocoon...</div>
      </div>
    );
  }

  const heroBadge: { text: string; cls?: string; style?: CSSProperties } = running
    ? { text: 'Running', style: successBadge }
    : hasFunds
      ? { text: 'Ready', style: successBadge }
      : { text: 'Awaiting funds', cls: 'warn' };

  return (
    <>
      <div className="wallet-hero">
        <GemIcon className="wallet-diamond" />
        {!status.installed ? (
          <div className="wallet-hero-empty">gocoon is not installed yet</div>
        ) : !w ? (
          <div className="wallet-hero-empty">No funding wallet yet, create one below</div>
        ) : (
          <>
            <div className="wallet-hero-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>COCOON Wallet</span>
              <span className={`badge${heroBadge.cls ? ' ' + heroBadge.cls : ''}`} style={heroBadge.style}>
                {heroBadge.text}
              </span>
            </div>
            <div className="wallet-balance">
              <span className="wallet-balance-amount">{w.balanceTon}</span>
              <span className="wallet-balance-unit">TON</span>
            </div>
            <div className="wallet-address">
              <code>{w.fundAddress}</code>
              <button className="wallet-addr-btn" onClick={() => copy(w.fundAddress)} aria-label="Copy address">
                <CopyIcon />
              </button>
              <a className="wallet-addr-btn" href={`https://tonviewer.com/${w.fundAddress}`} target="_blank" rel="noopener noreferrer" aria-label="View on TonViewer">
                <ExternalIcon />
              </a>
            </div>
          </>
        )}
      </div>

      <Steps installed={status.installed} hasWallet={!!w} funded={hasFunds} running={running} />

      <div className="card config-card" style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="config-card-body">
          {!status.installed && (
            <Action
              title="Install gocoon"
              hint="One-time download of the gocoon runner for your platform."
              right={
                <button className="btn-sm" disabled={!!busy} onClick={onInstall}>
                  {busy === 'install' ? 'Installing...' : 'Install gocoon'}
                </button>
              }
            />
          )}
          {status.installed && !w && (
            <Action
              title="Create funding wallet"
              hint="Generates your COCOON wallet. The address is fixed and reused afterwards."
              right={
                <button className="btn-sm" disabled={!!busy} onClick={onSetup}>
                  {busy === 'setup' ? 'Creating...' : 'Create funding wallet'}
                </button>
              }
            />
          )}
          {awaitingDeposit && (
            <Action
              title={`Send ${w?.recommendedFundingTon ?? '20'} TON to the address above`}
              hint="Mainnet. Detected automatically."
              right={
                <span className="helper-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner sm" /> Waiting for funds
                </span>
              }
            />
          )}
          {!running && hasFunds && (
            <Action
              title="Ready to run"
              hint="Set the provider to Gocoon and start the agent. The runner and payment channel start automatically."
              right={<span className="badge" style={successBadge}>Funded</span>}
            />
          )}
          {running && (
            <Action
              title="Running"
              hint="The agent is serving on gocoon. The payment channel is staked and active."
              right={<span className="badge always">live</span>}
            />
          )}

          <div className="gocoon-meta">
            <span>
              <span className={`status-dot ${running ? 'connected' : 'disconnected'}`} /> Runner{' '}
              {running ? 'running' : 'stopped'}
            </span>
            {status.installed && status.version && <span className="helper-text">gocoon {status.version}</span>}
            <span style={{ marginLeft: 'auto' }}>
              <RefreshButton onRefresh={() => void refresh()} />
            </span>
          </div>
        </div>
      </div>

      {w && (
        <div className="card config-card">
          <div className="config-card-head">
            <span className="config-card-title">Manage</span>
          </div>
          <div className="config-card-body" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
            {hasFunds && (
              <div className="form-group">
                <label>Top up channel</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="w-full"
                    type="number"
                    placeholder="TON (e.g. 5)"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                  />
                  <button className="btn-sm" disabled={!!busy || !topupAmount.trim()} onClick={onTopup}>
                    {busy === 'topup' ? 'Topping up...' : 'Top up'}
                  </button>
                </div>
                <div className="helper-text">Adds stake to the channel (the runner must be active).</div>
              </div>
            )}

            <div className="form-group">
              <label>Withdraw everything</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="w-full"
                  type="text"
                  placeholder="TON address or .ton domain"
                  value={withdrawDest}
                  onChange={(e) => setWithdrawDest(e.target.value)}
                />
                <button className="btn-sm" disabled={!!busy || !withdrawDest.trim()} onClick={onWithdraw}>
                  {busy === 'withdraw' ? 'Withdrawing...' : 'Withdraw'}
                </button>
              </div>
              <div className="helper-text">
                Stop the agent first. Closes the channel and drains the COCOON + agent wallets. Irreversible.
              </div>
              {events.length > 0 && (
                <div className="info-panel" style={{ marginTop: 8 }}>
                  {events.map((e, i) => (
                    <div key={i} className="helper-text">
                      {e.status === 'ok' ? '[ok]' : e.status === 'error' ? '[x]' : '[..]'} [{e.stage}] {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Steps({ installed, hasWallet, funded, running }: {
  installed: boolean;
  hasWallet: boolean;
  funded: boolean;
  running: boolean;
}) {
  const steps = [
    { label: 'Install', done: installed },
    { label: 'Wallet', done: hasWallet },
    { label: 'Fund', done: funded },
    { label: 'Run', done: running },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="gocoon-steps">
      {steps.map((s, i) => {
        const state = s.done ? 'done' : i === current ? 'current' : 'pending';
        return (
          <div key={s.label} className="gocoon-step">
            <span className={`gocoon-step-dot ${state}`}>{s.done ? '✓' : i + 1}</span>
            <span className={`gocoon-step-label ${state}`}>{s.label}</span>
            {i < steps.length - 1 && <span className={`gocoon-step-line ${s.done ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

function Action({ title, hint, right }: { title: string; hint: string; right: ReactNode }) {
  return (
    <div className="gocoon-action">
      <div style={{ minWidth: 0 }}>
        <div className="config-card-title">{title}</div>
        <div className="helper-text" style={{ marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}
