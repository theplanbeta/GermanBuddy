// EPUB, DOCX, HTML, Markdown and plain text -> the same block model as PDFs.
// Runs on the main thread (needs DOMParser); pass `domParser` to run elsewhere (tests use linkedom-free
// fallbacks only for text and markdown). Packages: fflate (MIT, unzip), mammoth (BSD-2-Clause, DOCX),
// @mozilla/readability (Apache-2.0, web articles), marked (MIT, Markdown).
import { unzipSync, strFromU8 } from 'fflate';

export function formatOf(name = '', bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = strFromU8(u8.subarray(0, 64), true);
  if (head.startsWith('%PDF')) return 'pdf';
  if (u8[0] === 0x50 && u8[1] === 0x4b) { // zip
    if (strFromU8(u8.subarray(30, 58), true).includes('mimetypeapplication/epub+zip')) return 'epub';
    if (/\.epub$/i.test(name)) return 'epub';
    if (/\.docx$/i.test(name) || strFromU8(u8.subarray(0, Math.min(u8.length, 4000)), true).includes('word/')) return 'docx';
  }
  if (/\.(md|markdown)$/i.test(name)) return 'md';
  if (/\.html?$/i.test(name) || /^\s*<(!doctype|html|\?xml)/i.test(head)) return 'html';
  return 'txt';
}

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'TABLE', 'PRE', 'DT', 'DD', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'MATH', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'FIGURE', 'IMG', 'HR', 'BODY', 'MAIN', 'DL']);
const epubType = (el) => (el.getAttribute?.('epub:type') || el.getAttribute?.('role') || '').toLowerCase();
const isNote = (el) => /footnote|endnote|rearnote|doc-footnote|doc-endnote/.test(epubType(el)) || /(^|\s)(footnotes?|endnotes?)(\s|$)/i.test(el.className || '') || /^(footnote|fn|endnote)[-_]?\d+/i.test(el.id || '');
const isNoteRef = (el) => /noteref|doc-noteref/.test(epubType(el)) || (el.tagName === 'A' && /^#(fn|footnote|note|endnote)/i.test(el.getAttribute('href') || '')) || (el.tagName === 'SUP' && el.querySelector?.('a[href^="#"]'));

function textOf(el) {
  let t = '';
  const walk = (n) => {
    if (n.nodeType === 3) { t += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    if (isNoteRef(n)) return;                               // footnote markers are not read
    if (n.tagName === 'BR') { t += ' '; return; }
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(n.tagName)) return;
    if (n.tagName === 'IMG') { const alt = n.getAttribute('alt'); if (alt) t += ' ' + alt + ' '; return; }
    for (const c of n.childNodes) walk(c);
    if (BLOCK_TAGS.has(n.tagName)) t += ' ';
  };
  walk(el);
  return t.replace(/\s+/g, ' ').trim();
}

/** Walk an HTML/XHTML document body into blocks. */
export function htmlToBlocks(root, { page = 1, prefix = 'h' } = {}) {
  const blocks = []; let n = 0;
  const push = (type, el, extra = {}) => { const text = textOf(el); if (text) blocks.push({ page, blockId: `${prefix}${page}-b${n++}`, type, text, bbox: null, confidence: 0.95, reason: 'html-' + el.tagName.toLowerCase(), source: 'struct', ...extra }); };
  const visit = (el, ctx = {}) => {
    if (el.nodeType !== 1) return;
    const tag = el.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD'].includes(tag)) return;
    if (isNote(el)) { if (['OL', 'UL', 'SECTION', 'DIV', 'ASIDE'].includes(tag) && el.querySelector('li, p')) { for (const c of el.querySelectorAll('li, p')) push('footnote', c); } else push('footnote', el); return; }
    if (tag === 'NAV') { const isToc = /toc/.test(epubType(el)) || !!el.querySelector('ol a, ul a'); for (const c of el.querySelectorAll('li, h1, h2, p')) if (!c.querySelector('li')) push(isToc ? 'toc' : 'other', c); return; }
    if (tag === 'HEADER' || tag === 'FOOTER') { if (ctx.page) { visitChildren(el, ctx); return; } push('other', el); return; }
    if (/^H[1-6]$/.test(tag)) { push('heading', el, { level: +tag[1] }); return; }
    if (tag === 'P' || tag === 'DT' || tag === 'DD') { push(ctx.inQuote ? 'paragraph' : 'paragraph', el); return; }
    if (tag === 'LI') { if (el.querySelector('p, ul, ol')) { visitChildren(el, ctx); return; } push('list-item', el); return; }
    if (tag === 'FIGCAPTION' || tag === 'CAPTION') { push('caption', el); return; }
    if (tag === 'TABLE') { push('table', el); return; }
    if (tag === 'PRE') { push('other', el, { reason: 'html-pre' }); return; }
    if (tag === 'MATH') { push('equation', el); return; }
    if (tag === 'IMG') { if (el.getAttribute('alt')) push('figure-text', el); return; }
    if (tag === 'ASIDE') { push('other', el, { reason: 'html-aside' }); return; }
    if (tag === 'BLOCKQUOTE') { visitChildren(el, { ...ctx, inQuote: true }); if (!el.querySelector('p')) push('paragraph', el); return; }
    // container: if it has direct text, treat it as a paragraph; else descend
    const direct = [...el.childNodes].some(c => c.nodeType === 3 && c.nodeValue.trim()) || [...el.children].every(c => !BLOCK_TAGS.has(c.tagName.toUpperCase()));
    if (direct && !['BODY', 'MAIN', 'ARTICLE', 'SECTION'].includes(tag)) { push('paragraph', el); return; }
    visitChildren(el, ctx);
  };
  const visitChildren = (el, ctx) => { for (const c of el.children) visit(c, ctx); };
  visit(root.body || root.documentElement || root, { page: true });
  return blocks;
}

function parse(html, type = 'text/html', domParser) { return (domParser || new DOMParser()).parseFromString(html, type); }

export async function openOtherFormat(fmt, bytes, name = '', { domParser, readability = true } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const t0 = performance.now();
  let pages = [], stats = { format: fmt, title: null };
  if (fmt === 'docx') {
    const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
    const r = await mammoth.convertToHtml({ arrayBuffer: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) });
    const doc = parse(`<body>${r.value}</body>`, 'text/html', domParser);
    // mammoth puts footnotes/endnotes in <ol><li id="footnote-1"> at the end
    for (const li of doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]')) { li.setAttribute('epub:type', 'footnote'); li.querySelectorAll('a[href^="#footnote-ref"], a[href^="#endnote-ref"]').forEach(a => a.remove()); }
    pages = [{ page: 1, blocks: htmlToBlocks(doc, { prefix: 'd' }), warnings: r.messages.filter(m => m.type === 'warning').slice(0, 5).map(m => ({ code: 'docx', message: m.message })) }];
  } else if (fmt === 'epub') {
    const files = unzipSync(u8);
    const container = strFromU8(files['META-INF/container.xml']);
    const opfPath = container.match(/full-path="([^"]+)"/)[1]; const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
    const opf = parse(strFromU8(files[opfPath]), 'application/xml', domParser);
    stats.title = opf.querySelector('metadata title, title')?.textContent || null;
    const manifest = new Map([...opf.querySelectorAll('manifest > item')].map(i => [i.getAttribute('id'), { href: i.getAttribute('href'), props: i.getAttribute('properties') || '', type: i.getAttribute('media-type') }]));
    const spine = [...opf.querySelectorAll('spine > itemref')].filter(r => r.getAttribute('linear') !== 'no').map(r => manifest.get(r.getAttribute('idref'))).filter(Boolean);
    let k = 0;
    for (const item of spine) {
      const path = decodeURIComponent(base + item.href).replace(/[^/]+\/\.\.\//g, ''); const f = files[path]; if (!f) continue; k++;
      const doc = parse(strFromU8(f), item.type === 'application/xhtml+xml' ? 'application/xhtml+xml' : 'text/html', domParser);
      const blocks = htmlToBlocks(doc, { page: k, prefix: 'e' });
      if (item.props.includes('nav')) blocks.forEach(b => { b.type = 'toc'; });
      pages.push({ page: k, label: item.href, blocks, warnings: [] });
    }
  } else if (fmt === 'html') {
    const html = strFromU8(u8);
    let doc = parse(html, 'text/html', domParser);
    stats.title = doc.title || null;
    if (readability) {
      try { const { Readability } = await import('@mozilla/readability'); const art = new Readability(doc.cloneNode(true), { keepClasses: false }).parse(); if (art && art.content && art.textContent.length > 200) { doc = parse(`<body><h1>${art.title || ''}</h1>${art.content}</body>`, 'text/html', domParser); stats.readability = true; } } catch (e) { stats.readabilityError = String(e); }
    }
    pages = [{ page: 1, blocks: htmlToBlocks(doc, { prefix: 'w' }), warnings: [] }];
  } else if (fmt === 'md') {
    const { marked } = await import('marked');
    const doc = parse(`<body>${marked.parse(strFromU8(u8))}</body>`, 'text/html', domParser);
    pages = [{ page: 1, blocks: htmlToBlocks(doc, { prefix: 'm' }), warnings: [] }];
  } else {
    pages = [{ page: 1, blocks: textToBlocks(strFromU8(u8)), warnings: [] }];
  }
  stats.ms = performance.now() - t0; stats.pages = pages.length;
  return { stats, pages };
}

