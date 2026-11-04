// Plain text only: metric values never become HTML.
export function metricText(template, config, snapshot) {
  if (!config) return template;
  const value = snapshot?.data?.[config.field];
  const formatted =
    snapshot?.status !== 'unavailable' &&
    typeof value === 'number' &&
    Number.isFinite(value)
      ? `${config.card?.prefix || ''}${value.toLocaleString('en-US', { minimumFractionDigits: config.decimals || 0, maximumFractionDigits: config.decimals || 0 })}${config.unit || ''}`
      : '—';
  return template.split(`<${config.field}>`).join(formatted);
}
