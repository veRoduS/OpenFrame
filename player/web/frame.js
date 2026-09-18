import { widgets } from './widgets.js';
import { layoutText } from './text-layout.js';
import { imageStyle } from './image-layout.js';

function waitFor(promise, signal, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const abort = () =>
      finish(new DOMException('Preparation cancelled', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Slide readiness timed out')),
      timeout,
    );
    function finish(error, value) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    }
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    Promise.resolve(promise).then((value) => finish(null, value), finish);
  });
}

export async function prepareFrame(host, item, assets, rotation, signal) {
  const { slide } = item;
  const element = document.createElement('div');
  element.className = 'slide-frame';
  element.dataset.slideId = slide.id;
  element.style.visibility = 'hidden';
  element.setAttribute('aria-hidden', 'true');
  const rotated = rotation === 90 || rotation === 270;
  const scale = Math.min(
    (rotated ? innerHeight : innerWidth) / slide.width,
    (rotated ? innerWidth : innerHeight) / slide.height,
  );
  Object.assign(element.style, {
    width: `${slide.width * scale}px`,
    height: `${slide.height * scale}px`,
    background: slide.background,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  });
  host.append(element);
  const images = [],
    controllers = [],
    layouts = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    controllers.forEach((controller) => {
      try {
        controller.dispose();
      } catch {
        /* Continue releasing the rest of the frame. */
      }
    });
    for (const image of images) {
      image.removeAttribute('src');
      image.remove();
    }
    element.remove();
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (signal.aborted)
      throw new DOMException('Preparation cancelled', 'AbortError');
    for (const layer of slide.layers) {
      const box = document.createElement('div');
      box.className = 'layer';
      box.dataset.layerType = layer.type;
      Object.assign(box.style, {
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height}%`,
        color: layer.color,
        fontSize: `${layer.fontSize * scale}px`,
        fontWeight: layer.bold ? '700' : '400',
        textAlign: layer.align,
      });
      element.append(box);
      if (layer.type === 'image') {
        const asset = assets.find((a) => a.id === layer.assetId);
        if (!asset) throw new Error('An image is missing from the manifest');
        const image = document.createElement('img');
        image.alt = '';
        image.decoding = 'async';
        image.loading = 'eager';
        Object.assign(image.style, imageStyle(layer));
        image.src = asset.url;
        images.push(image);
        box.append(image);
      } else {
        const content = document.createElement('span');
        box.append(content);
        const layout = () => layoutText(box, content, layer, scale);
        layouts.push(layout);
        if (layer.type === 'text') content.textContent = layer.text;
        else {
          const renderer = widgets.get(layer.type);
          if (!renderer) throw new Error(`Unsupported widget: ${layer.type}`);
          const result = renderer(content, layer, { onChange: layout, signal });
          // Legacy cleanup-only widgets remain supported; new widgets stage quietly.
          controllers.push(
            typeof result === 'function'
              ? { ready: Promise.resolve(), activate() {}, dispose: result }
              : result,
          );
        }
      }
    }
    // Decode the same image elements that will be shown; no speculative image copies.
    await waitFor(
      Promise.all([
        ...images.map((image) => image.decode()),
        ...controllers.map((controller) => controller.ready),
        document.fonts?.ready || Promise.resolve(),
      ]),
      signal,
    );
    layouts.forEach((layout) => layout());
    // Give the browser a layout/paint opportunity while the current frame stays up.
    await waitFor(
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
      signal,
    );
    element.dataset.ready = 'true';
    return {
      element,
      slideId: slide.id,
      dispose,
      activate() {
        if (disposed) throw new Error('Prepared frame was disposed');
        controllers.forEach((c) => c.activate());
        layouts.forEach((layout) => layout());
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function commitFrame(next, previous, transition = {}) {
  next.activate();
  next.element.style.visibility = 'visible';
  next.element.setAttribute('aria-hidden', 'false');
  const hidePrevious = () => {
    if (!previous) return;
    previous.element.style.visibility = 'hidden';
    previous.element.setAttribute('aria-hidden', 'true');
  };
  if (
    !previous ||
    !['fade', 'slide-left', 'slide-right'].includes(transition.type) ||
    !next.element.animate ||
    !previous.element.animate ||
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    hidePrevious();
    return;
  }
  const duration = Number.isFinite(transition.durationMs)
    ? Math.max(200, Math.min(2000, transition.durationMs))
    : 500;
  const animations = [];
  let settle,
    timer,
    done = false;
  const finished = new Promise((resolve) => {
    settle = resolve;
  });
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    animations.forEach((animation) => animation.cancel());
    next.element.style.zIndex = '';
    previous.element.style.zIndex = '';
    hidePrevious();
    settle();
  };
  next.element.style.zIndex = '2';
  previous.element.style.zIndex = '1';
  const animate = (element, frames) => {
    const animation = element.animate(frames, {
      duration,
      easing: 'ease-in-out',
      fill: 'both',
    });
    animations.push(animation);
    // Cancelling an animation rejects finished; cancellation is normal cleanup.
    void animation.finished.catch(() => {});
    return animation.finished;
  };
  try {
    const pending = [];
    if (transition.type === 'fade') {
      pending.push(animate(next.element, [{ opacity: 0 }, { opacity: 1 }]));
    } else {
      const distance = (transition.type === 'slide-left' ? 1 : -1) * innerWidth;
      for (const [frame, from, to] of [
        [next, distance, 0],
        [previous, 0, -distance],
      ]) {
        const base = frame.element.style.transform;
        pending.push(
          animate(frame.element, [
            { transform: `translateX(${from}px) ${base}` },
            { transform: `translateX(${to}px) ${base}` },
          ]),
        );
      }
    }
    timer = setTimeout(finish, duration + 250);
    void Promise.all(pending).then(finish, finish);
  } catch {
    // An unavailable animation backend falls back to a complete, synchronous cut.
    finish();
  }
  return { finished, cancel: finish };
}
