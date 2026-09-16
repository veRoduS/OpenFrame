const form = document.getElementById('recovery-form');
const button = document.getElementById('connect');
const error = document.getElementById('error');
const controls = document.getElementById('reconnect-controls');
const duration = document.getElementById('pause-duration');
const pause = document.getElementById('pause-reconnects');
const resume = document.getElementById('resume-reconnects');
const reconnectStatus = document.getElementById('reconnect-status');
const pauseError = document.getElementById('pause-error');
let token, timer, controller;
let generation = 0,
  busy = false,
  finished = false,
  initialized = false;

function disable(value) {
  for (const element of [button, duration, pause, resume])
    element.disabled = value;
}

function render(state) {
  token = state.csrf;
  if (!initialized) {
    if (state.paused)
      duration.value =
        state.pauseSeconds === null ? 'indefinite' : String(state.pauseSeconds);
    initialized = true;
  }
  const seconds = state.remainingSeconds;
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  reconnectStatus.textContent = state.closing
    ? 'Reconnecting...'
    : state.paused
      ? seconds === null
        ? 'Paused indefinitely'
        : `Paused - ${countdown} remaining`
      : `Reconnects in ${countdown}`;
  resume.textContent = state.paused ? 'Resume reconnects' : 'Reconnect now';
  disable(busy || finished || state.closing);
}

async function request(path, body) {
  const current = new AbortController();
  controller = current;
  const timeout = setTimeout(() => current.abort(), 5000);
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      signal: current.signal,
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Setup-Token': token,
            },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } finally {
    clearTimeout(timeout);
    if (controller === current) controller = undefined;
  }
}

async function poll() {
  const current = generation;
  try {
    const state = await request('/setup/state');
    if (current === generation && !finished) render(state);
  } catch {
    if (current === generation && !finished) {
      disable(true);
      reconnectStatus.textContent =
        'Connection unavailable. Rejoin the recovery network.';
    }
  } finally {
    if (current === generation && !finished) timer = setTimeout(poll, 2000);
  }
}

async function action(path, body) {
  if (busy || finished) return;
  busy = true;
  generation += 1;
  clearTimeout(timer);
  controller?.abort();
  disable(true);
  error.textContent = pauseError.textContent = '';
  try {
    const state = await request(path, body);
    if (finished) return;
    if (path === '/setup/pause') {
      busy = false;
      render(state);
    } else {
      finished = true;
      form.reset();
      form.hidden = controls.hidden = true;
      document.getElementById('result').textContent =
        'Connecting to Wi-Fi. The recovery network will disconnect; your saved playlist will keep playing.';
    }
  } catch {
    if (!finished)
      (path === '/setup' ? error : pauseError).textContent =
        'Could not confirm the change. Check the connection and try again.';
  } finally {
    busy = false;
    // Read back authoritative state, including when a response was lost.
    if (!finished) void poll();
  }
}

pause.addEventListener('click', () => {
  void action('/setup/pause', {
    duration: duration.value === 'indefinite' ? null : Number(duration.value),
  });
});
resume.addEventListener('click', () => {
  void action('/setup/resume', {});
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/setup', Object.fromEntries(new FormData(form)));
});
window.addEventListener('pagehide', () => {
  finished = true;
  generation += 1;
  clearTimeout(timer);
  controller?.abort();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
void poll();
