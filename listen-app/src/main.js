// Wires the page together: text box -> splitter -> Reader -> speakers.
import './styles.css';
import { splitText } from './text/splitter.js';
import { createKokoroEngine } from './engine/kokoro-engine.js';
import { Reader } from './reader/reader.js';
import { VOICE_GROUPS, ALL_VOICES, DEFAULT_VOICE, voiceLabel } from './voices.js';

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
  tempo: $('tempo'),
  tempoValue: $('tempo-value'),
  voice: $('voice'),
  download: $('download-button'),
  downloadText: $('download-text'),
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

function showMessage(text, { action, onAction } = {}) {
  ui.message.replaceChildren(text);
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

const engine = createKokoroEngine();
const reader = new Reader(engine);
if (new URLSearchParams(location.search).has('debug')) window.listen = { reader, engine };

// ---- voice model: one-time download ----------------------------------------

let plan = null; // { device, dtype, cached }
let modelStarted = false;
const SIZE_MB = { uint8: 177, fp32: 326 }; // model download size per engine mode

function modeName(device) {
  return device === 'webgpu' ? 'fast mode (WebGPU)' : 'standard mode (WebAssembly)';
}

async function checkModel() {
  try {
    plan = await engine.probe();
  } catch {
    plan = { device: 'wasm', dtype: 'uint8', cached: false };
  }
  ui.engineStatus.textContent = `Voice runs on this device · ${modeName(plan.device)}`;
  if (plan.cached) return startModel();
  ui.modelText.textContent = `Listen reads aloud with a voice model that runs on your own device. It needs a one-time download of about ${SIZE_MB[plan.dtype]} MB, then it works instantly.`;
  if (typeof caches === 'undefined') {
    ui.modelText.textContent += ' Note: this page isn’t on a secure (https) address, so the download can’t be saved and will be needed again next time.';
  }
  ui.modelButton.hidden = false;
  ui.modelCard.hidden = false;
}

function startModel() {
  if (modelStarted) return;
  modelStarted = true;
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
    .then(({ device }) => {
      ui.modelCard.hidden = true;
      ui.engineStatus.textContent = `Voice runs on this device · ${modeName(device)}`;
    })
    .catch(showModelError);
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

// ---- text box and reading view ---------------------------------------------

let loadedText = null; // the text the reader currently holds

function updateWordCount() {
  const words = ui.text.value.trim().split(/\s+/).filter(Boolean).length;
  ui.wordCount.textContent = words ? `${words.toLocaleString()} word${words === 1 ? '' : 's'}` : '';
}

function showReading() {
  const text = ui.text.value;
  if (text !== loadedText) {
    const sentences = splitText(text);
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
  if (event.key === ' ' && tag !== 'BUTTON') {
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

function setTempo(value) {
  const tempo = Math.min(2.5, Math.max(0.5, Number(value) || 1));
  ui.tempo.value = tempo;
  ui.tempoValue.textContent = `${tempo.toFixed(2)}×`;
  reader.setTempo(tempo);
  settings.set('tempo', tempo);
}
ui.tempo.addEventListener('input', () => setTempo(ui.tempo.value));

for (const group of VOICE_GROUPS) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = group.label;
  for (const id of group.voices) optgroup.append(new Option(voiceLabel(id), id));
  ui.voice.append(optgroup);
}
ui.voice.addEventListener('change', () => {
  reader.setVoice(ui.voice.value);
  settings.set('voice', ui.voice.value);
});

const savedVoice = settings.get('voice', DEFAULT_VOICE);
ui.voice.value = ALL_VOICES.includes(savedVoice) ? savedVoice : DEFAULT_VOICE;
reader.setVoice(ui.voice.value);
setTempo(settings.get('tempo', 1));

// ---- download --------------------------------------------------------------

ui.download.addEventListener('click', () => {
  const wav = reader.toWav();
  if (!wav) return;
  const name = (loadedText ?? '').trim().split(/\s+/).slice(0, 5).join(' ').replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'reading';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(wav);
  link.download = `Listen - ${name}.wav`;
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
  const playedPct = reader.position * 100;
  ui.barPlayed.style.width = `${playedPct}%`;
  ui.barReady.style.width = `${n ? (reader.readyCount / n) * 100 : 0}%`;
  ui.bar.setAttribute('aria-valuenow', Math.round(playedPct));
  if (!n) {
    ui.positionText.textContent = 'Nothing to read yet';
    ui.preparedText.textContent = '';
  } else {
    const waiting = reader.state === 'waiting' ? ' · preparing…' : '';
    ui.positionText.textContent = `Sentence ${reader.current + 1} of ${n}${waiting}`;
    ui.preparedText.textContent = reader.complete ? 'All prepared' : `Prepared ${reader.readyCount} of ${n}`;
  }
  ui.download.disabled = !reader.complete;
  ui.downloadText.textContent = !n || reader.complete ? '' : `Preparing file: ${Math.floor((reader.readyCount / n) * 100)}%`;
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
reader.addEventListener('generated', updateProgress);
reader.addEventListener('time', updateProgress);
reader.addEventListener('error', ({ detail }) => {
  if (detail.fatal) showModelError(detail.error);
  else showMessage('A sentence couldn’t be read and was skipped.');
});

updateWordCount();
updateState();
checkModel();
