import { recoveryIcons } from './recovery-icons.js';

const form = document.getElementById('recovery-form');
const button = document.getElementById('connect');
const error = document.getElementById('error');
const controls = document.getElementById('reconnect-controls');
const duration = document.getElementById('pause-duration');
const pause = document.getElementById('pause-reconnects');
const resume = document.getElementById('resume-reconnects');
const reconnectStatus = document.getElementById('reconnect-status');
const pauseError = document.getElementById('pause-error');
const list = document.getElementById('networks');
const add = document.getElementById('add-network');
const reload = document.getElementById('reload-networks');
const result = document.getElementById('result');
let drag;
let networks = [],
  revision,
  loaded = false,
  dirty = false,
  closing = true;
let token, timer, controller;
let generation = 0,
  busy = false,
  finished = false,
  initialized = false;

function disable(value) {
  if (value) finishDrag(false);
  for (const element of [duration, pause, resume]) element.disabled = value;
  button.disabled = value || !loaded || !dirty || !networks.length;
  add.disabled = value || !loaded || networks.length >= 20;
  reload.disabled = busy || finished;
  list.inert = value;
  form.elements.country.disabled = value || !loaded;
}

function moveNetwork(from, to) {
  if (from === to) return;
  const [network] = networks.splice(from, 1);
  networks.splice(to, 0, network);
  changed();
  renderNetworks();
  list.children[to].querySelector('.network-grip').focus();
  document.getElementById('reorder-status').textContent =
    `${network.ssid || 'Network'} is now priority ${to + 1}.`;
}

function finishDrag(commit) {
  if (!drag) return;
  const active = drag;
  drag = undefined;
  cancelAnimationFrame(active.frame);
  if (active.handle.hasPointerCapture(active.pointer))
    active.handle.releasePointerCapture(active.pointer);
  active.row.classList.remove('dragging');
  active.row.style.transform = '';
  for (const row of list.children) row.removeAttribute('data-drop');
  if (commit && active.moved) moveNetwork(active.from, active.to);
}

function positionDrag() {
  if (!drag) return;
  const { row, from, y, origin, scroll } = drag;
  if (drag.moved) {
    const edge = 64;
    const delta = y < edge ? -10 : y > innerHeight - edge ? 10 : 0;
    if (delta) window.scrollBy(0, delta);
    row.style.transform = `translateY(${y - origin + window.scrollY - scroll}px)`;
    const others = [...list.children].filter((item) => item !== row);
    let to = others.findIndex((item) => {
      const bounds = item.getBoundingClientRect();
      return y < bounds.top + bounds.height / 2;
    });
    if (to < 0) to = others.length;
    drag.to = to;
    for (const item of list.children) item.removeAttribute('data-drop');
    if (to !== from) {
      const target = others[to] || others.at(-1);
      target?.setAttribute('data-drop', others[to] ? 'before' : 'after');
    }
  }
}

function dragStep() {
  if (!drag) return;
  positionDrag();
  drag.frame = requestAnimationFrame(dragStep);
}

function attachDrag(handle, row, index) {
  handle.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      busy ||
      finished ||
      closing ||
      list.inert
    )
      return;
    event.preventDefault();
    handle.focus();
    finishDrag(false);
    drag = {
      handle,
      row,
      from: index,
      to: index,
      pointer: event.pointerId,
      origin: event.clientY,
      y: event.clientY,
      scroll: window.scrollY,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
    drag.frame = requestAnimationFrame(dragStep);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.y = event.clientY;
    if (Math.abs(drag.y - drag.origin) > 5) {
      drag.moved = true;
      row.classList.add('dragging');
    }
  });
  handle.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.y = event.clientY;
    positionDrag();
    finishDrag(true);
  });
  handle.addEventListener('pointercancel', () => finishDrag(false));
  handle.addEventListener('lostpointercapture', () => finishDrag(false));
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishDrag(false);
      return;
    }
    if (drag || busy || closing) return;
    const target = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 0,
      End: networks.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveNetwork(index, Math.max(0, Math.min(networks.length - 1, target)));
  });
}

function changed() {
  dirty = true;
  result.textContent = '';
  disable(busy || finished || closing);
}

function iconButton(name, title, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'network-icon secondary';
  element.title = title;
  element.setAttribute('aria-label', title);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    width: '20',
    height: '20',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(key, value);
  for (const [tag, attributes] of recoveryIcons[name]) {
    const child = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes))
      child.setAttribute(key, value);
    svg.append(child);
  }
  element.append(svg);
  element.addEventListener('click', action);
  return element;
}

