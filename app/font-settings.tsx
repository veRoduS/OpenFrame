import { useState, type SyntheticEvent } from 'react';
import { Check, Trash2, Upload } from 'lucide-react';
import { api } from './types';
import type { CustomFont } from './font-utils';

export function FontSettings({
  fonts,
  refresh,
}: {
  fonts: CustomFont[];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api<CustomFont>('/api/fonts', 'POST', form);
      formElement.reset();
      await refresh();
      setNotice('Font added. It is ready to use in slide typography.');
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(font: CustomFont) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/fonts/${font.id}`, 'DELETE');
      await refresh();
      setNotice(`${font.family} removed.`);
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-intro">
        <h2>Custom fonts</h2>
        <p>
          Add WOFF2, WOFF, TTF, or OTF files. Fonts are included with published
          playlists so screens can display them without an internet connection.
          Maximum file size: 10 MB.
        </p>
      </div>
      <form className="font-upload-form" onSubmit={upload}>
        <label>
          Font name
          <input
            name="family"
            required
            maxLength={80}
            placeholder="For example, Open Sans"
          />
        </label>
        <label>
          Font file
          <input
            name="file"
            type="file"
            accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
            required
          />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          <Upload size={16} />
          Add font
        </button>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <output className="success-message">
          <Check size={16} />
          {notice}
        </output>
      )}
      <div className="custom-font-list" aria-label="Custom fonts">
        {fonts.length ? (
          fonts.map((font) => (
            <article className="custom-font-row" key={font.id}>
              <div>
                <strong>{font.family}</strong>
                <span>
                  {font.format.toUpperCase()} · {(font.bytes / 1024).toFixed(0)}{' '}
                  KB
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${font.family}`}
                title={`Remove ${font.family}`}
                disabled={busy}
                onClick={() => void remove(font)}
              >
                <Trash2 size={16} />
                Remove
              </button>
            </article>
          ))
        ) : (
          <p className="small-empty">No custom fonts have been added.</p>
        )}
      </div>
    </section>
  );
}
