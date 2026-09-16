async function update() {
  try {
    const response = await fetch('/setup/state', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const state = await response.json();
    for (const field of ['ssid', 'password', 'url', 'code'])
      document.getElementById(field).textContent = state[field] || '';
    document.getElementById('phase').textContent =
      state.phase === 'Wi-Fi setup'
        ? 'Connect your screen'
        : state.phase || 'Starting setup';
    const step =
      state.code || ['Connecting WireGuard', 'Ready'].includes(state.phase)
        ? 2
        : ['Joining Wi-Fi', 'Contacting server'].includes(state.phase)
          ? 1
          : 0;
    document.querySelectorAll('.setup-progress li').forEach((item, index) => {
      if (index === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('complete', index < step);
    });
    document.getElementById('connection').hidden =
      state.phase !== 'Wi-Fi setup';
    document.getElementById('approval').hidden = !state.code;
    document.getElementById('screen-error').textContent = state.error || '';
  } catch {
    document.getElementById('phase').textContent =
      'Connecting to setup service';
  }
  setTimeout(update, 2000);
}
void update();
