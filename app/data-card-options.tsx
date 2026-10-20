import { useId, type ReactNode } from 'react';
import type { DataCardConfig, DataFeed, Layer } from './types';
import './data-card-options.css';

type WidgetConfig = NonNullable<Layer['data']>;
type CardProps = {
  config: WidgetConfig;
  onChange: (card: DataCardConfig) => void;
};

export function dataCardSettings(config: WidgetConfig): DataCardConfig {
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
    rowOffset: 0,
    showRowRange: true,
    scaleMax: 100,
    showStats: false,
    valueAlign: 'auto',
    titleScale: 100,
    valueScale: 100,
    detailScale: 100,
    paddingX: 16,
    paddingY: 16,
    thresholdMode: 'off',
    thresholdGoal: 95,
    thresholdWarning: 90,
    thresholdUseTarget: true,
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
                onChange({ ...dataCardSettings(config), style: value })
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

export function WidgetPropertySection({
  title,
  children,
  open = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="widget-property-section" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function DataCardOptions({
  config,
  feed,
  onChange,
  valueFields,
  goalFields,
  footerFields,
}: CardProps & {
  feed?: DataFeed;
  valueFields: ReactNode;
  goalFields: ReactNode;
  footerFields: ReactNode;
}) {
  const card = dataCardSettings(config);
  const patch = (value: Partial<DataCardConfig>) =>
    onChange({ ...card, ...value });
  const numberFields =
    feed?.fields.filter((field) => field.type === 'number') || [];
  const categoryFields =
    feed?.fields.filter((field) => field.type === 'categories') || [];
  const usesTarget = config.mode === 'progress' && card.thresholdUseTarget;
  const goal = usesTarget ? config.target : card.thresholdGoal;
  const dynamicGoal = usesTarget && !!config.targetField;
  const invalidThresholds =
    !dynamicGoal &&
    card.thresholdMode !== 'off' &&
    (card.thresholdMode === 'higher'
      ? card.thresholdWarning > goal
      : card.thresholdWarning < goal);
  return (
    <div className="data-card-options">
      <WidgetPropertySection title="Value and number format">
        {valueFields}
        <label>
          Value prefix
          <input
            value={card.prefix}
            maxLength={8}
            placeholder="$"
            onChange={(event) => patch({ prefix: event.target.value })}
          />
        </label>
        {config.mode !== 'progress' && (
          <label>
            Supporting text
            <input
              value={card.subtitle}
              maxLength={100}
              placeholder="Describe this metric"
              onChange={(event) => patch({ subtitle: event.target.value })}
            />
          </label>
        )}
      </WidgetPropertySection>
      <WidgetPropertySection title="Header and delta badge" open={false}>
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
      </WidgetPropertySection>
      <WidgetPropertySection title="Text size and alignment" open={false}>
        {config.mode !== 'progress' && (
          <label>
            Value alignment
            <select
              aria-label="Value alignment"
              value={card.valueAlign}
              onChange={(event) =>
                patch({
                  valueAlign: event.target
                    .value as DataCardConfig['valueAlign'],
                })
              }
            >
              <option value="auto">Default</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        )}
        {(
          [
            ['titleScale', 'Header text size (%)'],
            ['valueScale', 'Value text size (%)'],
            ['detailScale', 'Detail text size (%)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={50}
              max={200}
              step={1}
              value={card[key]}
              onChange={(event) => patch({ [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <p className="data-card-help">
          100% keeps the original text size. Text fits the available space.
        </p>
      </WidgetPropertySection>
      <WidgetPropertySection title="Card padding" open={false}>
        {(
          [
            ['paddingX', 'Horizontal body padding'],
            ['paddingY', 'Vertical body padding'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={48}
              step={1}
              value={card[key]}
              onChange={(event) => patch({ [key]: Number(event.target.value) })}
            />
          </label>
        ))}
        <p className="data-card-help">
          Body padding uses design pixels and scales with the card; gauges stay
          centered.
        </p>
      </WidgetPropertySection>
      <WidgetPropertySection title="Goals and status colors">
        {goalFields}
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

        <label>
          Color thresholds
          <select
            aria-label="Color thresholds"
            value={card.thresholdMode}
            onChange={(event) => {
              const mode = event.target
                .value as DataCardConfig['thresholdMode'];
              const step = Math.max(1, Math.abs(goal) * 0.1);
              patch({
                thresholdMode: mode,
                ...(mode === 'lower' && card.thresholdWarning < goal
                  ? { thresholdWarning: Math.min(1e12, goal + step) }
                  : mode === 'higher' && card.thresholdWarning > goal
                    ? { thresholdWarning: Math.max(-1e12, goal - step) }
                    : {}),
              });
            }}
          >
            <option value="off">Off</option>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
          </select>
        </label>
        {card.thresholdMode !== 'off' && (
          <>
            {config.mode === 'progress' && (
              <label className="data-feed-checkbox">
                <input
                  type="checkbox"
                  checked={card.thresholdUseTarget}
                  onChange={(event) =>
                    patch({ thresholdUseTarget: event.target.checked })
                  }
                />
                Use gauge target as green goal
              </label>
            )}
            {!usesTarget && (
              <label>
                Green goal
                <input
                  type="number"
                  min={-1e12}
                  max={1e12}
                  step="any"
                  value={card.thresholdGoal}
                  onChange={(event) =>
                    patch({ thresholdGoal: Number(event.target.value) })
                  }
                />
              </label>
            )}
            <label>
              Yellow threshold
              <input
                type="number"
                min={-1e12}
                max={1e12}
                step="any"
                value={card.thresholdWarning}
                onChange={(event) =>
                  patch({ thresholdWarning: Number(event.target.value) })
                }
              />
            </label>
            <p className="data-card-help">
              {card.thresholdMode === 'higher'
                ? 'Green at or above the goal; yellow at or above the warning level; red below it.'
                : 'Green at or below the goal; yellow at or below the warning level; red above it.'}{' '}
              Use the same units as the feed value.{' '}
              {usesTarget
                ? 'Green follows the Target or Target field in this section.'
                : ''}{' '}
              {config.mode === 'bar' ? 'Each row is evaluated separately.' : ''}
            </p>
            {invalidThresholds && (
              <p className="data-card-help" role="alert">
                {card.thresholdMode === 'higher'
                  ? 'Yellow threshold must be at or below the green goal.'
                  : 'Yellow threshold must be at or above the green goal.'}
              </p>
            )}
          </>
        )}
      </WidgetPropertySection>
      {(config.mode === 'line' || config.mode === 'bar') && (
        <WidgetPropertySection
          title={config.mode === 'line' ? 'Chart details' : 'Table rows'}
        >
          {config.mode === 'line' && (
            <label className="data-feed-checkbox">
              <input
                type="checkbox"
                checked={card.showStats}
                onChange={(event) => patch({ showStats: event.target.checked })}
              />
              Show min / avg / max
            </label>
          )}
          {config.mode === 'bar' && (
            <>
              <label>
                Row layout
                <select
                  aria-label="Row layout"
                  value={card.rows}
                  onChange={(event) =>
                    patch({
                      rows: event.target.value as DataCardConfig['rows'],
                    })
                  }
                >
                  <option value="table">Mini table</option>
                  <option value="bars">Channel breakdown</option>
                </select>
              </label>
              <label>
                First row
                <input
                  type="number"
                  min={1}
                  max={40}
                  step={1}
                  value={card.rowOffset + 1}
                  onChange={(event) =>
                    patch({ rowOffset: Number(event.target.value) - 1 })
                  }
                />
              </label>
              <label>
                Visible rows
                <input
                  type="number"
                  min={1}
                  max={40}
                  step={1}
                  value={card.maxRows}
                  onChange={(event) =>
                    patch({ maxRows: Number(event.target.value) })
                  }
                />
              </label>
              <label className="data-feed-checkbox">
                <input
                  type="checkbox"
                  checked={card.showRowRange}
                  onChange={(event) =>
                    patch({ showRowRange: event.target.checked })
                  }
                />
                Show row range
              </label>
              <p className="data-card-help">
                Use a larger table for more rows, or split the same field across
                cards using First row.
              </p>
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
        </WidgetPropertySection>
      )}
      <WidgetPropertySection title="Footer and freshness" open={false}>
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
        {footerFields}
      </WidgetPropertySection>
    </div>
  );
}
