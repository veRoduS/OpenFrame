import { useId } from 'react';
import type { DataCardConfig, DataFeed, Layer } from './types';
import './data-card-options.css';

type WidgetConfig = NonNullable<Layer['data']>;
type CardProps = {
  config: WidgetConfig;
  onChange: (card: DataCardConfig) => void;
};

function cardSettings(config: WidgetConfig): DataCardConfig {
  return {
    style: 'split',
    header: config.mode === 'line' ? 'navy' : 'blue',
    badge: 'spark',
    deltaText: '',
    deltaField: '',
    deltaUnit: '%',
    prefix: '',
    subtitle: '',
    footer: '',
    footerRight: '',
    rows: 'table',
    rowDeltaField: '',
    maxRows: 4,
    scaleMax: 100,
    ...config.card,
  };
}

function StylePreview({
  mode,
  split,
}: {
  mode: WidgetConfig['mode'];
  split: boolean;
}) {
  const ink = split ? '#001e60' : '#526158';
  const accent = split ? '#0053e2' : '#17613d';
  return (
    <span
      className={`data-card-style-visual${split ? ' is-split' : ''}${mode === 'bar' ? ' is-breakdown' : ''}`}
      data-mode={mode}
      aria-hidden="true"
    >
      <span className="data-card-style-band">
        <span />
        {split && <i />}
      </span>
      <svg viewBox="0 0 100 54" focusable="false">
        {mode === 'progress' && split ? (
          <>
            <circle
              cx="26"
              cy="27"
              r="17"
              fill="none"
              stroke="#e8eef5"
              strokeWidth="7"
            />
            <circle
              cx="26"
              cy="27"
              r="17"
              fill="none"
              stroke={accent}
              strokeWidth="7"
              strokeDasharray="77 107"
              transform="rotate(-90 26 27)"
              strokeLinecap="round"
            />
            <rect
              x="54"
              y="17"
              width="36"
              height="11"
              rx="4"
              fill={split ? '#a9ddf7' : '#e2e9e4'}
            />
            <path
              d="M54 36h29"
              stroke={ink}
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        ) : mode === 'progress' ? (
          <>
            <path
              d="M10 15h30"
              stroke={ink}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <rect x="8" y="29" width="84" height="13" rx="6" fill="#e2e9e4" />
            <rect x="8" y="29" width="64" height="13" rx="6" fill={accent} />
          </>
        ) : mode === 'line' ? (
          <>
            <path
              d="M9 44 25 38 41 40 58 29 75 24 91 11V47H9Z"
              fill={split ? '#a9ddf7' : '#e2e9e4'}
            />
            <path
              d="M9 44 25 38 41 40 58 29 75 24 91 11"
              fill="none"
              stroke={accent}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="91"
              cy="11"
              r="4"
              fill={split ? '#ffc220' : '#17613d'}
              stroke={accent}
              strokeWidth="2"
            />
          </>
        ) : mode === 'bar' && split ? (
          [8, 22, 36].map((y, i) => (
            <g key={y}>
              <rect
                x="7"
                y={y}
                width="86"
                height="11"
                rx="5"
                fill={split ? '#fff' : '#e2e9e4'}
              />
              <path
                d={`M14 ${y + 5.5}h${24 - i * 4}`}
                stroke={ink}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d={`M72 ${y + 5.5}h12`}
                stroke={accent}
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          ))
        ) : mode === 'bar' ? (
          [8, 22, 36].map((y, i) => (
            <g key={y}>
              <path
                d={`M8 ${y + 4}h16`}
                stroke={ink}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <rect
                x="33"
                y={y}
                width={58 - i * 15}
                height="8"
                rx="3"
                fill={accent}
              />
            </g>
          ))
        ) : (
          <>
            <path
              d="M15 22h29M15 31h29M53 22h19"
              stroke={ink}
              strokeWidth="7"
              strokeLinecap="round"
            />
            <rect x="79" y="13" width="10" height="6" rx="2" fill={ink} />
            <path
              d="M15 45h50"
              stroke={ink}
              strokeWidth="3"
              strokeLinecap="round"
              opacity=".55"
            />
          </>
        )}
      </svg>
    </span>
  );
}

