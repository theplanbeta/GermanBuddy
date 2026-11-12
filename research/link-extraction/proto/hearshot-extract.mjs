// Hearshot link-to-listening prototype: saved HTML + URL  ->  { meta, blocks, warnings }
// Pure function, no network. Works on any DOM Document (linkedom on server, DOMParser in browser).
// Block types: heading | paragraph | list-item | quote | caption | code | table | footnote | reference | other
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { Defuddle } from 'defuddle/node';

export const DEFAULT_TOGGLES = {
  announceTitle: true, announceByline: true, announceDate: true,
  heading: true, paragraph: true, 'list-item': true, quote: true, // quote is announced ("Quote ... End quote")
  caption: false, code: false, table: false, footnote: false, reference: false, other: false,
  announceCodeSkip: true,   // say "Code example skipped." once instead of silence
  announceTableSkip: true,  // say "Table skipped."
};
export const WPM = 165; // neural TTS at 1.0x ~ 150-180 wpm; shown as a range in UI

// ---------- URL triage (decline gracefully, before any fetch) ----------
export function classifyUrl(u) {
  let url; try { url = new URL(u); } catch { return { ok: false, kind: 'invalid', message: 'That does not look like a web link.' }; }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, kind: 'scheme', message: 'Only http(s) links are supported.' };
  const h = url.hostname.replace(/^www\./, '').toLowerCase(); const p = url.pathname.toLowerCase();
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|tiktok\.com)$/.test(h)) return { ok: false, kind: 'video', message: 'Video pages have no article text. Hearshot reads articles, not videos.' };
  if (/(^|\.)(open\.spotify\.com|podcasts\.apple\.com|soundcloud\.com)$/.test(h)) return { ok: false, kind: 'audio', message: 'Podcast and music pages are audio already.' };
  if (/\.(mp3|m4a|mp4|webm|mov|zip|exe|apk|png|jpe?g|gif|webp)$/.test(p)) return { ok: false, kind: 'media', message: 'That link is a file, not a web page.' };
  if (/\.pdf$/.test(p)) return { ok: true, kind: 'pdf', route: 'pdf-pipeline' };
  if (/^docs\.google\.com$/.test(h) && /^\/document\/d\//.test(p)) return { ok: true, kind: 'gdoc', route: 'gdoc-export', note: 'Works only if the doc is shared as "Anyone with the link".' };
  if (/(^|\.)(x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com)$/.test(h)) return { ok: false, kind: 'login-wall', message: 'Social network pages need a login and are not supported. Use Share > copy text instead.' };
  return { ok: true, kind: 'page' };
}

// ---------- language guess (stopword voting; enough for en vs de/fr/es/it/nl/pt) ----------
const SW = {
  en: 'the of and to in is that for it with as was on are this be by at from or an have not but they which you we his her their has had were been will would can more'.split(' '),
  de: 'der die und das ist nicht ein eine mit den von zu auf für sich auch dem des im es als wird sind oder aber nach bei wie einen noch wurde'.split(' '),
  fr: 'le la les de des et est un une que pour dans qui pas sur au avec ce il elle plus par ses sont mais comme nous vous'.split(' '),
  es: 'el la los las de y es un una que en por con para no se su al lo como más pero sus le ya o fue este'.split(' '),
  it: 'il lo la gli di e è un una che per con non si su da come più ma sono del della alla anche nel'.split(' '),
  nl: 'de het een en van is dat op te in voor met niet zijn aan er ook als maar bij om dit nog'.split(' '),
  pt: 'o a os as de e é um uma que em para com não se por mais mas como foi ao dos das no na'.split(' '),
};
export function guessLang(text) {
  const w = (text.toLowerCase().match(/\p{L}+/gu) || []).slice(0, 1500);
  if (w.length < 20) return { lang: 'und', confidence: 0 };
  const nonLatin = (text.slice(0, 2000).match(/[Ѐ-ӿ֐-ۿऀ-෿฀-๿぀-ヿ一-鿿가-힯]/g) || []).length;
  if (nonLatin > 40) return { lang: 'non-latin', confidence: 0.9 };
  const sc = {}; for (const [l, list] of Object.entries(SW)) { const s = new Set(list); sc[l] = w.filter(x => s.has(x)).length / w.length; }
  const best = Object.entries(sc).sort((a, b) => b[1] - a[1]); return { lang: best[0][0], confidence: best[0][1] / (best[1][1] + 1e-6) > 1.4 ? 0.9 : 0.5, scores: sc };
}

