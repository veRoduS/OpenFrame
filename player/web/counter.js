export const unitMilliseconds = {
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
  days: 86400000,
};

export function counterValue(config, now = Date.now()) {
  const target = Date.parse(config.targetAt),
    unit = unitMilliseconds[config.unit];
  if (!Number.isFinite(target) || !unit)
    throw new Error('Invalid counter configuration');
  const up = now >= target;
  const delta = up ? now - target : target - now;
  return Math.max(0, up ? Math.floor(delta / unit) : Math.ceil(delta / unit));
}

export function counterText(config, now = Date.now()) {
  const value = counterValue(config, now);
  if (now >= Date.parse(config.targetAt) && config.goalMessage?.trim())
    return config.goalMessage.trim();
  const unit = value === 1 ? config.unit.slice(0, -1) : config.unit;
  const count = config.showUnit === false ? String(value) : `${value} ${unit}`;
  return [config.prefix?.trim(), count, config.suffix?.trim()]
    .filter(Boolean)
    .join(' ');
}

export function nextCounterDelay(config, now = Date.now()) {
  const target = Date.parse(config.targetAt),
    unit = unitMilliseconds[config.unit];
  if (now >= target && config.goalMessage?.trim()) return null;
  const up = now >= target;
  const elapsed = up ? now - target : target - now;
  const remainder = elapsed % unit;
  return Math.max(16, up ? unit - remainder : remainder || unit);
}

export function localDateTime(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}
