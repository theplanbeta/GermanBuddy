// Listening text from typed blocks: skip settings, user exclusions and document-text normalisation.
// Plain ES module. The voice engine still does sentence splitting and general normalisation
// (numbers, dates, units, currency, e-mail addresses); this file only fixes what is specific to
// documents or what would otherwise break sentence splitting.

export const DEFAULT_SETTINGS = {
  read: { heading: true, paragraph: true, 'list-item': true, caption: false, footnote: false, table: 'cue', equation: 'cue', 'figure-text': false, reference: false, toc: false, 'header-footer': false, 'page-number': false, other: false },
  citations: 'skip',     // 'skip' | 'keep'  numeric [12] and author-year (Smith et al., 2020)
  urls: 'domain',        // 'domain' | 'skip' | 'keep'
  headingPause: true,    // end headings with a full stop so the engine pauses
  excluded: [],          // blockIds the user tapped out
  rules: [],             // "exclude everything like this": [{type, textKey?, band?, sizeRange?}]
  crop: null,            // {top, bottom, left, right} fractions of the page
  startAt: null,         // blockId to start from
};

const ABBREV = [
  [/\bet al\.(?=\s*[,;:)]|\s+\p{Ll})/gu, 'et al'], [/\bet al\.(?=\s*\()/gu, 'et al'],
  [/\bi\.\s?e\.,?/g, 'that is,'], [/\be\.\s?g\.,?/g, 'for example,'], [/\bcf\.\s/g, 'compare '], [/\bvs\.\s/g, 'versus '], [/\bapprox\.\s/g, 'approximately '], [/\bresp\.\s/g, 'respectively '],
  [/\bFigs?\.\s?(?=\d)/g, (m) => m.startsWith('Figs') ? 'Figures ' : 'Figure '], [/\bfig\.\s?(?=\d)/g, 'figure '],
  [/\bEqs?\.\s?(?=\(?\d)/g, (m) => m.startsWith('Eqs') ? 'Equations ' : 'Equation '], [/\bTab\.\s?(?=\d)/g, 'Table '], [/\bSecs?\.\s?(?=\d)/g, 'Section '], [/\bChap?\.\s?(?=\d)/g, 'Chapter '],
  [/\bpp\.\s?(?=\d)/g, 'pages '], [/\bp\.\s?(?=\d)/g, 'page '], [/\bvol\.\s?(?=\d)/gi, 'volume '], [/\bNo\.\s?(?=\d)/g, 'number '], [/\bno\.\s?(?=\d)/g, 'number '],
  [/\bAbb\.\s?(?=\d)/g, 'Abbildung '], [/\bz\.\s?B\./g, 'zum Beispiel'], [/\bd\.\s?h\./g, 'das heißt'], [/\bu\.\s?a\./g, 'unter anderem'], [/\bvgl\.\s/g, 'vergleiche '], [/\bbzw\.\s/g, 'beziehungsweise '], [/\bS\.\s?(?=\d)/g, 'Seite '], [/\bNr\.\s?(?=\d)/g, 'Nummer '],
];

/** Normalise one block's text for listening. */
export function normalizeText(text, { citations = 'skip', urls = 'domain', type = 'paragraph' } = {}) {
  let t = text.normalize('NFKC');
  t = t.replace(/[­​-‍⁠﻿]/g, '').replace(/[  -  ]/g, ' ').replace(/�|[-]/g, '');
  t = t.replace(/\*\*|__/g, '').replace(/''/g, '"').replace(/``/g, '"').replace(/‘‘|’’/g, '"');
  t = t.replace(/(\s*\.){4,}\s*\d*\s*$/g, '').replace(/(\s*\.\s){3,}/g, ' ');        // dot leaders
  t = t.replace(/^\s*[•●▪■◦○◆◇►▸‣⁃∙·\-–—*]\s+/, '');                              // bullets
  t = t.replace(/\b((?:\p{L} ){3,}\p{L})\b/gu, (m) => m.replace(/ /g, ''));           // l e t t e r - s p a c e d
  if (citations === 'skip') {
    t = t.replace(/\s?\[(\d{1,3}([,–-]\s?\d{1,3})*)\]/g, '');                       // [12], [3, 4], [5-7]
    t = t.replace(/\s?\((?:see\s)?(?:[\p{Lu}][\p{L}'’-]+(?:\s(?:and|&|und)\s[\p{Lu}][\p{L}'’-]+)?(?:\set al\.?)?,?\s(?:19|20)\d{2}[a-z]?(?:[;,]\s?)?)+\)/gu, ''); // (Smith et al., 2020; Lee 2019)
  }
  if (urls !== 'keep') t = t.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/gi, (u) => urls === 'skip' ? '' : 'link to ' + u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]);
  t = t.replace(/<(link to [^>]+)>/g, '$1');
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  // ALL-CAPS runs read as acronyms by many voices: title-case runs of 3+ capitalised words
  t = t.replace(/\b(\p{Lu}[\p{Lu}'’-]+(?:\s+\p{Lu}[\p{Lu}'’-]+){2,})\b/gu, (m) => m.toLowerCase().replace(/(^|\s|-)(\p{Ll})/gu, (x, a, b) => a + b.toUpperCase()));
  t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  if (type === 'heading' && t && !/[.!?:]$/.test(t)) t += '.';
  return t;
}

