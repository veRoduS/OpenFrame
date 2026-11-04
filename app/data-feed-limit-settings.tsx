import { useEffect, useState } from 'react';
import { api } from './types';
import { Button } from './components/ui/button';

type Limits = { maxFieldsPerFeed: number; minimum: number; maximum: number };
export function DataFeedLimitSettings({
  onChange,
}: {
  onChange: (limit: number) => void;
}) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [value, setValue] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void api<Limits>('/api/settings/data-feeds')
      .then((result) => {
        if (!active) return;
        setLimits(result);
        setValue(String(result.maxFieldsPerFeed));
        onChange(result.maxFieldsPerFeed);
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message);
      });
    return () => {
      active = false;
    };
  }, [onChange]);
  return (
    <details className="data-feed-limits">
      <summary>
        Feed limits
        {limits ? ` · ${limits.maxFieldsPerFeed} fields per feed` : ''}
      </summary>
      <p className="muted">
        Set the maximum number of fields for each feed across this workspace.
        Applies to manual feeds and application API updates.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output>{notice}</output>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          void api<Limits>('/api/settings/data-feeds', 'PUT', {
            maxFieldsPerFeed: Number(value),
          })
            .then((result) => {
              setLimits(result);
              setValue(String(result.maxFieldsPerFeed));
              onChange(result.maxFieldsPerFeed);
              setNotice('Feed field limit saved.');
            })
            .catch((cause) => setError((cause as Error).message))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={busy || !limits}>
          <label>
            Fields per feed
            <input
              type="number"
              required
              min={limits?.minimum ?? 1}
              max={limits?.maximum ?? 500}
              step={1}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setNotice('');
              }}
            />
          </label>
          <Button
            type="submit"
            disabled={Number(value) === limits?.maxFieldsPerFeed}
          >
            Save feed limit
          </Button>
        </fieldset>
      </form>
      <p className="muted">
        Default: 100. Range: 1–500. Lowering this limit keeps existing fields
        and allows updates to their values. Additional fields must fit the
        current limit.
      </p>
      <p className="muted">
        Payload limits still apply: 32 KiB per metrics/tables section and 256
        KiB per multi-store request. Tables support 100 rows; graphs support 240
        points.
      </p>
    </details>
  );
}