export function DataCardStylePicker({ config, onChange }: CardProps) {
  const name = useId();
  const style = config.card?.style || 'plain';
  return (
    <fieldset className="data-card-style-picker">
      <legend>Card style</legend>
      <div className="data-card-style-choices">
        {(
          [
            ['plain', 'Classic'],
            ['split', 'Split header'],
          ] as const
        ).map(([value, label]) => (
          <label
            className="data-card-style-choice"
            data-selected={style === value}
            key={value}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={style === value}
              onChange={() =>
                onChange({ ...cardSettings(config), style: value })
              }
            />
            <StylePreview mode={config.mode} split={value === 'split'} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DataCardOptions({
  config,
  feed,
  onChange,
}: CardProps & { feed?: DataFeed }) {
  const card = cardSettings(config);
  const patch = (value: Partial<DataCardConfig>) =>
    onChange({ ...card, ...value });
  const numberFields =
    feed?.fields.filter((field) => field.type === 'number') || [];
  const categoryFields =
    feed?.fields.filter((field) => field.type === 'categories') || [];
  return (
    <div className="data-card-options">
      <label>
        Header color
        <select
          aria-label="Header color"
          value={card.header}
          onChange={(event) =>
            patch({ header: event.target.value as DataCardConfig['header'] })
          }
        >
          <option value="blue">True Blue</option>
          <option value="navy">Bentonville Blue</option>
        </select>
      </label>
      <label>
        Value prefix
        <input
          value={card.prefix}
          maxLength={8}
          placeholder="$"
          onChange={(event) => patch({ prefix: event.target.value })}
        />
      </label>
      <label>
        Supporting text
        <input
          value={card.subtitle}
          maxLength={100}
          placeholder="Describe this metric"
          onChange={(event) => patch({ subtitle: event.target.value })}
        />
      </label>
      <label>
        Header badge
        <select
          aria-label="Header badge"
          value={card.badge}
          onChange={(event) =>
            patch({ badge: event.target.value as DataCardConfig['badge'] })
          }
        >
          <option value="spark">Spark</option>
          <option value="delta">Delta pill</option>
          <option value="none">None</option>
        </select>
      </label>
      {(card.badge === 'delta' || config.mode === 'metric') && (
        <div className="data-card-option-group">
          <label>
            Delta field
            <select
              aria-label="Delta field"
              value={card.deltaField}
              onChange={(event) => patch({ deltaField: event.target.value })}
            >
              <option value="">Custom label</option>
              {numberFields.map((field) => (
                <option key={field.key}>{field.key}</option>
              ))}
            </select>
          </label>
          {!card.deltaField && (
            <label>
              Delta label
              <input
                value={card.deltaText}
                maxLength={32}
                placeholder="+2.4% or −6m faster"
                onChange={(event) => patch({ deltaText: event.target.value })}
              />
            </label>
          )}
          {card.deltaField && (
            <label>
              Delta unit
              <input
                value={card.deltaUnit}
                maxLength={12}
                placeholder="%"
                onChange={(event) => patch({ deltaUnit: event.target.value })}
              />
            </label>
          )}
        </div>
      )}
      {config.mode === 'progress' && (
        <>
          <label>
            Gauge maximum
            <input
              type="number"
              min={0.000001}
              max={1e12}
              value={card.scaleMax}
              onChange={(event) =>
                patch({ scaleMax: Number(event.target.value) })
              }
            />
          </label>
          <p className="data-card-help">
            Use 100 for a percentage. The goal is set separately.
          </p>
        </>
      )}
      {config.mode === 'bar' && (
        <>
          <label>
            Row layout
            <select
              aria-label="Row layout"
              value={card.rows}
              onChange={(event) =>
                patch({ rows: event.target.value as DataCardConfig['rows'] })
              }
            >
              <option value="table">Mini table</option>
              <option value="bars">Channel breakdown</option>
            </select>
          </label>
          <label>
            Visible rows
            <input
              type="number"
              min={1}
              max={8}
              step={1}
              value={card.maxRows}
              onChange={(event) =>
                patch({ maxRows: Number(event.target.value) })
              }
            />
          </label>
          {card.rows === 'table' && (
            <>
              <label>
                Row delta field
                <select
                  aria-label="Row delta field"
                  value={card.rowDeltaField}
                  onChange={(event) =>
                    patch({ rowDeltaField: event.target.value })
                  }
                >
                  <option value="">No row deltas</option>
                  {categoryFields.map((field) => (
                    <option key={field.key}>{field.key}</option>
                  ))}
                </select>
              </label>
              {card.rowDeltaField && (
                <>
                  {!(card.badge === 'delta' && card.deltaField) && (
                    <label>
                      Delta unit
                      <input
                        value={card.deltaUnit}
                        maxLength={12}
                        placeholder="%"
                        onChange={(event) =>
                          patch({ deltaUnit: event.target.value })
                        }
                      />
                    </label>
                  )}
                  <p className="data-card-help">
                    Row deltas match category names in the selected field.
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
      <details className="data-card-footer-options">
        <summary>Footer labels</summary>
        <div>
          <label>
            Footer text
            <input
              value={card.footer}
              maxLength={80}
              placeholder="Optional context"
              onChange={(event) => patch({ footer: event.target.value })}
            />
          </label>
          <label>
            Footer right label
            <input
              value={card.footerRight}
              maxLength={40}
              placeholder="Optional label"
              onChange={(event) => patch({ footerRight: event.target.value })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
