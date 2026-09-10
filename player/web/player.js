import { Playback } from './playback.js';
import { prepareFrame, commitFrame } from './frame.js';

const stage = document.getElementById('stage'),
  message = document.getElementById('message');
const heading = document.getElementById('heading'),
  detail = document.getElementById('detail');
const preview = new URLSearchParams(location.search).get('preview');
let lastState = null,
  lastStatus = null,
  blank = false,
  resizeGeneration = 0,
  resizeTimer;
function showMessage(title, text = '') {
  heading.textContent = title;
  detail.textContent = text;
  message.hidden = false;
}
const playback = new Playback({
  prepare: (item, assets, rotation, signal) =>
    prepareFrame(stage, item, assets, rotation, signal),
  commit: commitFrame,
  report(status) {
    lastStatus = status;
    if (
      blank ||
      status.phase === 'playing' ||
      status.slideId ||
      (status.phase === 'empty' && lastState?.manifest?.items?.length)
    )
      message.hidden = true;
    else if (status.phase === 'empty')
      showMessage(
        'Ready for a playlist',
        'Assign a published playlist from your OpenFrame server.',
      );
    else if (status.phase === 'preparing')
      showMessage('Preparing your display');
    else if (status.phase === 'waiting')
      showMessage('Waiting for content', status.error);
  },
});
function applyState(state) {
  lastState = state;
  if (!state.approved) {
    blank = false;
    stage.hidden = false;
    playback.stop('unpaired');
    showMessage(
      state.code || 'Connect your player',
      state.code
        ? 'Approve this code in OpenFrame > Screens.'
        : state.error ||
            'Set the server address in openframe.json on the SD card.',
    );
    return;
  }
  blank = !!state.blank;
  stage.hidden = blank;
  if (blank) {
    playback.stop('blank');
    message.hidden = true;
    return;
  }
  if (state.manifest)
    playback.update(
      state.manifest,
      state.rotation || 0,
      `${state.generation || 0}:${resizeGeneration}`,
    );
}
async function poll() {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(
      preview ? `/api/preview/${encodeURIComponent(preview)}` : '/local/state',
      { cache: 'no-store', signal: abort.signal },
    );
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? 'Sign in to preview this playlist.'
          : 'Waiting for player service.',
      );
    const data = await response.json();
    applyState(
      preview
        ? { approved: true, manifest: data, rotation: 0, blank: false }
        : data,
    );
  } catch (error) {
    if (!playback.current && !blank && !lastState?.manifest)
      showMessage('Waiting for connection', error.message);
  } finally {
    clearTimeout(timeout);
    if (!preview || !lastState) setTimeout(poll, 3000);
  }
}
async function reportPlayback() {
  if (preview || !lastStatus) return;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 4000);
  try {
    await fetch('/local/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastStatus),
      signal: abort.signal,
    });
  } catch {
    /* Playback continues while the agent restarts. */
  } finally {
    clearTimeout(timeout);
  }
}
const telemetry = setInterval(() => {
  void reportPlayback();
}, 5000);
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeGeneration++;
    if (lastState) applyState(lastState);
  }, 150);
});
addEventListener('pagehide', () => {
  clearInterval(telemetry);
  playback.stop();
});
void poll();
