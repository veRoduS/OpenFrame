import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from './types';

type Status = {
  enabled: boolean;
  endpoint?: string;
  server?: string;
  peers: { id: string; name: string; address: string }[];
};
export function ManagedVpn() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    setError('');
    void api<Status>('/api/managed-vpn')
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(refresh, []);
  return (
    <section className="managed-vpn">
      <div className="setup-option">
        <h3>Managed WireGuard</h3>
        <button
          className="icon-button"
          aria-label="Refresh VPN status"
          title="Refresh VPN status"
          disabled={busy}
          onClick={refresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {busy && !status && <output>Connecting...</output>}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {status && (
        <>
          <p className="setup-state">
            {status.enabled ? 'Enabled' : 'Not enabled'}
          </p>
          {status.enabled && (
            <>
              <dl className="setup-grid">
                <div>
                  <dt>Public endpoint</dt>
                  <dd>{status.endpoint}</dd>
                </div>
                <div>
                  <dt>Private server</dt>
                  <dd>{status.server}</dd>
                </div>
              </dl>
              <h3>Registered screens ({status.peers.length})</h3>
              {status.peers.length === 0 && (
                <p className="setup-empty">No registered VPN peers</p>
              )}
              {status.peers.map((peer) => (
                <div className="setup-row" key={peer.id}>
                  <strong>{peer.name}</strong>
                  <span>{peer.address}</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