/** Plain text: blank-line paragraphs; hard-wrapped lines are joined; short all-caps / "Chapter" lines are headings. */
export function textToBlocks(txt) {
  const paras = txt.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const blocks = []; let n = 0;
  for (const p of paras) {
    const lines = p.split('\n').map(l => l.trim()).filter(Boolean); if (!lines.length) continue;
    const one = lines.join(' ').replace(/(\p{L})-\s(\p{Ll})/gu, '$1$2');
    const isHead = lines.length === 1 && one.length < 70 && (/^(chapter|part|book|kapitel|teil)\b/i.test(one) || (one === one.toUpperCase() && /\p{Lu}{3}/u.test(one)) || /^#{1,6}\s/.test(one));
    const isList = lines.every(l => /^([-*•]|\d+[.)])\s/.test(l));
    if (isList) { for (const l of lines) blocks.push({ page: 1, blockId: `t1-b${n++}`, type: 'list-item', text: l.replace(/^([-*•]|\d+[.)])\s+/, ''), bbox: null, confidence: 0.8, reason: 'txt-list', source: 'struct' }); continue; }
    blocks.push({ page: 1, blockId: `t1-b${n++}`, type: isHead ? 'heading' : 'paragraph', level: isHead ? 1 : undefined, text: one.replace(/^#{1,6}\s/, ''), bbox: null, confidence: 0.8, reason: isHead ? 'txt-heading' : 'txt-paragraph', source: 'struct' });
  }
  return blocks;
}
