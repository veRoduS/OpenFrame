import { useState, type SyntheticEvent } from 'react';

export function KeyExpiryFields({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <>
      <label className="key-no-expiry">
        <input
          type="checkbox"
          checked={value === null}
          onChange={(event) => onChange(event.target.checked ? null : 90)}
        />
        Never expires
      </label>
      <label>
        Expires in days
        <input
          type="number"
          min={1}
          max={365}
          required={value !== null}
          disabled={value === null}
          value={value ?? ''}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    </>
  );
}

export function KeyExpiryEditor({
  name,
  expiresAt,
  onSave,
}: {
  name: string;
  expiresAt: string | null;
  onSave: (days: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number | null>(
    expiresAt === null ? null : 90,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(days);
      setOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return open ? (
    <form
      className="key-expiry-editor"
      aria-label={`Expiration for ${name}`}
      onSubmit={save}
    >
      <fieldset disabled={busy}>
        <KeyExpiryFields value={days} onChange={setDays} />
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button type="submit">Save expiration</button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </fieldset>
    </form>
  ) : (
    <button
      type="button"
      aria-label={`Change expiration for ${name}`}
      onClick={() => {
        setDays(expiresAt === null ? null : 90);
        setError('');
        setOpen(true);
      }}
    >
      Change expiration
    </button>
  );
}
