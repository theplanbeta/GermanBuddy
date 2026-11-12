// Wires the page together: text box -> splitter -> Reader -> speakers.
import './styles.css';
import { splitText, splitOpening } from './text/splitter.js';
import { createKokoroEngine } from './engine/kokoro-engine.js';
import { Reader } from './reader/reader.js';
import { speedFactor } from './reader/schedule.js';
import { VOICE_GROUPS, ALL_VOICES, DEFAULT_VOICE, voiceLabel, voiceName } from './voices.js';

const $ = (id) => document.getElementById(id);
const ui = {
  engineStatus: $('engine-status'),
  modelCard: $('model-card'),
  modelText: $('model-text'),
  modelProgressWrap: $('model-progress-wrap'),
  modelProgress: $('model-progress'),
  modelButton: $('model-button'),
  message: $('message'),
  text: $('text'),
  wordCount: $('word-count'),
  reading: $('reading'),
  editButton: $('edit-button'),
  clearButton: $('clear-button'),
  bar: $('progress-bar'),
  barReady: $('bar-ready'),
  barPlayed: $('bar-played'),
  positionText: $('position-text'),
  preparedText: $('prepared-text'),
  prev: $('prev-button'),
  play: $('play-button'),
  next: $('next-button'),
  stop: $('stop-button'),
  more: $('more-button'),
  moreText: $('more-text'),
  settingsRow: $('settings'),
  tempo: $('tempo'),
  tempoValue: $('tempo-value'),
  voice: $('voice'),
  download: $('download-button'),
  downloadText: $('download-text'),
  mode: $('mode'),
};

// ---- remembered settings (quietly ignored if the browser blocks storage) ---

