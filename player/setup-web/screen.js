async function update() {
  try {
    const response = await fetch('/setup/state', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const state = await response.json();
    for (const field of ['phase', 'ssid', 'password', 'url', 'code'])
      document.getElementById(field).textContent = state[field] || '';
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