function renderNetworks() {
  finishDrag(false);
  list.replaceChildren();
  document.getElementById('network-count').textContent =
    `${networks.length} / 20`;
  networks.forEach((network, index) => {
    const row = document.createElement('li');
    const details = document.createElement('details');
    details.open = network.expanded || false;
    details.addEventListener('toggle', () => {
      network.expanded = details.open;
    });
    const summary = document.createElement('summary');
    const title = document.createElement('strong');
    title.textContent = network.ssid || 'New network';
    const rank = document.createElement('span');
    rank.className = 'network-priority';
    rank.textContent = index === 0 ? '1 - Preferred' : `${index + 1} - Backup`;
    summary.append(title, rank);
    details.append(summary);
    const fields = document.createElement('div');
    fields.className = 'network-fields';
    const field = (caption, control) => {
      const label = document.createElement('label');
      label.append(document.createTextNode(caption), control);
      fields.append(label);
    };
    const ssid = document.createElement('input');
    ssid.value = network.ssid;
    ssid.required = true;
    ssid.maxLength = 32;
    ssid.autocomplete = 'off';
    ssid.addEventListener('input', () => {
      network.ssid = ssid.value;
      title.textContent = ssid.value || 'New network';
      changed();
    });
    field('Wi-Fi network (SSID)', ssid);
    const security = document.createElement('select');
    for (const [value, label] of [
      ['wpa-psk', 'WPA / WPA2 Personal'],
      ['sae', 'WPA3 Personal'],
      ['open', 'Open network'],
    ]) {
      security.add(new Option(label, value));
    }
    security.value = network.security;
    field('Security', security);
    const password = document.createElement('input');
    password.type = 'password';
    password.autocomplete = 'new-password';
    password.maxLength = 64;
    password.value = network.password || '';
    password.placeholder = network.hasPassword ? 'Unchanged' : '';
    const passwordState = () => {
      password.disabled = network.security === 'open';
      password.required =
        network.security !== 'open' &&
        !(network.hasPassword && network.security === network.savedSecurity);
    };
    passwordState();
    password.addEventListener('input', () => {
      network.password = password.value || undefined;
      changed();
    });
    field(
      network.hasPassword ? 'Replacement password' : 'Wi-Fi password',
      password,
    );
    security.addEventListener('change', () => {
      network.security = security.value;
      passwordState();
      changed();
    });
    const hidden = document.createElement('input');
    hidden.type = 'checkbox';
    hidden.checked = network.hidden;
    hidden.addEventListener('change', () => {
      network.hidden = hidden.checked;
      changed();
    });
    field('Hidden network', hidden);
    fields.lastElementChild.className = 'network-check';
    details.append(fields);
    const grip = iconButton(
      'grip-vertical',
      `Reorder network ${index + 1}`,
      () => {},
    );
    grip.className = 'network-icon network-grip';
    grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Home End');
    attachDrag(grip, row, index);
    const remove = iconButton('trash-2', `Remove network ${index + 1}`, () => {
      if (
        network.id &&
        !confirm(
          `Remove ${network.ssid} from this player's saved Wi-Fi networks?`,
        )
      )
        return;
      networks.splice(index, 1);
      changed();
      renderNetworks();
    });
    remove.classList.add('network-remove');
    row.append(grip, details, remove);
    list.append(row);
  });
}

function acceptNetworks(state) {
  revision = state.revision;
  networks = state.networks.map((network) => ({
    ...network,
    savedSecurity: network.security,
  }));
  form.elements.country.value = state.country;
  loaded = true;
  dirty = false;
  renderNetworks();
}

function render(state) {
  token = state.csrf;
  closing = state.closing;
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
  const timeout = setTimeout(
    () => current.abort(),
    path === '/setup/networks' ? 30000 : 5000,
  );
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
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error ||
          'Could not confirm the change. Check the connection and try again.',
      );
    return data;
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
    } else if (path === '/setup/networks') {
      acceptNetworks(state);
      result.textContent = body ? 'Networks saved.' : '';
    } else {
      finished = true;
      form.reset();
      form.hidden = controls.hidden = true;
      networks = [];
      list.replaceChildren();
      dirty = false;
      document.getElementById('result').textContent =
        'Connecting to Wi-Fi. The recovery network will disconnect; your saved playlist will keep playing.';
    }
  } catch (failure) {
    if (!finished)
      (path === '/setup/networks' ? error : pauseError).textContent =
        failure.message ||
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
  if (dirty && !confirm('Discard unsaved network changes and reconnect?'))
    return;
  void action('/setup/resume', {});
});
add.addEventListener('click', () => {
  if (networks.length >= 20) return;
  networks.push({
    id: null,
    ssid: '',
    security: 'wpa-psk',
    hidden: false,
    expanded: true,
  });
  changed();
  renderNetworks();
  list.lastElementChild.querySelector('input').focus();
});
reload.addEventListener('click', () => {
  if (dirty && !confirm('Discard unsaved network changes and reload?')) return;
  void action('/setup/networks');
});
form.elements.country.addEventListener('input', changed);
form.addEventListener(
  'invalid',
  (event) => {
    event.target.closest('details')?.setAttribute('open', '');
  },
  true,
);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/setup/networks', {
    revision,
    country: form.elements.country.value,
    networks: networks.map(({ id, ssid, security, hidden, password }) => ({
      id,
      ssid,
      security,
      hidden,
      ...(password && security !== 'open' ? { password } : {}),
    })),
  });
});
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
});
window.addEventListener('pagehide', () => {
  finishDrag(false);
  finished = true;
  generation += 1;
  clearTimeout(timer);
  controller?.abort();
});
window.addEventListener('blur', () => finishDrag(false));
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
void action('/setup/networks');
