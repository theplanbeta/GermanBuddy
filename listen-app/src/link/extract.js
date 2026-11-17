// A fetched web page -> the text to listen to
// (a port of research/link-extraction/proto/hearshot-extract.mjs to the browser's DOMParser).
//
// extractArticle(html, finalUrl, { DOMParser }) never throws and resolves to
//   { ok: true, title, byline, site, language, words, minutes, text, warnings: [] }
//   { ok: false, message }
// `text`: the title, then "By ..." when there is a byline, then headings and paragraphs as
// blocks separated by blank lines. Readability (@mozilla/readability) is loaded on first use,
// so an ordinary page load does not fetch it. The page is parsed with DOMParser only: its
// scripts do not run and its pictures are not loaded.

export const WPM = 165; // a voice at normal speed, about 150 to 180 words a minute
export const FEW_WORDS = 120;
export const VOICE_LANGUAGES = new Set(['en', 'de', 'es']);
const LANGUAGE_NAMES = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', nl: 'Dutch', pt: 'Portuguese' };

export const EXTRACT_MESSAGES = {
  nothing: 'No article text was found on that page. It may be behind a login or built by scripts. Open the page, select the text, copy it and paste it here.',
  failed: 'Hearshot could not make sense of that page. Open the page, select the text, copy it and paste it here.',
};

// ---------- language guess (stopword votes; enough to tell English from German, Spanish, French, ...) ----------
const STOP = {
  en: 'the of and to in is that for it with as was on are this be by at from or an have not but they which you we his her their has had were been will would can more',
  de: 'der die und das ist nicht ein eine mit den von zu auf für sich auch dem des im es als wird sind oder aber nach bei wie einen noch wurde',
  fr: 'le la les de des et est un une que pour dans qui pas sur au avec ce il elle plus par ses sont mais comme nous vous',
  es: 'el la los las de y es un una que en por con para no se su al lo como más pero sus le ya o fue este',
  it: 'il lo la gli di e è un una che per con non si su da come più ma sono del della alla anche nel',
  nl: 'de het een en van is dat op te in voor met niet zijn aan er ook als maar bij om dit nog',
  pt: 'o a os as de e é um uma que em para com não se por mais mas como foi ao dos das no na',
};
const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([l, s]) => [l, new Set(s.split(' '))]));

/** { lang: 'en' | 'de' | ... | 'non-latin' | 'und', confidence } */
export function guessLang(text) {
  const s = String(text ?? '');
  const words = (s.toLowerCase().match(/\p{L}+/gu) || []).slice(0, 1500);
  if (words.length < 20) return { lang: 'und', confidence: 0 };
  const nonLatin = (s.slice(0, 2000).match(/[Ѐ-ӿ֐-ۿऀ-෿฀-๿぀-ヿ一-鿿가-힯]/g) || []).length;
  if (nonLatin > 40) return { lang: 'non-latin', confidence: 0.9 };
  const scores = Object.entries(STOP_SETS).map(([l, set]) => [l, words.filter((w) => set.has(w)).length / words.length]).sort((a, b) => b[1] - a[1]);
  return { lang: scores[0][0], confidence: scores[0][1] / (scores[1][1] + 1e-6) > 1.4 ? 0.9 : 0.5 };
}

