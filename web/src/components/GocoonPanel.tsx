import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/utils';
import { toast } from '../lib/toast';

interface GocoonStatus {
  installed: boolean;
  version: string | null;
  wallet: { ownerAddress: string; balanceTon: string; funded: boolean } | null;
  runner: boolean;
}

type WEvent = { stage: string; status: string; message: string };

const short = (a: string): string => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/**
 * Gocoon management — install, set up + fund the COCOON wallet, top up, and
 * withdraw. Thin UI over /api/gocoon/* (the same lifecycle the CLI drives).
 */
export function GocoonPanel() {
  const [status, setStatus] = useState<GocoonStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fund, setFund] = useState<{ fundAddress: string; recommendedFundingTon: string } | null>(null);
  const [waitingFunds, setWaitingFunds] = useState(false);
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

  // Poll the balance after init until the funding lands on-chain.
  useEffect(() => {
    if (!waitingFunds) return;
    const t = setInterval(async () => {
      try {
        const r = await api.gocoonBalance();
        if (r.success && r.data.funded) {
          setWaitingFunds(false);
          toast.success('COCOON wallet funded');
          void refresh();
        }
      } catch {
        /* retry */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [waitingFunds]);

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

  const onInit = (): Promise<void> =>
    run('init', async () => {
      const r = await api.gocoonInit();
      setFund(r.data);
      setWaitingFunds(true);
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

  if (!status) return <div className="card">Loading gocoon…</div>;

  const wallet = status.wallet;

  return (
    <div className="card config-card">
      {/* Status rows */}
      <div className="config-card-body" style={{ display: 'grid', gap: 6 }}>
        <Row label="Installed">
          {status.installed ? (
            <span className="badge">{status.version}</span>
          ) : (
            <button className="btn-sm" disabled={busy !== null} onClick={onInstall}>
              {busy === 'install' ? 'Installing…' : 'Install gocoon'}
            </button>
          )}
        </Row>
        <Row label="Wallet">{wallet ? short(wallet.ownerAddress) : <span className="helper-text">not set up</span>}</Row>
        {wallet && (
          <Row label="Balance">
            {wallet.balanceTon} TON{' '}
            <span className="badge">{wallet.funded ? 'funded' : 'not funded'}</span>
          </Row>
        )}
        <Row label="Runner">{status.runner ? <span className="badge always">running</span> : <span className="helper-text">not running</span>}</Row>
      </div>

      {/* Set up + fund */}
      {status.installed && !wallet?.funded && (
        <div className="config-card-body" style={{ marginTop: 10 }}>
          {!fund ? (
            <button className="btn-sm" disabled={busy !== null} onClick={onInit}>
              {busy === 'init' ? 'Setting up…' : 'Set up COCOON wallet'}
            </button>
          ) : (
            <div className="info-panel">
              <div>
                Send <b>{fund.recommendedFundingTon} TON</b> (mainnet) to:
              </div>
              <code style={{ wordBreak: 'break-all' }}>{fund.fundAddress}</code>
              <div className="helper-text">
                {waitingFunds ? 'Waiting for funding to confirm on-chain…' : 'Funded.'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top up */}
      {wallet && (
        <div className="config-card-body form-group" style={{ marginTop: 10 }}>
          <label>Top up channel</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="w-full"
              type="number"
              placeholder="TON (e.g. 5)"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
            <button className="btn-sm" disabled={busy !== null || !topupAmount.trim()} onClick={onTopup}>
              {busy === 'topup' ? 'Topping up…' : 'Top up'}
            </button>
          </div>
          <div className="helper-text">Adds stake to the payment channel (the runner must be active).</div>
        </div>
      )}

      {/* Withdraw everything */}
      {wallet && (
        <div className="config-card-body form-group" style={{ marginTop: 10 }}>
          <label>Withdraw everything</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="w-full"
              type="text"
              placeholder="TON address or .ton domain"
              value={withdrawDest}
              onChange={(e) => setWithdrawDest(e.target.value)}
            />
            <button className="btn-sm" disabled={busy !== null || !withdrawDest.trim()} onClick={onWithdraw}>
              {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
            </button>
          </div>
          <div className="helper-text">
            Closes the channel and drains the COCOON + agent wallets. Stop the agent first. Irreversible.
          </div>
          {events.length > 0 && (
            <div className="info-panel" style={{ marginTop: 8 }}>
              {events.map((e, i) => (
                <div key={i} className="helper-text">
                  {e.status === 'ok' ? '✓' : e.status === 'error' ? '✗' : '›'} [{e.stage}] {e.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="config-card-title">{label}</span>
      <span>{children}</span>
    </div>
  );
}
