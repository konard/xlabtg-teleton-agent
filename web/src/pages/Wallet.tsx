import React, { useState } from 'react';
import { api, WalletInfo, WalletTransaction } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import { useResource } from '../hooks/useResource';
import { Alert } from '../components/Alert';

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-6)}`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}\u2026${hash.slice(-8)}`;
}

export function Wallet() {
  const { data: wallet, loading, error, reload: reloadWallet, setError } =
    useResource<WalletInfo | null>(
      () => api.getWallet().then((r) => r.data ?? null),
      [],
    );
  const { data: transactions, loading: txLoading, reload: reloadTx } =
    useResource<WalletTransaction[]>(
      () => api.getWalletTransactions().then((r) => r.data ?? []),
      [],
    );

  const [copied, setCopied] = useState(false);
  const [expandedTx, setExpandedTx] = useState<string | null>(null);

  const refresh = () => {
    reloadWallet();
    reloadTx();
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const toggleTx = (hash: string) => {
    setExpandedTx(expandedTx === hash ? null : hash);
  };

  const getDirection = (type: string): 'in' | 'out' | 'other' => {
    if (type.includes('received') || type === 'gas_refund') return 'in';
    if (type.includes('sent')) return 'out';
    return 'other';
  };

  return (
    <div>
      <div className="header">
        <h1>Wallet</h1>
        <p>TON blockchain wallet</p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ marginBottom: '12px' }} />}

      {/* Wallet info card */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Loading wallet...</div>
        ) : !wallet?.address ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>No wallet configured</div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Address</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{ fontSize: '13px', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {truncateAddress(wallet.address)}
                </code>
                <button
                  onClick={copyAddress}
                  className="btn-ghost btn-sm"
                  style={{ padding: '2px 6px', fontSize: '11px' }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Balance</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {wallet.balance} TON
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transactions table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>Recent Transactions</span>
          <button
            onClick={refresh}
            disabled={txLoading}
            className="btn-ghost btn-sm"
          >
            {txLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {txLoading ? (
          <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
        ) : (transactions ?? []).length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            No transactions yet
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px', width: '40px' }}></th>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '120px' }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Address</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '140px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {(transactions ?? []).map((tx) => {
                const dir = getDirection(tx.type);
                const isExpanded = expandedTx === tx.hash;
                const counterparty = tx.from || tx.to || tx.jettonWallet || '\u2014';
                return (
                  <React.Fragment key={tx.hash}>
                    <tr
                      onClick={() => toggleTx(tx.hash)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTx(tx.hash); } }}
                      tabIndex={0}
                      role="button"
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        backgroundColor: isExpanded ? 'var(--glass-micro)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '6px 14px', fontSize: '16px' }}>
                        <span style={{
                          color: dir === 'in' ? 'var(--green)' : dir === 'out' ? 'var(--red)' : 'var(--text-secondary)',
                        }}>
                          {dir === 'in' ? '\u2193' : dir === 'out' ? '\u2191' : '\u2022'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 14px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          fontSize: '11px',
                          borderRadius: '3px',
                          backgroundColor: dir === 'in' ? 'var(--green-dim)' : dir === 'out' ? 'var(--red-dim)' : 'var(--bg-muted)',
                          color: dir === 'in' ? 'var(--green)' : dir === 'out' ? 'var(--red)' : 'var(--text-secondary)',
                        }}>
                          {tx.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{
                        textAlign: 'right',
                        padding: '6px 14px',
                        fontWeight: 500,
                        color: dir === 'in' ? 'var(--green)' : 'var(--text-primary)',
                      }}>
                        {tx.amount ? `${dir === 'in' ? '+' : dir === 'out' ? '-' : ''}${tx.amount}` : '\u2014'}
                      </td>
                      <td style={{ padding: '6px 14px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '12px' }}>
                        {truncateAddress(counterparty)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {formatDateTime(tx.date)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--glass-micro)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={5} style={{ padding: '0 14px 14px 14px' }}>
                          <div style={{
                            padding: '10px 12px',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-glass)',
                            marginTop: '8px',
                          }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Hash</span>
                                <code style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{truncateHash(tx.hash)}</code>
                              </div>
                              {tx.from && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>From</span>
                                  <code style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '11px' }}>{tx.from}</code>
                                </div>
                              )}
                              {tx.to && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>To</span>
                                  <code style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '11px' }}>{tx.to}</code>
                                </div>
                              )}
                              {tx.comment && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Comment</span>
                                  <span style={{ color: 'var(--text-primary)' }}>{tx.comment}</span>
                                </div>
                              )}
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Explorer</span>
                                <a href={tx.explorer} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '12px' }}>
                                  View on TonViewer
                                </a>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
