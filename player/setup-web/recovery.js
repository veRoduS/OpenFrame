const form = document.getElementById('recovery-form');
const button = document.getElementById('connect');
const error = document.getElementById('error');
let token;
fetch('/setup/state', { cache: 'no-store' })
  .then((r) => {
    if (!r.ok) throw new Error();
    return r.json();
  })
  .then((s) => {
    token = s.csrf;
    button.disabled = false;
  })
  .catch(() => {
    error.textContent =
      'Recovery window ended. Rejoin the hidden network when it returns.';
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
    if (!response.ok) throw new Error();
    form.reset();
    form.hidden = true;
    document.getElementById('result').textContent =
      'Connecting to Wi-Fi. The recovery network will disconnect; your saved playlist will keep playing.';
  } catch {
    error.textContent =
      'Could not submit. Check the details or rejoin the next recovery window.';
    button.disabled = false;
  }
});
