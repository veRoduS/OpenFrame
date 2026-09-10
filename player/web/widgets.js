import { counterText, nextCounterDelay } from './counter.js';
import { createClockFormatter, nextClockDelay } from './clock.js';

export const widgets = new Map();
export function registerWidget(type, renderer) {
  if (widgets.has(type)) throw new Error(`Widget already registered: ${type}`);
  widgets.set(type, renderer);
}

function liveText(element, text, delay, onChange) {
  let timer = null,
    disposed = false;
  const paint = () => {
    element.textContent = text();
    onChange();
  };
  paint();
  const tick = () => {
    if (disposed) return;
    paint();
    const next = delay();
    if (next !== null) timer = setTimeout(tick, Math.max(16, next));
  };
  return {
    ready: Promise.resolve(),
    activate() {
      clearTimeout(timer);
      tick();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

registerWidget('clock', (element, layer, { onChange = () => {} } = {}) => {
  const formatter = createClockFormatter(layer.clock);
  return liveText(
    element,
    () => formatter.format(Date.now()),
    () => nextClockDelay(layer.clock),
    onChange,
  );
});

registerWidget('counter', (element, layer, { onChange = () => {} } = {}) => {
  if (!layer.counter) throw new Error('Counter configuration is missing');
  return liveText(
    element,
    () => counterText(layer.counter),
    () => nextCounterDelay(layer.counter),
    onChange,
  );
});