// ---------- block conversion ----------
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'AUDIO', 'VIDEO', 'CANVAS', 'TEMPLATE']);
const norm = s => s.replace(/[ ​⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();

function inlineText(el) {
  // inline text with sup footnote markers / edit links dropped, <br> -> space
  let out = '';
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') { out += ' '; return; }
    if (tag === 'IMG') return; // alt text is NOT read by default
    if (tag === 'SUP' || tag === 'SUB') { // footnote / citation markers; keep real exponents like x<sup>2</sup>? treat short numeric sup inside a link as marker
      const t = n.textContent.trim();
      if (/^\[?\(?\d{1,3}\)?\]?$|^\[?[a-z]\]?$|^[\*†‡§]+$/i.test(t) && (n.querySelector('a') || /^\[/.test(t) || n.className?.toString().match(/reference|footnote|fn/i) || n.id)) return;
      if (/^\[?(citation needed|clarification needed|when\?|who\?|according to whom\?|dubious.*|better source needed|original research\?)\]?$/i.test(t)) return;
      out += (tag === 'SUP' ? '^' : '') + t; return;
    }
    const cls = (n.className && n.className.toString()) || '';
    if (/\b(mw-editsection|noprint|reference|mw-cite-backlink|footnote-ref|screen-reader-only-skip|sr-only-skip|anchor-link|hash-link|heading-link|permalink|headerlink|copy-code)\b/i.test(cls) && !/^(P|DIV|LI|UL|OL)$/.test(tag)) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(el); return norm(out);
}

function linkDensity(el) { const tot = (el.textContent || '').trim().length; if (!tot) return 0; let l = 0; el.querySelectorAll('a').forEach(a => { l += (a.textContent || '').trim().length; }); return Math.min(1, l / tot); }

export function htmlToBlocks(root) {
  const blocks = [];
  const push = (type, text, extra = {}) => { text = norm(text); if (text) blocks.push({ type, text, ...extra }); };
  const BLOCK_CHILD = 'P,DIV,UL,OL,LI,H1,H2,H3,H4,H5,H6,BLOCKQUOTE,PRE,TABLE,FIGURE,FIGCAPTION,SECTION,ARTICLE,ASIDE,DL,DT,DD,HR,DETAILS,MAIN,HEADER,FOOTER';
  const hasBlockChild = el => [...el.children].some(c => BLOCK_CHILD.split(',').includes(c.tagName));
  const cls = el => ((el.className && el.className.toString()) || '') + ' ' + (el.id || '');
  function walk(el, ctx = {}) {
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) { const t = norm(n.nodeValue); if (t && el.tagName !== 'UL' && el.tagName !== 'OL') push(ctx.type || 'paragraph', t); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName; if (SKIP_TAGS.has(tag) || tag === 'HR') continue;
      const c = cls(n);
      if (/^H[1-6]$/.test(tag)) { push('heading', inlineText(n), { level: +tag[1] }); continue; }
      if (tag === 'PRE') { push('code', n.textContent.replace(/\n{3,}/g, '\n\n'), {}); continue; }
      if (tag === 'TABLE') { push('table', [...n.querySelectorAll('tr')].map(r => [...r.children].map(x => norm(x.textContent)).join(' | ')).join('\n')); continue; }
      if (tag === 'FIGCAPTION' || /\b(caption|credit|photo-?credit|image-?credit|wp-caption-text)\b/i.test(c) && !hasBlockChild(n)) { push('caption', inlineText(n)); continue; }
      if (tag === 'BLOCKQUOTE') { const before = blocks.length; walk(n, { type: 'quote' }); for (let i = before; i < blocks.length; i++) if (blocks[i].type === 'paragraph') blocks[i].type = 'quote'; if (blocks.length === before) push('quote', inlineText(n)); continue; }
      if (tag === 'UL' || tag === 'OL') { let i = 0; for (const li of n.children) { if (li.tagName !== 'LI') continue; i++; const inner = hasBlockChild(li); if (inner) { const b0 = blocks.length; walk(li, ctx); if (blocks.length > b0) blocks[b0] = { ...blocks[b0], type: blocks[b0].type === 'paragraph' ? 'list-item' : blocks[b0].type, ordinal: tag === 'OL' ? i : undefined }; } else push(/\b(references?|footnotes?|citations?)\b/i.test(c) || ctx.refs ? 'reference' : 'list-item', inlineText(li), { ordinal: tag === 'OL' ? i : undefined, ld: +linkDensity(li).toFixed(2) }); } continue; }
      if (tag === 'ASIDE' || /\b(footnotes?|endnotes?|references?|reflist|citations?)\b/i.test(c) && /^(DIV|SECTION|OL|UL|ASIDE)$/.test(tag)) { const b0 = blocks.length; walk(n, { ...ctx, refs: true }); for (let i = b0; i < blocks.length; i++) if (blocks[i].type === 'paragraph' || blocks[i].type === 'list-item') blocks[i].type = /footnote|endnote/i.test(c) ? 'footnote' : tag === 'ASIDE' ? 'other' : 'reference'; continue; }
      if (tag === 'P' || tag === 'DT' || tag === 'DD' || (tag === 'LI')) { if (hasBlockChild(n)) walk(n, ctx); else push(ctx.type === 'quote' ? 'quote' : 'paragraph', inlineText(n), { ld: +linkDensity(n).toFixed(2) }); continue; }
      if (hasBlockChild(n)) { walk(n, ctx); continue; }
      push(ctx.type || (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' ? 'paragraph' : 'paragraph'), inlineText(n));
    }
  }
  walk(root); return blocks;
}

// ---------- listening cleaning (rules documented in REPORT) ----------
const RE = {
  citation: /\s?\[(?:\d{1,3}|[a-z]|note \d+|citation needed|clarification needed|when\?|who\?|dubious[^\]]*|edit|better source needed|failed verification|original research\?|according to whom\?)\]/gi,
  emoji: /[\p{Extended_Pictographic}‍️]/gu,
  url: /\bhttps?:\/\/[^\s)]+/g,
  promo: /^(read more|read next|read also|related|recommended|more from|you may also like|you might also like|sign up|subscribe|subscribe now|share this|share|follow us|advertisement|sponsored|continue reading|listen to this article|click here|tap here|skip to|comments?|leave a comment|join the conversation|newsletter|get the (?:newsletter|app)|already a subscriber|log ?in|support (?:us|our|independent)|become a member|story continues below)\b/i,
  byDate: /^(?:by\s+[^.]{2,60}|published|updated|posted|last updated|first published)\b[^.]{0,80}$/i,
  photoCredit: /^(?:photo|image|illustration|credit|photograph|source|getty|reuters|ap photo|afp|shutterstock)\b.{0,80}$/i,
};
export function cleanBlockText(t, type) {
  if (type === 'code' || type === 'table') return t;
  if (type === 'heading') t = t.replace(/\s*[#\u00b6\u00a7\ud83d\udd17]+\s*$/u, '');
  return t.replace(/\s*[\(\[](?:more|read more|continue reading|see more|\u2026|\.\.\.)[\)\]]/gi, '').replace(/\s*(?:read more|continue reading)\s*[\u00bb>]+\s*$/i, '').replace(RE.citation, '').replace(RE.emoji, '').replace(RE.url, 'link').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}
const UI_LABEL = /^(caption|close|menu|search|share|tweet|email|print|save|save for later|comments?|reply|like|follow|more|next|previous|prev|back|top|home|login|log in|sign in|sign up|subscribe|advertisement|ad|skip to content|read more|loading\.*|expand|collapse|show more|show less|copy link|copied)\W*$/i;
const wc = t => (t.match(/\p{L}[\p{L}\p{N}'’-]*|\p{N}+/gu) || []).length;

export function cleanTitle(title, site, url) {
  if (!title) return title; let host = ''; try { host = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch {}
  const parts = title.split(/\s+[|\u2013\u2014\-\u00b7\u2022:]\s+/); if (parts.length < 2) return norm(title);
  const tail = parts[parts.length - 1]; const tl = tail.toLowerCase().replace(/[^a-z0-9]/g, '');
  const looksSite = (site && tl.includes(site.toLowerCase().replace(/[^a-z0-9]/g, ''))) || (host && (tl.includes(host) || host.includes(tl))) || (tail.split(' ').length <= 4 && /\b(blog|news|times|post|wikipedia|magazine|journal|review|daily|herald|guardian)\b/i.test(tail));
  return norm(looksSite ? parts.slice(0, -1).join(' - ') : title);
}
export function cleanForListening(blocks, meta) {
  const out = []; const seen = new Set(); let afterRefsHeading = false;
  for (let i = 0; i < blocks.length; i++) {
    let b = { ...blocks[i] }; b.text = cleanBlockText(b.text, b.type); if (!b.text) continue;
    const words = wc(b.text);
    // end-matter headings: everything after "References", "Notes", "External links" etc. is reference-type
    if (b.type === 'heading' && /^(references?|notes?|footnotes?|citations?|bibliography|external links|further reading|see also|sources|related (?:articles|posts|stories)|comments?|more from .*|share this)\b/i.test(b.text)) { afterRefsHeading = /^(references?|notes?|footnotes?|citations?|bibliography|external links|further reading|see also|sources)/i.test(b.text) ? 'reference' : 'other'; b.skip = true; b.why = 'end-matter heading'; out.push(b); continue; }
    if (b.type === 'heading' && afterRefsHeading) afterRefsHeading = false; // a new real section ends end-matter only for h1/h2 heading? keep simple
    if (afterRefsHeading && b.type !== 'heading') { b.type = afterRefsHeading; }
    if (b.type === 'paragraph' || b.type === 'list-item') {
      if (RE.promo.test(b.text) && words <= 12) { b.type = 'other'; b.why = 'promo/UI'; }
      else if (RE.byDate.test(b.text) && words <= 14 && i < 6) { b.type = 'other'; b.why = 'byline/date line'; }
      else if (RE.photoCredit.test(b.text) && words <= 14) { b.type = 'caption'; b.why = 'credit line'; }
      else if (words <= 3 && UI_LABEL.test(b.text)) { b.type = 'other'; b.why = 'UI label'; }
    }
    if (b.type !== 'other' && i > 0 && out.length && out[out.length - 1].text === b.text && words >= 4) { b.type = 'other'; b.why = 'adjacent duplicate'; }
    out.push(b);
  }
  // pull quotes: a quote block whose text is repeated inside another block is a magazine pull-quote, not content
  const flat = (x) => x.toLowerCase().replace(/[\u201c\u201d\u2018\u2019"'\s]+/g, ' ').trim();
  for (const q of out) { if (q.type !== 'quote' || q.skip) continue; const qq = flat(q.text); if (qq.split(' ').length < 8) continue; const needle = qq.slice(0, Math.min(60, qq.length)); if (out.some(o => o !== q && o.type !== 'quote' && flat(o.text).includes(needle))) { q.type = 'other'; q.why = 'pull quote (repeated in text)'; } }
  // link lists: >=3 consecutive list-items that are (almost) all link text and not sentences (related-article rails, tag clouds, TOCs)
  for (let i = 0; i < out.length;) {
    if (out[i].type !== 'list-item') { i++; continue; }
    let j = i; while (j < out.length && out[j].type === 'list-item') j++;
    const run = out.slice(i, j); const linky = run.filter(x => (x.ld ?? 0) >= 0.8 && !/[.!?]$/.test(x.text));
    if (run.length >= 3 && linky.length / run.length >= 0.8) run.forEach(x => { x.type = 'other'; x.why = 'link list'; });
    i = j;
  }
  // headings that only introduce a skipped link list (e.g. "Contents", "Related")
  for (let i = 0; i < out.length - 1; i++) if (out[i].type === 'heading' && out[i + 1].why === 'link list') { out[i].type = 'other'; out[i].why = 'heading of link list'; }
  return out;
}

// ---------- main entry ----------
export async function extractForListening(html, url, { toggles = {}, prefer = 'auto' } = {}) {
  const T = { ...DEFAULT_TOGGLES, ...toggles }; const warnings = [];
  const tri = classifyUrl(url); if (!tri.ok) return { ok: false, kind: tri.kind, message: tri.message };
  if (tri.route) return { ok: true, route: tri.route, note: tri.note, kind: tri.kind };
  const cand = [];
  // A: Readability
  try { const { document } = parseHTML(html); const r = new Readability(document, { keepClasses: true, charThreshold: 200 }).parse(); if (r) cand.push({ name: 'readability', html: r.content, title: r.title, byline: r.byline, site: r.siteName, date: r.publishedTime, lang: r.lang, excerpt: r.excerpt }); } catch (e) { warnings.push('readability failed: ' + e.message); }
  // B: Defuddle
  try { const { document } = parseHTML(html); const r = await Defuddle(document, url, {}); if (r && r.content) cand.push({ name: 'defuddle', html: r.content, title: r.title, byline: r.author, site: r.site, date: r.published, lang: r.language, excerpt: r.description }); } catch (e) { warnings.push('defuddle failed: ' + e.message); }
  if (!cand.length) return { ok: false, kind: 'extract-failed', message: 'No readable article text was found. The page may need JavaScript or a login; try Share/Copy text instead.', warnings };
  for (const c of cand) { const { document } = parseHTML('<!doctype html><html><body>' + c.html + '</body></html>'); c.rawBlocks = htmlToBlocks(document.body); c.blocks = cleanForListening(c.rawBlocks, c); c.score = qualityScore(c); }
  // Evidence (see benchmark): Readability alone is as good as any practical two-extractor vote; use Defuddle only when Readability fails or finds almost nothing.
  const rawWords = c => c.rawBlocks.filter(b => b.type === 'paragraph' || b.type === 'quote' || b.type === 'list-item').reduce((s, b) => s + wc(b.text), 0);
  const R = cand.find(c => c.name === 'readability'), D = cand.find(c => c.name === 'defuddle');
  const pick = prefer === 'auto' ? ((R && rawWords(R) >= 60) || !D ? R || D : D) : cand.find(c => c.name === prefer) || cand[0];
  const blocks = pick.blocks.map(b => ({ ...b, skip: b.skip || T[b.type] === false }));
  const spoken = blocks.filter(b => !b.skip); const words = spoken.reduce((s, b) => s + wc(b.text), 0);
  const sample = spoken.slice(0, 40).map(b => b.text).join(' '); const lg = guessLang(sample);
  const declared = (pick.lang || '').slice(0, 2).toLowerCase();
  if (lg.lang !== 'en' && lg.lang !== 'und') warnings.push(`This looks like ${lg.lang === 'non-latin' ? 'a non-Latin-script language' : lg.lang.toUpperCase()}; the English voice will mispronounce it.`);
  else if (declared && declared !== 'en') warnings.push(`Page declares language "${declared}".`);
  if (words < 120) warnings.push('Very little text found; the page may be JavaScript-rendered, a paywall teaser or not an article.');
  const announce = []; if (T.announceTitle && pick.title) announce.push(cleanTitle(pick.title, pick.site, url).replace(/[.:]?$/, '') + '.'); if (T.announceByline && pick.byline) announce.push('By ' + norm(pick.byline).replace(/^by\s+/i, '') + '.'); if (T.announceDate && pick.date) { const d = new Date(pick.date); if (!isNaN(d)) announce.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '.'); }
  return { ok: true, kind: 'article', meta: { url, title: cleanTitle(pick.title, pick.site, url) || null, byline: pick.byline || null, site: pick.site || null, date: pick.date || null, lang: lg.lang, langDeclared: declared || null, extractor: pick.name, extractorsTried: cand.map(c => ({ name: c.name, words: c.blocks.filter(b => T[b.type] !== false).reduce((s, b) => s + wc(b.text), 0), score: +c.score.toFixed(2) })) , words, listenMinutes: Math.max(1, Math.round(words / WPM)), announce: announce.join(' ') }, blocks, warnings };
}

// ---------- extractor-choice heuristic (see benchmark section for evidence) ----------
export function qualityScore(c) {
  const bl = c.blocks; const body = bl.filter(b => b.type === 'paragraph' || b.type === 'quote'); const words = body.reduce((s, b) => s + wc(b.text), 0);
  if (!words) return 0; const long = body.filter(b => wc(b.text) >= 20).length; const leak = bl.filter(b => b.type === 'other' || b.type === 'caption' || b.type === 'reference').reduce((s, b) => s + wc(b.text), 0);
  const total = bl.reduce((s, b) => s + wc(b.text), 0) || 1;
  return Math.log(1 + words) * (0.5 + long / Math.max(1, body.length)) * (1 - 0.7 * leak / total);
}

// ---------- speech script: what the voice engine would actually be given ----------
// Segments are { kind: 'announce'|'heading'|'paragraph'|'list-item'|'quote-start'|'quote'|'quote-end'|'skip-note', text }.
export function renderSpeech(result, toggles = {}) {
  const T = { ...DEFAULT_TOGGLES, ...toggles }; const segs = [];
  if (!result.ok || !result.blocks) return segs;
  if (result.meta.announce) segs.push({ kind: 'announce', text: result.meta.announce });
  let prev = null, noted = new Set();
  for (const b of result.blocks) {
    const on = !b.skip; const t = b.type;
    if (prev === 'quote' && !(on && t === 'quote')) segs.push({ kind: 'quote-end', text: 'End quote.' });
    if (!on) {
      if ((t === 'code' && T.announceCodeSkip) || (t === 'table' && T.announceTableSkip)) { const key = t + ':' + segs.length; if (prev !== 'skip-' + t) segs.push({ kind: 'skip-note', text: t === 'code' ? 'Code example skipped.' : 'Table skipped.' }); prev = 'skip-' + t; continue; }
      continue;
    }
    if (t === 'quote' && prev !== 'quote') segs.push({ kind: 'quote-start', text: 'Quote.' });
    segs.push({ kind: t, text: b.text, level: b.level });
    prev = t;
  }
  if (prev === 'quote') segs.push({ kind: 'quote-end', text: 'End quote.' });
  return segs;
}
export function speechText(segs) { return segs.map(s => s.kind === 'heading' ? '\n' + s.text + '.' : s.text).join('\n'); }
