export function createClockFormatter(config = {}, locales = []) {
  return new Intl.DateTimeFormat(locales, {
    hour: '2-digit',
    minute: '2-digit',
    ...(config.showSeconds ? { second: '2-digit' } : {}),
    hourCycle: config.hour12 === false ? 'h23' : 'h12',
  });
}

export function clockText(config, now = Date.now()) {
  return createClockFormatter(config).format(now);
}

export function nextClockDelay(config = {}, now = Date.now()) {
  const interval = config.showSeconds ? 1000 : 60000;
  return interval - (now % interval);
}
