// From a PDF to the text that goes into the text box. No page or DOM code:
// runs in the PDF worker and in tests (Node).
//
// Who changes what (two layers rewrite text, so each owns its own part):
//   - listen.js `normalizeText` (research layer) runs ONCE, here, and its
//     result is what the text box shows: document clean-up (ligatures, bullets,
//     dot leaders, citation markers, URLs as "link to example.org", heading
//     full stops) and the document abbreviations the app does not know
//     ("i.e.", "e.g.", "cf.", "Figs.", "Eq.", "Sec.", German "z.B.", "S. 12").
//   - text/spoken.js `spokenForms` keeps running on every sentence just
//     before the voice, as for pasted text: money, times, dates, units,
//     fractions. Where both know an abbreviation ("No. 5", "Fig. 3", "p. 7",
//     "vs.", "approx.") the first rewrite leaves nothing for the second, so
//     nothing is said twice.
// Two places where the first layer's result trips up the app, repaired below:
//   - "It was rebuilt. No. 5 stood empty." becomes "... rebuilt. number 5 ...":
//     the splitter only starts a sentence at a capital, so two sentences ran
//     together. "number" and "volume" get their capital back there.
//   - ALL-CAPS headings are title-cased ("UP TO 5 GB OF STORAGE" -> "... 5 Gb
//     Of Storage"), and spokenForms only knows "GB" and "EUR" in capitals.
import { DEFAULT_SETTINGS, listeningText } from './listen.js';
import { openPdf } from './hearshot-doc.js';
import { pageProblems } from './messages.js';

// "number" / "volume" (from "No." / "Vol.") at the start of a paragraph or of a sentence.
const LOST_CAPITAL = /(^|[.!?]["'”’)\]]*\s+)(number|volume)(?=\s?\d)/gm;
// Units and currency codes next to a number, as the title-casing left them.
const UNIT_AFTER = /(\d\s?)(Gb|Mb|Tb)\b/g;
const CODE_BEFORE = /\b(Eur|Usd|Gbp|Jpy|Inr)(?=\s?\d)/g;
const CODE_AFTER = /(\d\s?)(Eur|Usd|Gbp|Jpy|Inr)\b/g;

/** Repairs the two clashes described above. */
export function repairForApp(text) {
  return text
    .replace(LOST_CAPITAL, (_, before, w) => before + w[0].toUpperCase() + w.slice(1))
    .replace(UNIT_AFTER, (_, n, u) => n + u.toUpperCase())
    .replace(CODE_BEFORE, (c) => c.toUpperCase())
    .replace(CODE_AFTER, (_, n, c) => n + c.toUpperCase());
}

/**
 * The text-box text for a PDF: headings, paragraphs and list items are read;
 * tables and equations become a one-word cue; running heads, page numbers,
 * footnotes, captions, references and contents are left out (the research's
 * DEFAULT_SETTINGS). Blocks of pages in `skipPages` (pages that are pictures
 * of text) are left out too: their text, if any, is garbled.
 */
export function pdfText(blocks, { skipPages = [] } = {}) {
  const skip = new Set(skipPages);
  const kept = skip.size ? blocks.filter((b) => !skip.has(b.page)) : blocks;
  return repairForApp(listeningText(kept, DEFAULT_SETTINGS));
}

/**
 * Reads a whole PDF (bytes: Uint8Array) with LiteParse (the class, after its
 * init()). Used by the worker and by the tests, so both take the same path.
 * Calls onOpen(pages) once and onPage(parsed, pages) after every page.
 * Returns { text, scanned, blank, order }: the text-box text, the pages that
 * are pictures of text, the blank pages, the pages whose reading order may be wrong.
 */
export async function extractPdf(bytes, { LiteParse, onOpen = () => {}, onPage = () => {} }) {
  const doc = await openPdf(bytes, { LiteParse, batchSize: 8 });
  onOpen(doc.stats.pages);
  const blocks = [];
  const pageList = [];
  for await (const page of doc.pages()) {
    blocks.push(...page.blocks);
    pageList.push({ page: page.page, warnings: page.warnings });
    onPage(doc.stats.parsedPages, doc.stats.pages);
  }
  const { scanned, blank, order } = pageProblems(doc.stats, pageList);
  // Blank pages are skipped too (in case a stray mark gave them a block).
  return { text: pdfText(blocks, { skipPages: [...scanned, ...blank] }), scanned, blank, order };
}
