const form = document.querySelector('#setup');
const button = form.querySelector('button');
const error = document.querySelector('#error');
const statusOutput = document.querySelector('#status');
let token;
fetch('/setup/state', { cache: 'no-store' })
  .then((r) => {
    if (!r.ok) throw new Error();
    return r.json();
  })
  .then((state) => {
    token = state.csrf;
    button.disabled = state.busy;
    error.textContent = state.error || '';
  })
  .catch(() => {
    error.textContent =
      'Setup unavailable. Reconnect to the setup network and reload.';
  });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Token': token },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Setup request failed');
    form.hidden = true;
    form.reset();
    statusOutput.textContent =
      'Connecting to Wi-Fi. The setup hotspot will disconnect; progress and the approval code appear on the screen.';
  } catch (e) {
    error.textContent = e.message;
    button.disabled = false;
  }
});
