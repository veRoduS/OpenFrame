let snapshots = {};
const listeners = new Set();
export function setStockSnapshots(value) {
  snapshots = value || {};
  for (const listener of listeners) listener();
}
export function subscribeStocks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getStockSnapshots = () => snapshots;
export function renderStocks(
  element,
  config,
  values = snapshots,
  now = Date.now(),
) {
  const span = (text, style = {}) => {
    const node = document.createElement('span');
    node.textContent = text;
    Object.assign(
      node.style,
      { display: 'block', lineHeight: '1.25', whiteSpace: 'normal' },
      style,
    );
    return node;
  };
  const rows = [
    span(config?.name || 'Stocks', {
      fontSize: '0.55em',
      marginBottom: '0.35em',
    }),
  ];
  for (const symbol of config?.symbols || []) {
    const quote = values[symbol];
    const row = span('');
    row.dataset.stockSymbol = symbol;
    row.append(span(symbol, { fontSize: '0.45em', fontWeight: '700' }));
    if (Number.isFinite(quote?.price)) {
      const stale =
        quote.status === 'stale' ||
        (quote.scheduledSession &&
          now - Date.parse(quote.quotedAt) > 30 * 60000);
      const change = `${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`;
      row.append(
        span(`$${quote.price.toFixed(2)}`, { fontSize: '0.9em' }),
        span(change, {
          fontSize: '0.35em',
          color: quote.change < 0 ? '#a12e36' : '#17613d',
        }),
        span(
          `${stale ? 'Cached · ' : ''}Quote ${new Date(quote.quotedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`,
          { fontSize: '0.22em' },
        ),
      );
    } else
      row.append(
        span(
          quote?.status === 'unconfigured'
            ? 'Ask an admin to connect stock quotes in Settings'
            : quote?.status === 'unavailable'
              ? 'Quote unavailable'
              : 'Waiting for quote',
          { fontSize: '0.3em' },
        ),
      );
    row.style.marginBottom = '0.35em';
    rows.push(row);
  }
  rows.push(
    span(
      'Finnhub · USD · 15-minute refresh during scheduled US trading hours',
      { fontSize: '0.2em', opacity: '0.65' },
    ),
  );
  element.replaceChildren(...rows);
}
