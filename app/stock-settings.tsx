import { useEffect, useState } from 'react';
import { api } from './types';
export function StockSettings() {
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ configured: boolean }>('/api/settings/stocks')
      .then((value) => setConfigured(value.configured))
      .catch((cause) => setError(cause.message));
  }, []);
  return (
    <section className="account-section">
      <h2>Stock quotes</h2>
      <p className="muted">
        Connect one Finnhub key for all your screens. Quotes refresh every 15
        minutes during scheduled US trading hours. Data availability and delay
        depend on your provider account.
      </p>
      <p>
        {configured ? 'Stock quotes configured' : 'Stock quotes not connected'}{' '}
        ·{' '}
        <a href="https://finnhub.io/register" target="_blank" rel="noreferrer">
          Get a Finnhub key
        </a>
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <form
        className="account-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void api<{ configured: boolean }>('/api/settings/stocks', 'PUT', {
            token,
          })
            .then((value) => {
              setConfigured(value.configured);
              setToken('');
            })
            .catch((cause) => setError(cause.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Finnhub API key
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            minLength={10}
            maxLength={200}
          />
        </label>
        <button disabled={busy || !token.trim()}>Connect stock quotes</button>
        {configured && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void api('/api/settings/stocks', 'PUT', { token: '' })
                .then(() => setConfigured(false))
                .catch((cause) => setError(cause.message))
                .finally(() => setBusy(false));
            }}
          >
            Disconnect stocks
          </button>
        )}
      </form>
      <p className="muted">
        The key is encrypted on the server and is never sent to players.
      </p>
    </section>
  );
}
