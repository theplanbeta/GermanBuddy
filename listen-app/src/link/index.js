// "Paste a link and Hearshot reads the article."
//
//   readLink(input, { helper: { url, key }, fetch, DOMParser, timeoutMs })
//     -> { ok: true, text, title, byline, site, language, words, minutes, warnings, url, finalUrl }
//      | { ok: false, kind, message }
//
// Three steps: classifyUrl (no network), fetchPage (the one POST to the owner's helper, which
// fetches the page), extractArticle (on this device). Never throws; sends nothing anywhere else.
// Importing this file touches neither the DOM nor the network; Readability loads on first use.
import { classifyUrl, tidyUrl, MESSAGES } from './classify.js';
import { fetchPage, FETCH_MESSAGES, PRIVACY_NOTE, TIMEOUT_MS } from './fetch-page.js';
import { extractArticle, plainTextArticle, guessLang, EXTRACT_MESSAGES, WPM } from './extract.js';

export { classifyUrl, tidyUrl, fetchPage, extractArticle, plainTextArticle, guessLang, PRIVACY_NOTE, MESSAGES, FETCH_MESSAGES, EXTRACT_MESSAGES, TIMEOUT_MS, WPM };

const OOPS = 'Something went wrong while reading that page. Try again, or open the page, select the text, copy it and paste it here.';

export async function readLink(input, { helper, fetch, DOMParser, timeoutMs } = {}) {
  try {
    const c = classifyUrl(input);
    if (!c.ok) return { ok: false, kind: c.kind, message: c.message };
    const page = await fetchPage({ url: c.url, helper, fetch, timeoutMs });
    if (!page.ok) return { ok: false, kind: page.code, message: page.message };
    if (page.kind === 'pdf') return { ok: false, kind: 'pdf', message: MESSAGES.pdf };
    const a = page.type === 'text/plain' ? plainTextArticle(page.html, page.finalUrl) : await extractArticle(page.html, page.finalUrl, { DOMParser });
    if (!a.ok) return { ok: false, kind: 'no-article', message: a.message };
    return { ...a, url: c.url, finalUrl: page.finalUrl };
  } catch {
    return { ok: false, kind: 'error', message: OOPS };
  }
}