const settings = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`listen.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`listen.${key}`, String(value));
    } catch {
      /* private mode etc. */
    }
  },
};

// ---- messages -------------------------------------------------------------

function showMessage(text, { action, onAction, info = false } = {}) {
  ui.message.replaceChildren(text);
  ui.message.classList.toggle('info', info);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = action;
    button.addEventListener('click', onAction);
    ui.message.append(' ', button);
  }
  ui.message.hidden = false;
}

function hideMessage() {
  ui.message.hidden = true;
}

// ---- browser support ------------------------------------------------------

const supported = typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof Audio !== 'undefined';
if (!supported) {
  ui.engineStatus.textContent = 'This browser is not supported';
  showMessage('Sorry, this browser can’t run Listen. Please open it in a recent version of Chrome, Edge, Firefox or Safari.');
  for (const b of [ui.play, ui.prev, ui.next, ui.stop]) b.disabled = true;
  throw new Error('Unsupported browser');
}

const MODES = ['auto', 'webgpu', 'wasm'];
const savedMode = settings.get('mode', 'auto');
const engine = createKokoroEngine({ mode: MODES.includes(savedMode) ? savedMode : 'auto' });
const reader = new Reader(engine);
if (new URLSearchParams(location.search).has('debug')) window.listen = { reader, engine };

// ---- voice model: one-time download ----------------------------------------

let plan = null; // { device, dtype, cached, webgpu }
let modelStarted = false;
let modelRun = 0; // ignores answers from an engine that has since been restarted
const SIZE_MB = { uint8: 177, fp32: 326 }; // model download size per engine mode

function modeName(device) {
  return device === 'webgpu' ? 'Graphics mode (WebGPU)' : 'Standard mode (WebAssembly)';
}

/** "Graphics mode (WebGPU) · preparing 1.4× faster than playback" */
function updateStatus() {
  const device = engine.device ?? plan?.device;
  if (!device) return;
  let text = `Voice runs on this device · ${modeName(device)}`;
  const ratio = engine.device ? reader.prepRatio : null;
  if (ratio !== null) {
    const r = ratio.toFixed(1);
    if (ratio >= 1.05) text = `${modeName(device)} · preparing ${r}× faster than playback`;
    else if (ratio > 0.95) text = `${modeName(device)} · preparing about as fast as playback`;
    else text = `${modeName(device)} · preparing ${r}× (slower than playback)`;
  }
  ui.engineStatus.textContent = text;
}

async function checkModel({ notice, switching = false } = {}) {
  const run = modelRun;
  try {
    plan = await engine.probe();
  } catch {
    plan = { device: 'wasm', dtype: 'uint8', cached: false, webgpu: false };
  }
  if (run !== modelRun) return;
  // Only offer the graphics chip where this browser has one.
  ui.mode.querySelector('[value="webgpu"]').hidden = !plan.webgpu;
  ui.mode.querySelector('[value="webgpu"]').disabled = !plan.webgpu;
  if (!plan.webgpu && ui.mode.value === 'webgpu') ui.mode.value = 'auto';
  updateStatus();
  if (plan.cached) {
    startModel();
  } else {
    const size = SIZE_MB[plan.dtype];
    ui.modelText.textContent = switching
      ? `${modeName(plan.device)} needs its own one-time download of about ${size} MB. The other mode stays saved on this device.`
      : `Listen reads aloud with a voice model that runs on your own device. It needs a one-time download of about ${size} MB, then it works instantly.`;
    if (typeof caches === 'undefined') {
      ui.modelText.textContent += ' Note: this page isn’t on a secure (https) address, so the download can’t be saved and will be needed again next time.';
    }
    ui.modelProgressWrap.hidden = true;
    ui.modelButton.hidden = false;
    ui.modelCard.hidden = false;
  }
  if (notice) showMessage(notice, { info: true });
}

function startModel() {
  if (modelStarted) return;
  modelStarted = true;
  const run = modelRun;
  hideMessage();
  const cached = plan?.cached;
  ui.modelButton.hidden = true;
  ui.modelProgressWrap.hidden = false;
  ui.modelCard.hidden = false;
  ui.modelText.textContent = cached ? 'Getting the voice ready…' : 'Downloading voice model, one time only: 0%';
  engine
    .load((loaded, total) => {
      const pct = Math.floor((loaded / total) * 100);
      ui.modelProgress.value = pct;
      if (!cached) {
        const mb = (n) => Math.round(n / 1e6);
        ui.modelText.textContent = `Downloading voice model, one time only: ${pct}% (${mb(loaded)} of ${mb(total)} MB)`;
      }
    })
    .then(() => {
      if (run !== modelRun) return;
      ui.modelCard.hidden = true;
      updateStatus();
    })
    .catch((error) => {
      if (run !== modelRun || error.phase === 'cancelled') return;
      showModelError(error);
    });
}

/** The engine was restarted in another mode: start over with probe / load. */
function restartModel(options) {
  modelRun++;
  modelStarted = false;
  reader.stats.length = 0; // speed readings from the other mode no longer apply
  ui.modelCard.hidden = true;
  ui.engineStatus.textContent = 'Starting the voice…';
  checkModel(options);
}

function showModelError(error) {
  modelStarted = false;
  ui.modelCard.hidden = true;
  const offline = navigator.onLine === false || /fetch|network|load failed/i.test(error?.message ?? '');
  const text = offline
    ? 'Couldn’t download the voice model. Please check your internet connection and try again. (It only needs to download once.)'
    : `The voice model couldn’t start in this browser (${error?.message ?? 'unknown error'}). A recent version of Chrome, Edge, Firefox or Safari should work.`;
  showMessage(text, {
    action: 'Try again',
    onAction: () => {
      startModel();
      reader.retry();
    },
  });
}

ui.modelButton.addEventListener('click', startModel);

ui.mode.value = engine.mode;
ui.mode.addEventListener('change', () => {
  settings.set('mode', ui.mode.value);
  engine.setMode(ui.mode.value);
  restartModel({ switching: true });
});

engine.onFallback = (reason) => {
  settings.set('mode', 'wasm');
  ui.mode.value = 'wasm';
  const what = reason === 'start' ? 'couldn’t start' : 'produced faulty audio';
  restartModel({
    switching: true,
    notice: `Graphics mode ${what} on this device, so Listen switched to standard mode. You can try graphics mode again under Settings.`,
  });
};

// ---- text box and reading view ---------------------------------------------

let loadedText = null; // the text the reader currently holds

function updateWordCount() {
  const words = ui.text.value.trim().split(/\s+/).filter(Boolean).length;
  ui.wordCount.textContent = words ? `${words.toLocaleString()} word${words === 1 ? '' : 's'}` : '';
}

function showReading() {
  const text = ui.text.value;
  if (text !== loadedText) {
    // A long first sentence is split so the voice can start sooner.
    const sentences = splitOpening(splitText(text));
    if (!sentences.length) return false;
    renderReading(sentences);
    reader.load(sentences);
    loadedText = text;
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: sentences[0].text.slice(0, 80), artist: 'Listen' });
    }
  }
  ui.text.hidden = true;
  ui.reading.hidden = false;
  ui.editButton.hidden = false;
  return true;
}

function renderReading(sentences) {
  const fragment = document.createDocumentFragment();
  let paragraph = null;
  sentences.forEach((s, i) => {
    if (!paragraph || sentences[i - 1].para !== s.para) {
      paragraph = document.createElement('p');
      fragment.append(paragraph);
    }
    const span = document.createElement('span');
    span.className = 'sentence';
    span.dataset.index = i;
    span.textContent = s.text;
    paragraph.append(span, ' ');
  });
  ui.reading.replaceChildren(fragment);
}

function showEditor() {
  reader.pause();
  ui.reading.hidden = true;
  ui.text.hidden = false;
  ui.editButton.hidden = true;
  ui.text.focus();
}

ui.text.addEventListener('input', updateWordCount);
ui.editButton.addEventListener('click', showEditor);
ui.clearButton.addEventListener('click', () => {
  reader.load([]);
  loadedText = null;
  ui.text.value = '';
  updateWordCount();
  ui.reading.replaceChildren();
  showEditor();
  updateProgress();
});
ui.reading.addEventListener('click', (event) => {
  const span = event.target.closest('.sentence');
  if (span) reader.jumpTo(Number(span.dataset.index), { play: true });
});

// ---- transport -------------------------------------------------------------

function play() {
  if (!reader.sentences.length || ui.reading.hidden) {
    if (!ui.text.value.trim()) {
      showMessage('Paste or type some text first, then press Play.');
      ui.text.focus();
      return;
    }
    if (!showReading()) {
      showMessage('There are no words to read in that text.');
      return;
    }
  }
  hideMessage();
  startModel();
  reader.play();
}

ui.play.addEventListener('click', () => (reader.state === 'playing' || reader.state === 'waiting' ? reader.pause() : play()));
ui.prev.addEventListener('click', () => reader.previous());
ui.next.addEventListener('click', () => reader.next());
ui.stop.addEventListener('click', () => reader.stop());

document.addEventListener('keydown', (event) => {
  const tag = event.target.tagName;
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(tag) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === ' ' && tag !== 'BUTTON' && tag !== 'SUMMARY') {
    event.preventDefault();
    ui.play.click();
  } else if (event.key === 'ArrowLeft') reader.previous();
  else if (event.key === 'ArrowRight') reader.next();
});

if (navigator.mediaSession) {
  const handlers = { play, pause: () => reader.pause(), previoustrack: () => reader.previous(), nexttrack: () => reader.next(), stop: () => reader.stop() };
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* action not supported */
    }
  }
}

// ---- tempo and voice -------------------------------------------------------

function updateMoreText() {
  ui.moreText.textContent = `${voiceName(ui.voice.value)} · ${reader.tempo.toFixed(2)}×`;
}

function setTempo(value) {
  const tempo = Math.min(2.5, Math.max(0.5, Number(value) || 1));
  ui.tempo.value = tempo;
  ui.tempoValue.textContent = `${tempo.toFixed(2)}×`;
  reader.setTempo(tempo);
  settings.set('tempo', tempo);
  updateMoreText();
}
ui.tempo.addEventListener('input', () => setTempo(ui.tempo.value));

for (const group of VOICE_GROUPS) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = group.label;
  for (const id of group.voices) optgroup.append(new Option(voiceLabel(id), id));
  ui.voice.append(optgroup);
}
ui.voice.addEventListener('change', () => {
  reader.setVoice(ui.voice.value); // cheap: nothing is thrown away or re-drawn
  settings.set('voice', ui.voice.value);
  updateMoreText();
});

// Phones: the voice and tempo row folds away to keep the player small.
ui.more.addEventListener('click', () => {
  const open = ui.more.getAttribute('aria-expanded') !== 'true';
  ui.more.setAttribute('aria-expanded', String(open));
  ui.settingsRow.classList.toggle('open', open);
});

const savedVoice = settings.get('voice', DEFAULT_VOICE);
ui.voice.value = ALL_VOICES.includes(savedVoice) ? savedVoice : DEFAULT_VOICE;
reader.setVoice(ui.voice.value);
setTempo(settings.get('tempo', 1));

// ---- download --------------------------------------------------------------

/** "" at normal speed, otherwise e.g. "1.6" (the file is made at the speed it was prepared at). */
function fileSpeed() {
  return reader.speed === 1 ? '' : speedFactor(reader.speed).toFixed(1);
}

ui.download.addEventListener('click', () => {
  const wav = reader.toWav();
  if (!wav) return;
  const name = (loadedText ?? '').trim().split(/\s+/).slice(0, 5).join(' ').replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'reading';
  const speed = fileSpeed() ? ` (${fileSpeed()}x speed)` : '';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(wav);
  link.download = `Listen - ${name}${speed}.wav`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
});

// ---- keeping the screen in sync --------------------------------------------

let highlighted = null;

function updateHighlight() {
  highlighted?.classList.remove('current');
  highlighted?.removeAttribute('aria-current');
  highlighted = ui.reading.querySelector(`[data-index="${reader.current}"]`);
  if (!highlighted || reader.state === 'idle') return;
  highlighted.classList.add('current');
  highlighted.setAttribute('aria-current', 'true');
  const box = highlighted.getBoundingClientRect();
  const playerTop = document.querySelector('.player').getBoundingClientRect().top;
  if (box.top < 0 || box.bottom > playerTop) {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    highlighted.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }
}

function updateProgress() {
  const n = reader.sentences.length;
  const ready = reader.readyCount;
  const playedPct = reader.position * 100;
  ui.barPlayed.style.width = `${playedPct}%`;
  ui.barReady.style.width = `${n ? (ready / n) * 100 : 0}%`;
  ui.bar.setAttribute('aria-valuenow', Math.round(playedPct));
  if (!n) {
    ui.positionText.textContent = 'Nothing to read yet';
    ui.preparedText.textContent = '';
  } else {
    let note = '';
    if (reader.state === 'waiting') note = ' · preparing…';
    else if (reader.switching) note = ` · switching to ${voiceName(reader.voice)}…`;
    ui.positionText.textContent = `Sentence ${reader.current + 1} of ${n}${note}`;
    ui.preparedText.textContent = reader.complete ? 'All prepared' : `Prepared ${ready} of ${n}`;
  }
  const complete = reader.complete;
  ui.download.disabled = !complete;
  if (!n) ui.downloadText.textContent = '';
  else if (!complete) ui.downloadText.textContent = `Preparing file: ${Math.floor((ready / n) * 100)}%`;
  else ui.downloadText.textContent = fileSpeed() ? `File plays at about ${fileSpeed()}× speed` : '';
}

function updateState() {
  const active = reader.state === 'playing' || reader.state === 'waiting';
  ui.play.classList.toggle('is-playing', active);
  ui.play.setAttribute('aria-label', active ? 'Pause' : 'Play');
  if (navigator.mediaSession) navigator.mediaSession.playbackState = active ? 'playing' : 'paused';
  updateHighlight();
  updateProgress();
}

reader.addEventListener('state', updateState);
reader.addEventListener('sentence', () => {
  updateHighlight();
  updateProgress();
});
reader.addEventListener('generated', () => {
  updateProgress();
  updateStatus();
});
reader.addEventListener('time', updateProgress);
reader.addEventListener('slow', () => {
  showMessage('This device prepares audio more slowly than it plays. Pause for a moment to let it get ahead, or lower the tempo.', { info: true });
});
reader.addEventListener('error', ({ detail }) => {
  if (detail.fatal) showModelError(detail.error);
  else showMessage('A sentence couldn’t be read and was skipped.');
});

updateWordCount();
updateState();
checkModel();
