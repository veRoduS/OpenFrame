import { useState } from 'react';
import { Eye, EyeOff, Wifi } from 'lucide-react';
import { api } from './types';

type Recovery = { available: boolean; ssid?: string; password?: string };
export function DeviceRecovery({
  id,
  phase,
}: {
  id: string;
  phase?: string | null;
}) {
  const [value, setValue] = useState<Recovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function reveal() {
    if (value) {
      setValue(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      setValue(await api<Recovery>(`/api/devices/${id}/recovery`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="device-recovery" aria-label="Recovery Wi-Fi">
      <div className="recovery-heading">
        <Wifi size={16} />
        <span>
          Recovery Wi-Fi
          {phase
            ? `: ${{ standby: 'Standby', starting: 'Starting', hotspot: 'Hotspot active', reconnecting: 'Reconnecting', error: 'Needs attention' }[phase] || phase}`
            : ''}
        </span>
        <button
          className="icon-button"
          title={
            value ? 'Hide recovery credentials' : 'Show recovery credentials'
          }
          aria-label={
            value ? 'Hide recovery credentials' : 'Show recovery credentials'
          }
          disabled={busy}
          onClick={() => void reveal()}
        >
          {value ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <div className="recovery-player-id">
        Player ID: <code>{id}</code>
      </div>
      {value?.available && (
        <dl className="recovery-details">
          <div>
            <dt>Hidden network</dt>
            <dd>{value.ssid}</dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd>{value.password}</dd>
          </div>
          <div>
            <dt>Recovery address</dt>
            <dd>http://192.168.50.1</dd>
          </div>
        </dl>
      )}
      {value && !value.available && (
        <p>Waiting for the updated player to retrieve recovery settings.</p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
