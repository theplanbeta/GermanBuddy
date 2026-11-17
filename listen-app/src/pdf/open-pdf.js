// "Open PDF": reads a PDF in a background thread (pdf.worker.js) and hands
// its text to the text box. The PDF never leaves this device.
//
// The page loads this file only when someone opens a PDF (see main.js), so a
// normal visit downloads none of it, nor the 5 MB PDF reader.
//
// The text box is filled once the whole PDF has been read, not page by page:
// each change of the text box restarts the reader, and the listener may be
// asked whether to replace what is already there.
import { looksLikePdf, sizeWarning, REFUSALS, resultMessage, progressText } from './messages.js';

const PROGRESS_EVERY_MS = 400; // fewer updates, so screen readers are not flooded

let current = null; // the reading in progress, or the question waiting for an answer

/** Stops the reading in progress (if any) and forgets any pending question. */
function cancelPdf() {
  if (!current) return false;
  current.worker?.terminate(); // ends the thread and frees its memory at once
  current = null;
  return true;
}

/** The Cancel button next to "Reading PDF: page N of M". */
export function stopPdf(deps) {
  cancelPdf();
  hideStatus(deps);
  deps.showMessage('Stopped reading the PDF. The text box was not changed.', { info: true });
}

/** Another source (a link) is starting: stop the PDF without a word, as only one source works at a time. */
export function stopPdfQuietly(deps) {
  if (cancelPdf()) hideStatus(deps);
}

/**
 * Reads `file` and puts its text into the text box.
 * deps: elements { status, statusText, focusAfter } and the page's
 *       showMessage(text, options), hideMessage(), hasText(), putText(text),
 *       askToReplace(what, { onReplace, onKeep }) (the question shared with "Read a link")
 */
export async function openPdf(file, deps) {
  cancelPdf(); // a second PDF replaces the first
  const run = (current = { worker: null });
  try {
    await read(file, deps, run);
  } catch (error) {
    // E.g. the file could not be read from the device, or no thread could be started.
    console.warn('PDF could not be opened:', error);
    if (current !== run) return;
    cancelPdf();
    hideStatus(deps);
    deps.showMessage(REFUSALS.failed);
  }
}

async function read(file, deps, run) {
  const { showMessage, hideMessage } = deps;
  const stillCurrent = () => current === run;
  hideMessage();

  // The first bytes decide, not the name: phones often hand over files without one.
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!stillCurrent()) return;
  if (!looksLikePdf(head)) {
    current = null;
    showMessage(REFUSALS['not-pdf']);
    return;
  }
  const warning = sizeWarning(file.size);
  if (warning) showMessage(warning, { info: true });

  showStatus(deps, progressText(0, 0));
  const bytes = await file.arrayBuffer();
  if (!stillCurrent()) return;

  const worker = new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' });
  run.worker = worker;
  let shownAt = 0;
  const finish = () => {
    worker.terminate();
    hideStatus(deps);
  };
  worker.onmessage = ({ data }) => {
    if (!stillCurrent()) return;
    if (data.type === 'open') deps.statusText.textContent = progressText(0, data.pages);
    else if (data.type === 'page') {
      const now = performance.now();
      if (now - shownAt >= PROGRESS_EVERY_MS) {
        shownAt = now;
        deps.statusText.textContent = progressText(data.parsed, data.pages);
      }
    } else if (data.type === 'error') {
      finish();
      current = null;
      showMessage(REFUSALS[data.kind] ?? REFUSALS.unreadable);
    } else if (data.type === 'done') {
      finish();
      run.worker = null;
      const result = resultMessage({ hasText: Boolean(data.text.trim()), scanned: data.scanned, order: data.order });
      if (!result.ok) {
        current = null;
        showMessage(result.text);
      } else if (deps.hasText()) {
        // The text box already holds text: ask first.
        deps.askToReplace(`the text of ${file.name ? `“${file.name}”` : 'the PDF'}`, {
          onReplace: () => place(data.text, result.text, deps, run),
          onKeep: () => {
            if (current === run) current = null;
          },
        });
      } else place(data.text, result.text, deps, run);
    }
  };
  // The thread itself failed: it could not be loaded (offline) or ran out of memory.
  worker.onerror = (event) => {
    event.preventDefault?.();
    if (!stillCurrent()) return;
    finish();
    current = null;
    showMessage(REFUSALS.failed);
  };
  worker.postMessage({ cmd: 'open', bytes }, [bytes]);
}

function place(text, notes, deps, run) {
  if (current !== run) return;
  current = null;
  deps.putText(text);
  deps.showMessage(`The text of the PDF is in the box. Press Play to listen.${notes ? ' ' + notes : ''}`, { info: true });
}

function showStatus(deps, text) {
  deps.status.hidden = false; // shown first, so screen readers announce the text that follows
  deps.statusText.textContent = text;
}

function hideStatus(deps) {
  // Keep keyboard users in place when the Cancel button they are on disappears.
  const hadFocus = deps.status.contains(document.activeElement);
  deps.status.hidden = true;
  deps.statusText.textContent = '';
  if (hadFocus) deps.focusAfter?.focus();
}
