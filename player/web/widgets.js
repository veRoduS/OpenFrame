import { counterText, nextCounterDelay } from './counter.js';
import { createClockFormatter, nextClockDelay } from './clock.js';
import {
  weatherView,
  getWeatherSnapshot,
  subscribeWeather,
  renderWeather,
} from './weather.js';

export const widgets = new Map();
export function registerWidget(type, renderer) {
  if (widgets.has(type)) throw new Error(`Widget already registered: ${type}`);
  widgets.set(type, renderer);
}

function liveText(element, text, delay, onChange, subscribe, render) {
  let timer = null,
    unsubscribe,
    disposed = false;
  let previous;
  const paint = (force = false) => {
    const value = text();
    if (force || previous !== value) {
      previous = value;
      if (render) render(element, value);
      else element.textContent = value;
      onChange();
    }
  };
  paint(true);
  const tick = () => {
    if (disposed) return;
    paint(true);
    const next = delay();
    if (next !== null) timer = setTimeout(tick, Math.max(16, next));
  };
  return {
    ready: Promise.resolve(),
    activate() {
      if (disposed) return;
      unsubscribe?.();
      unsubscribe = subscribe?.(paint);
      clearTimeout(timer);
      tick();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
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

registerWidget('weather', (element, layer, { onChange = () => {} } = {}) =>
  liveText(
    element,
    () =>
      JSON.stringify(
        weatherView(layer.weather, getWeatherSnapshot(layer.weather)),
      ),
    () => 60000,
    onChange,
    subscribeWeather,
    (element, value) => renderWeather(element, JSON.parse(value)),
  ),
);

registerWidget('counter', (element, layer, { onChange = () => {} } = {}) => {
  if (!layer.counter) throw new Error('Counter configuration is missing');
  return liveText(
    element,
    () => counterText(layer.counter),
    () => nextCounterDelay(layer.counter),
    onChange,
  );
});