// ---------- page -> blocks ----------
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'AUDIO', 'VIDEO', 'CANVAS', 'TEMPLATE', 'OBJECT', 'EMBED']);
const BLOCK_TAGS = new Set('P,DIV,UL,OL,LI,H1,H2,H3,H4,H5,H6,BLOCKQUOTE,PRE,TABLE,FIGURE,FIGCAPTION,SECTION,ARTICLE,ASIDE,DL,DT,DD,HR,DETAILS,MAIN,HEADER,FOOTER'.split(','));
const norm = (s) => String(s ?? '').replace(/[ ​⁠﻿]/g, ' ').replace(/\s+/g, ' ').trim();
const classOf = (el) => `${(el.className && el.className.toString()) || ''} ${el.id || ''}`;
const hasBlockChild = (el) => [...el.children].some((c) => BLOCK_TAGS.has(c.tagName));
const countWords = (t) => (String(t).match(/\p{L}[\p{L}\p{N}'’-]*|\p{N}+/gu) || []).length;

function inlineText(el) {
  let out = '';
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (SKIP_TAGS.has(tag) || tag === 'IMG') return;
    if (tag === 'BR') { out += ' '; return; }
    if (tag === 'SUP' || tag === 'SUB') {
      const t = n.textContent.trim();
      // footnote and citation markers: [1], 2, a, *, †; real exponents stay
      if (/^\[?\(?\d{1,3}\)?\]?$|^\[?[a-z]\]?$|^[*†‡§]+$/i.test(t) && (n.querySelector('a') || /^\[/.test(t) || /reference|footnote|fn/i.test(classOf(n)) || n.id)) return;
      if (/^\[?(citation needed|clarification needed|when\?|who\?|according to whom\?|dubious.*|better source needed|original research\?)\]?$/i.test(t)) return;
      out += (tag === 'SUP' ? '^' : '') + t;
      return;
    }
    if (/\b(mw-editsection|noprint|reference|mw-cite-backlink|footnote-ref|anchor-link|hash-link|heading-link|permalink|headerlink|copy-code)\b/i.test(classOf(n)) && !/^(P|DIV|LI|UL|OL)$/.test(tag)) return;
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return norm(out);
}

function linkDensity(el) {
  const all = (el.textContent || '').trim().length;
  if (!all) return 0;
  let links = 0;
  el.querySelectorAll('a').forEach((a) => { links += (a.textContent || '').trim().length; });
  return Math.min(1, links / all);
}

/** Typed blocks: heading | paragraph | list-item | quote | caption | code | table | footnote | reference | other */
export function htmlToBlocks(root) {
  const blocks = [];
  const push = (type, text, extra = {}) => { const t = norm(text); if (t) blocks.push({ type, text: t, ...extra }); };
  const walk = (el, ctx = {}) => {
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) { if (el.tagName !== 'UL' && el.tagName !== 'OL') push(ctx.type || 'paragraph', n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (SKIP_TAGS.has(tag) || tag === 'HR') continue;
      const c = classOf(n);
      if (/^H[1-6]$/.test(tag)) { push('heading', inlineText(n), { level: +tag[1] }); continue; }
      if (tag === 'PRE') { push('code', n.textContent); continue; }
      if (tag === 'TABLE') { push('table', n.textContent); continue; }
      if (tag === 'FIGCAPTION' || (/\b(caption|credit|photo-?credit|image-?credit|wp-caption-text)\b/i.test(c) && !hasBlockChild(n))) { push('caption', inlineText(n)); continue; }
      if (tag === 'BLOCKQUOTE') {
        const before = blocks.length;
        walk(n, { type: 'quote' });
        for (let i = before; i < blocks.length; i++) if (blocks[i].type === 'paragraph') blocks[i].type = 'quote';
        if (blocks.length === before) push('quote', inlineText(n));
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue;
          if (hasBlockChild(li)) {
            const b0 = blocks.length;
            walk(li, ctx);
            if (blocks.length > b0 && blocks[b0].type === 'paragraph') blocks[b0].type = 'list-item';
          } else push(/\b(references?|footnotes?|citations?)\b/i.test(c) || ctx.refs ? 'reference' : 'list-item', inlineText(li), { ld: linkDensity(li) });
        }
        continue;
      }
      if (tag === 'ASIDE' || (/\b(footnotes?|endnotes?|references?|reflist|citations?)\b/i.test(c) && /^(DIV|SECTION|OL|UL|ASIDE)$/.test(tag))) {
        const b0 = blocks.length;
        walk(n, { ...ctx, refs: true });
        for (let i = b0; i < blocks.length; i++) {
          if (blocks[i].type === 'paragraph' || blocks[i].type === 'list-item') blocks[i].type = /footnote|endnote/i.test(c) ? 'footnote' : tag === 'ASIDE' ? 'other' : 'reference';
        }
        continue;
      }
      if (tag === 'P' || tag === 'DT' || tag === 'DD' || tag === 'LI') {
        if (hasBlockChild(n)) walk(n, ctx);
        else push(ctx.type === 'quote' ? 'quote' : 'paragraph', inlineText(n), { ld: linkDensity(n) });
        continue;
      }
      if (hasBlockChild(n)) { walk(n, ctx); continue; }
      push(ctx.type || 'paragraph', inlineText(n));
    }
  };
  walk(root);
  return blocks;
}

// ---------- cleaning for listening ----------
const RE = {
  citation: /\s?\[(?:\d{1,3}|[a-z]|note \d+|citation needed|clarification needed|when\?|who\?|dubious[^\]]*|edit|better source needed|failed verification|original research\?|according to whom\?)\]/gi,
  emoji: /[\p{Extended_Pictographic}‍️]/gu,
  url: /\bhttps?:\/\/[^\s)]+/g,
  promo: /^(read more|read next|read also|related|recommended|more from|you may also like|you might also like|sign up|subscribe|subscribe now|share this|share|follow us|advertisement|anzeige|werbung|publicidad|sponsored|continue reading|listen to this article|click here|tap here|skip to|comments?|leave a comment|join the conversation|newsletter|get the (?:newsletter|app)|already a subscriber|log ?in|support (?:us|our|independent)|become a member|story continues below|weiterlesen|mehr zum thema|lesen sie auch)\b/i,
  byDate: /^(?:by\s+[^.]{2,60}|von\s+[^.]{2,60}|published|updated|posted|last updated|first published)\b[^.]{0,80}$/i,
  photoCredit: /^(?:photo|image|illustration|credit|photograph|source|foto|bild|getty|reuters|ap photo|afp|dpa|shutterstock)\b.{0,80}$/i,
  endMatter: /^(references?|notes?|footnotes?|citations?|bibliography|external links|further reading|see also|sources|related (?:articles|posts|stories)|comments?|more from .*|share this|einzelnachweise|quellen|weblinks|referencias|notas)\b/i,
  refHeading: /^(references?|notes?|footnotes?|citations?|bibliography|external links|further reading|see also|sources|einzelnachweise|quellen|weblinks|referencias|notas)/i,
};
const UI_LABEL = /^(caption|close|menu|search|share|tweet|email|e-mail|print|save|save for later|comments?|reply|like|follow|more|next|previous|prev|back|top|home|login|log in|sign in|sign up|subscribe|advertisement|ad|skip to content|read more|loading\.*|expand|collapse|show more|show less|copy link|copied|facebook|twitter|x|whatsapp|linkedin|pinterest|reddit|telegram|flipboard|mastodon|bluesky|threads)\W*$/i;

export function cleanBlockText(text, type) {
  let t = text;
  if (type === 'code' || type === 'table') return t;
  if (type === 'heading') t = t.replace(/\s*[#¶§\u{1f517}]+\s*$/u, '');
  return t
    .replace(/\s*[([](?:more|read more|continue reading|see more|…|\.\.\.)[)\]]/gi, '')
    .replace(/\s*(?:read more|continue reading)\s*[»>]+\s*$/i, '')
    .replace(RE.citation, '')
    .replace(RE.emoji, '')
    .replace(RE.url, 'link')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function cleanTitle(title, site, url) {
  if (!title) return '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch { /* no host */ }
  const parts = title.split(/\s+[|–—\-·•:]\s+/);
  if (parts.length < 2) return norm(title);
  const tail = parts[parts.length - 1];
  const tl = tail.toLowerCase().replace(/[^a-z0-9]/g, '');
  const looksSite = (site && tl.includes(site.toLowerCase().replace(/[^a-z0-9]/g, ''))) || (host && tl && (tl.includes(host) || host.includes(tl))) || (tail.split(' ').length <= 4 && /\b(blog|news|times|post|wikipedia|magazine|journal|review|daily|herald|guardian|zeitung|tagesschau)\b/i.test(tail));
  return norm(looksSite ? parts.slice(0, -1).join(' - ') : title);
}

/** Marks what is not to be heard: type 'other' (page furniture), captions, references; keeps the rest. */
export function cleanForListening(blocks) {
  const out = [];
  let endMatter = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = { ...blocks[i], text: cleanBlockText(blocks[i].text, blocks[i].type) };
    if (!b.text) continue;
    const words = countWords(b.text);
    if (b.type === 'heading' && RE.endMatter.test(b.text)) { endMatter = RE.refHeading.test(b.text) ? 'reference' : 'other'; b.type = 'other'; b.why = 'end-matter heading'; out.push(b); continue; }
    if (b.type === 'heading') endMatter = false;
    if (endMatter) b.type = endMatter;
    if (b.type === 'paragraph' || b.type === 'list-item') {
      if (RE.promo.test(b.text) && words <= 12) { b.type = 'other'; b.why = 'promo or UI'; }
      else if (RE.byDate.test(b.text) && words <= 14 && i < 6) { b.type = 'other'; b.why = 'byline or date'; }
      else if (RE.photoCredit.test(b.text) && words <= 14) { b.type = 'caption'; b.why = 'credit line'; }
      else if (words <= 3 && UI_LABEL.test(b.text)) { b.type = 'other'; b.why = 'UI label'; }
    }
    if (b.type !== 'other' && out.length && out[out.length - 1].text === b.text && words >= 4) { b.type = 'other'; b.why = 'repeated'; }
    out.push(b);
  }
  // pull quotes: a quote repeated in the body is magazine decoration
  const flat = (x) => x.toLowerCase().replace(/[“”‘’"'\s]+/g, ' ').trim();
  for (const q of out) {
    if (q.type !== 'quote') continue;
    const qq = flat(q.text);
    if (qq.split(' ').length < 8) continue;
    const needle = qq.slice(0, 60);
    if (out.some((o) => o !== q && o.type !== 'quote' && flat(o.text).includes(needle))) { q.type = 'other'; q.why = 'pull quote'; }
  }
  // link lists: 3 or more list items in a row that are (almost) all link text (related stories, tags, tables of contents)
  for (let i = 0; i < out.length;) {
    if (out[i].type !== 'list-item') { i++; continue; }
    let j = i;
    while (j < out.length && out[j].type === 'list-item') j++;
    const run = out.slice(i, j);
    const linky = run.filter((x) => (x.ld ?? 0) >= 0.8 && !/[.!?]$/.test(x.text));
    if (run.length >= 3 && linky.length / run.length >= 0.8) run.forEach((x) => { x.type = 'other'; x.why = 'link list'; });
    i = j;
  }
  for (let i = 0; i < out.length - 1; i++) if (out[i].type === 'heading' && out[i + 1].why === 'link list') { out[i].type = 'other'; out[i].why = 'heading of a link list'; }
  return out;
}

const HEARD = new Set(['heading', 'paragraph', 'list-item', 'quote']);
const NOTE = { code: 'Code example skipped.', table: 'Table skipped.' };

// A heading ends in a full stop unless it already ends a sentence ("Why now?"),
// so the voice pauses after it instead of running on into the next sentence.
// A closing colon or dash becomes the full stop, as for the title.
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
export const headingSentence = (text) => (SENTENCE_END.test(text) ? text : text.replace(/\s*[:;,–—-]+$/, '') + '.');

/** Cleaned blocks -> listening text (blocks separated by blank lines; list items one per line). */
export function blocksToText(blocks) {
  const parts = [];
  let prev = null;
  for (const b of blocks) {
    if (NOTE[b.type]) { if (prev !== b.type) parts.push(NOTE[b.type]); prev = b.type; continue; }
    if (!HEARD.has(b.type)) continue;
    if (b.type === 'list-item' && prev === 'list-item') parts[parts.length - 1] += '\n' + b.text;
    else parts.push(b.type === 'heading' ? headingSentence(b.text) : b.text);
    prev = b.type;
  }
  return parts;
}

function finish({ title, byline, site, declared, parts, warnings }) {
  const body = parts.join('\n\n');
  const words = countWords(body);
  const g = guessLang(body.slice(0, 20000));
  const language = g.lang !== 'und' ? g.lang : (declared || 'und');
  if (words < FEW_WORDS) warnings.push(`Only a little text was found (${words} words). The page may be behind a paywall or a login, or built by scripts after it loads. If the page shows more in your browser: open it, select the text, copy it and paste it here.`);
  if (language !== 'und' && !VOICE_LANGUAGES.has(language)) {
    const name = language === 'non-latin' ? 'a language with a non-Latin script' : LANGUAGE_NAMES[language] || language.toUpperCase();
    warnings.push(`This page seems to be in ${name}. Hearshot's voices speak English, German and Spanish, so they will mispronounce it.`);
  }
  const head = [title && title.replace(/[.:]?$/, '.'), byline && `By ${byline.replace(/^(by|von)\s+/i, '')}.`].filter(Boolean);
  return { ok: true, title, byline, site, language, words, minutes: Math.max(1, Math.round(words / WPM)), text: [...head, body].filter(Boolean).join('\n\n'), warnings };
}

const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** The page as a Document, with <base> set so relative links resolve to the page's own address. */
export function parsePage(html, finalUrl, DP) {
  const doc = new DP().parseFromString(String(html ?? ''), 'text/html');
  if (doc.head && !doc.querySelector('base[href]')) {
    const base = doc.createElement('base');
    base.setAttribute('href', finalUrl);
    doc.head.prepend(base);
  } else if (doc.querySelector('base[href]')) {
    const b = doc.querySelector('base[href]');
    try { b.setAttribute('href', new URL(b.getAttribute('href'), finalUrl).href); } catch { b.setAttribute('href', finalUrl); }
  }
  return doc;
}

let readabilityLoad = null;
const loadReadability = () => (readabilityLoad ??= import('@mozilla/readability').then((m) => m.Readability ?? m.default?.Readability));

export async function extractArticle(html, finalUrl, { DOMParser: DP } = {}) {
  try {
    const Parser = DP ?? globalThis.DOMParser;
    if (!Parser) return { ok: false, message: EXTRACT_MESSAGES.failed };
    const Readability = await loadReadability();
    const doc = parsePage(html, finalUrl, Parser);
    const declaredRaw = (doc.documentElement?.getAttribute?.('lang') || '').slice(0, 2).toLowerCase();
    let article;
    try { article = new Readability(doc, { keepClasses: true, charThreshold: 200 }).parse(); } catch { article = null; }
    if (!article || !article.content) return { ok: false, message: EXTRACT_MESSAGES.nothing };
    const inner = new Parser().parseFromString(`<!doctype html><html><body>${article.content}</body></html>`, 'text/html');
    const blocks = cleanForListening(htmlToBlocks(inner.body));
    const site = norm(article.siteName) || siteOf(finalUrl);
    const title = cleanTitle(norm(article.title), site, finalUrl) || (blocks.find((b) => b.type === 'heading')?.text ?? '');
    if (blocks.length && blocks[0].type === 'heading' && blocks[0].text.toLowerCase() === title.toLowerCase()) blocks.shift();
    const byline = norm(article.byline).slice(0, 120);
    const parts = blocksToText(blocks);
    if (!parts.some((p) => !Object.values(NOTE).includes(p))) return { ok: false, message: EXTRACT_MESSAGES.nothing };
    return finish({ title, byline, site, declared: (article.lang || declaredRaw || '').slice(0, 2).toLowerCase(), parts, warnings: [] });
  } catch {
    return { ok: false, message: EXTRACT_MESSAGES.failed };
  }
}

/** A text/plain page: paragraphs are the blank-line-separated parts. */
export function plainTextArticle(text, finalUrl) {
  const parts = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => cleanBlockText(norm(p), 'paragraph')).filter(Boolean);
  if (!parts.length) return { ok: false, message: EXTRACT_MESSAGES.nothing };
  return finish({ title: '', byline: '', site: siteOf(finalUrl), declared: '', parts, warnings: [] });
}