const CUES = { table: 'Table omitted.', equation: 'Equation.', 'figure-text': 'Figure.' };

/** Does a block match a saved "exclude everything like this" rule? */
export function matchesRule(b, r) {
  if (r.type && r.type !== b.type) return false;
  if (r.textKey && textKey(b.text) !== r.textKey) return false;
  if (r.band && b.bbox && b.pageHeight) { const y = b.bbox[1] / b.pageHeight; if (r.band === 'top' && y > 0.15) return false; if (r.band === 'bottom' && y < 0.85) return false; }
  if (r.sizeRange && b.size != null && (b.size < r.sizeRange[0] || b.size > r.sizeRange[1])) return false;
  return true;
}
export const textKey = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#]+/gu, ' ').trim();

/**
 * Produce the listening sequence. Returns [{blockId, page, kind, text}] where kind is 'heading',
 * 'paragraph' or 'cue'. Join with blank lines for a plain-text preview.
 */
export function listeningItems(blocks, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings, read: { ...DEFAULT_SETTINGS.read, ...(settings.read || {}) } };
  const excluded = new Set(s.excluded || []);
  const out = []; let started = !s.startAt;
  let lastCue = null;
  for (const b of blocks) {
    if (!started) { if (b.blockId === s.startAt) started = true; else continue; }
    if (excluded.has(b.blockId) || (s.rules || []).some(r => matchesRule(b, r))) continue;
    if (s.crop && b.bbox && b.pageWidth) {
      const [x0, y0, x1, y1] = b.bbox; const W = b.pageWidth, H = b.pageHeight; const c = s.crop;
      if (y1 < H * (c.top || 0) || y0 > H * (1 - (c.bottom || 0)) || x1 < W * (c.left || 0) || x0 > W * (1 - (c.right || 0))) continue;
    }
    const mode = s.read[b.type] ?? false;
    if (mode === 'cue') { if (lastCue !== b.type) out.push({ blockId: b.blockId, page: b.page, kind: 'cue', text: CUES[b.type] || '' }); lastCue = b.type; continue; }
    if (!mode) continue;
    lastCue = null;
    const text = normalizeText(b.text, { citations: s.citations, urls: s.urls, type: b.type });
    if (!text) continue;
    const prev = out[out.length - 1];
    if (b.continuesFrom && prev && prev.chain === b.continuesFrom && prev.kind === 'paragraph') {
      prev.text = b.glue === 'hyphen' ? prev.text.replace(/-$/, '') + text : b.glue === '' || b.glue === 'dropcap' ? prev.text + text : prev.text + ' ' + text;
      prev.pages = [...new Set([...(prev.pages || [prev.page]), b.page])]; prev.blockIds.push(b.blockId); continue;
    }
    out.push({ chain: b.continuesFrom || b.blockId, blockIds: [b.blockId], blockId: b.blockId, page: b.page, kind: b.type === 'heading' ? 'heading' : 'paragraph', text, level: b.level });
  }
  return out;
}
export const listeningText = (blocks, settings) => listeningItems(blocks, settings).map(i => i.text).join('\n\n');
