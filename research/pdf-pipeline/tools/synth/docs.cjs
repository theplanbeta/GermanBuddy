// Synthetic document builders. Every element that carries text has data-gt="<type>".
// Types: heading (data-level), paragraph, list-item, caption, footnote, table, figure-text,
// equation, reference, toc, index, other (pull quotes, nav, watermark, junk), neutral (byline,
// sidebar, section headings of skipped sections: allowed either way), header-footer, page-number.
// Running heads / page numbers produced by Paged.js margin boxes or Chromium templates are not
// in the DOM; each builder lists them in `chrome` (strings) so the scorer knows they are skip text.
const fs = require('fs');
const path = require('path');
const { hyphenateSync } = require('hyphen/en-us');
const ARTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../dl/wikitext/articles.json'), 'utf8'));

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hy = (s) => esc(hyphenateSync(s, { minWordLength: 6 }));
const clip = (s, n) => { const w = s.split(' '); return w.length <= n ? s : w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '.'; };

function article(i) { return ARTS[i % ARTS.length]; }
function paras(a, n, maxWords = 140) {
  const out = []; for (const s of a.sections) for (const p of s.paras) { if (out.length >= n) return out; out.push(clip(p, maxWords)); } return out;
}
function sectioned(a, nSec, perSec, maxWords = 120) {
  const secs = a.sections.filter(s => s.paras.length && s.h).slice(0, nSec);
  return secs.map(s => ({ h: s.h, paras: s.paras.slice(0, perSec).map(p => clip(p, maxWords)) }));
}
// insert a footnote / citation after the k-th sentence end of a paragraph (returns html)
function withNote(html, note, kind) {
  const m = html.match(/^(.*?[a-z]{3,}[.,])( |$)/s); if (!m) return html + note;
  const cut = m[1].length - 1;
  return html.slice(0, cut) + note + html.slice(cut);
}
const svgChart = (r, title, labels, unit) => {
  const bars = labels.map((l, i) => { const h = 20 + Math.floor(r() * 90); return `<rect x="${40 + i * 52}" y="${130 - h}" width="34" height="${h}" fill="#7a9cc6"/><text x="${57 + i * 52}" y="146" font-size="9" text-anchor="middle">${esc(l)}</text><text x="${57 + i * 52}" y="${126 - h}" font-size="8" text-anchor="middle">${h}${unit}</text>`; }).join('');
  return `<svg data-gt="figure-text" width="${60 + labels.length * 52}" height="165" viewBox="0 0 ${60 + labels.length * 52} 165" style="display:block;margin:4px auto"><text x="8" y="12" font-size="10" font-weight="bold">${esc(title)}</text><line x1="34" y1="130" x2="${40 + labels.length * 52}" y2="130" stroke="#333"/><line x1="34" y1="20" x2="34" y2="130" stroke="#333"/><text x="30" y="133" font-size="8" text-anchor="end">0</text><text x="30" y="83" font-size="8" text-anchor="end">50</text><text x="30" y="33" font-size="8" text-anchor="end">100</text>${bars}<text x="${30 + labels.length * 26}" y="160" font-size="8" text-anchor="middle">Year of observation</text></svg>`;
};
const table = (r, cols, rows) => `<table data-gt="table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${Array.from({ length: rows }, (_, i) => `<tr><td>${esc(['North', 'South', 'East', 'West', 'Central', 'Coastal', 'Upland', 'Delta'][i % 8])}</td>${cols.slice(1).map(() => `<td>${(r() * 100).toFixed(1)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const eq = (k) => [
  `<math display="block" data-gt="equation"><mi>E</mi><mo>=</mo><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msub><mi>w</mi><mi>i</mi></msub><msup><msub><mi>x</mi><mi>i</mi></msub><mn>2</mn></msup><mo>+</mo><mi>λ</mi><mo>‖</mo><mi>w</mi><mo>‖</mo></math>`,
  `<math display="block" data-gt="equation"><mi>f</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><mrow><mn>1</mn><mo>+</mo><msup><mi>e</mi><mrow><mo>−</mo><mi>k</mi><mi>t</mi></mrow></msup></mrow></mfrac></math>`,
  `<math display="block" data-gt="equation"><mi>P</mi><mo>(</mo><mi>A</mi><mo>|</mo><mi>B</mi><mo>)</mo><mo>=</mo><mfrac><mrow><mi>P</mi><mo>(</mo><mi>B</mi><mo>|</mo><mi>A</mi><mo>)</mo><mi>P</mi><mo>(</mo><mi>A</mi><mo>)</mo></mrow><mrow><mi>P</mi><mo>(</mo><mi>B</mi><mo>)</mo></mrow></mfrac></math>`][k % 3];
const refs = (r, n) => Array.from({ length: n }, (_, i) => `<div data-gt="reference" class="ref">[${i + 1}] ${esc(['A. Smith', 'B. Okafor', 'C. Müller', 'D. Tanaka', 'E. García', 'F. Novak'][i % 6])} and ${esc(['J. Lee', 'K. Brown', 'L. Rossi', 'M. Ivanova'][i % 4])}. ${esc(['On the structure of regional archives', 'A survey of coastal settlement patterns', 'Measuring cultural transmission', 'Quantitative methods for historical sources', 'Notes on early printing'][i % 5])}. <i>Journal of ${esc(['Applied History', 'Field Studies', 'Comparative Methods'][i % 3])}</i>, ${12 + i}(${1 + (i % 4)}):${100 + i * 7}–${110 + i * 7}, ${1998 + i}.</div>`).join('\n');

const BASE_CSS = `body{margin:0} p{margin:0} h1,h2,h3,.cht,.t,.s{text-align:left;text-align-last:auto!important} .ref{font-size:8.5pt;margin:0 0 3pt 0;padding-left:1.6em;text-indent:-1.6em}
 table{border-collapse:collapse;font-size:8.5pt;margin:6pt auto} td,th{border:0.5pt solid #555;padding:1.5pt 4pt}
 figure{margin:6pt 0} .cap{font-size:8.5pt;margin:2pt 0 8pt 0}`;

function paged(css, body, extraHead = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}\n${css}</style>${extraHead}
<script>window.PagedConfig={auto:false,after:()=>{window.__pagedDone=true}};</script>
<script src="/pagedjs/paged.polyfill.js"></script></head><body>${body}</body></html>`;
}
function plain(css, body) { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}\n${css}</style></head><body>${body}</body></html>`; }

// ---------------------------------------------------------------- 1. two-column LaTeX-like paper
function paper2col(seed = 1) {
  const r = rng(seed); const a = article(3); const secs = sectioned(a, 5, 3, 110);
  const title = `${a.title}: A Quantitative Reassessment`;
  let fn = 0; let body = '';
  body += `<div class="top"><h1 data-gt="heading" data-level="1">${esc(title)}</h1><div data-gt="neutral" class="auth">Maria Keller<sup>1</sup>, Tomás Ribeiro<sup>2</sup> and Hannah Osei<sup>1</sup><br><span style="font-size:8.5pt">1 Department of History, University of Lindenfeld &nbsp; 2 Institute for Archival Science, Porto</span></div>
  <div class="abs"><div data-gt="heading" data-level="2" class="abh">Abstract</div><p data-gt="paragraph">${hy(clip(a.sections[0].paras[0], 120))}</p></div></div>`;
  body += `<div class="cols">`;
  secs.forEach((s, si) => {
    body += `<h2 data-gt="heading" data-level="2">${si + 1} ${esc(s.h)}</h2>`;
    s.paras.forEach((p, pi) => {
      let h = hy(p);
      if (pi === 0) h = withNote(h, `<sup data-gt="other">[${1 + Math.floor(r() * 9)}]</sup>`);
      if (pi === 1 && si % 2 === 0) { fn++; h = withNote(h, `<span class="fn" data-gt="footnote">${esc(clip(article(20 + fn).sections[0].paras[0], 28))}</span>`); }
      body += `<p data-gt="paragraph" class="${pi ? 'ind' : ''}">${h}</p>`;
    });
    if (si === 1) body += `<figure>${svgChart(r, 'Settlement counts by period', ['1850', '1870', '1890', '1910', '1930'], '')}<div data-gt="caption" class="cap">Figure 1: Number of recorded settlements per period, as reconstructed from the regional archive.</div></figure>`;
    if (si === 2) body += `<div data-gt="caption" class="cap">Table 1: Summary statistics for the five regions.</div>${table(r, ['Region', 'Mean', 'SD', 'N'], 5)}`;
    if (si === 3) body += `${eq(0)}`;
  });
  body += `<h2 data-gt="neutral">References</h2>${refs(r, 10)}</div>`;
  const css = `@page{size:Letter;margin:20mm 17mm 20mm 17mm;@top-center{content:"${esc(title.slice(0, 50))}";font:italic 8pt 'Liberation Serif'}@bottom-center{content:counter(page);font:9pt 'Liberation Serif'}}
  @page:first{@top-center{content:none}}
  body{font:9.6pt/1.22 'Liberation Serif';text-align:justify;hyphens:manual}
  h1{font-size:16pt;text-align:center;margin:0 0 6pt} .auth{text-align:center;font-size:10pt;margin-bottom:8pt}
  .abs{margin:0 8% 10pt;font-size:9pt} .abh{font-weight:bold;text-align:center}
  .cols{column-count:2;column-gap:7mm} h2{font-size:10.5pt;margin:8pt 0 3pt} p.ind{text-indent:1.2em}
  .fn{float:footnote;font-size:7.5pt} ::footnote-call{font-size:6pt;vertical-align:super} ::footnote-marker{font-size:6.5pt}
  sup{font-size:6.5pt}`;
  return { id: 'syn-paper-2col', kind: 'paper-2col', title, html: paged(css, body), chrome: [title.slice(0, 50)], paged: true };
}

// ---------------------------------------------------------------- 2. Word-like single-column report
function report1col(seed = 2) {
  const r = rng(seed); const a = article(7); const secs = sectioned(a, 6, 3, 130);
  const title = `${a.title} — Programme Review 2026`;
  let body = `<div data-gt="heading" data-level="1" class="t">${esc(title)}</div><div data-gt="neutral" class="sub">Prepared for the Regional Heritage Board · Version 1.3 · March 2026</div>`;
  let n = 0;
  secs.forEach((s, si) => {
    body += `<h2 data-gt="heading" data-level="2">${si + 1}. ${esc(s.h)}</h2>`;
    s.paras.forEach((p, pi) => {
      let h = esc(p);
      if (pi === 0 && si % 2 === 1) { n++; h = withNote(h, `<sup data-gt="other">${n}</sup>`); }
      body += `<p data-gt="paragraph">${h}</p>`;
    });
    if (si === 1) body += `<ul>${['Review the archive catalogue and remove duplicate records', 'Publish the digitised maps under an open licence', 'Train volunteers in basic conservation practice', 'Report progress to the board every quarter'].map(x => `<li data-gt="list-item">${x}</li>`).join('')}</ul>`;
    if (si === 2) body += `<div data-gt="caption" class="cap">Table ${si}: Visitor numbers by site (thousands)</div>${table(r, ['Site', '2023', '2024', '2025'], 6)}`;
    if (si === 4) body += `<ol>${['Secure funding for the second phase.', 'Appoint a project archivist.', 'Agree a data-sharing policy with partner museums.'].map(x => `<li data-gt="list-item">${x}</li>`).join('')}</ol>`;
  });
  // footnotes at end of document as Word "endnotes"
  body += `<div data-gt="neutral" class="enh">Notes</div>`;
  for (let i = 1; i <= n; i++) body += `<div data-gt="footnote" class="en">${i} ${esc(clip(article(30 + i).sections[0].paras[0], 30))}</div>`;
  const css = `@page{size:A4;margin:25mm 25mm 22mm 25mm} body{font:11pt/1.35 Carlito} .t{font:bold 20pt Carlito;color:#1f3864;margin-bottom:4pt} .sub{color:#555;margin-bottom:14pt}
  h2{font:bold 13pt Carlito;color:#2f5496;margin:14pt 0 4pt} p{margin:0 0 8pt} li{margin-bottom:3pt} .cap{font-style:italic;font-size:9.5pt;margin-top:8pt} .enh{font-weight:bold;margin-top:16pt} .en{font-size:9pt;margin-bottom:3pt}`;
  return { id: 'syn-report-word', kind: 'report', title, html: plain(css, body), chrome: ['Regional Heritage Board – Programme Review', 'Page of'], paged: false,
    pdf: { displayHeaderFooter: true, headerTemplate: `<div style="font:8pt Carlito;width:100%;margin:0 25mm;color:#666">Regional Heritage Board – Programme Review</div>`, footerTemplate: `<div style="font:8pt Carlito;width:100%;text-align:right;margin:0 25mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` } };
}

// ---------------------------------------------------------------- 3. book with odd/even running heads, TOC, chapters, footnotes, drop caps, index
function book(seed = 3) {
  const r = rng(seed); const booktitle = 'Rivers, Roads and Records';
  const chs = [article(11), article(12), article(13)].map((a, i) => ({ title: a.title, secs: sectioned(a, 3, 4, 150) }));
  let body = `<section class="titlepage"><div data-gt="heading" data-level="1" class="bt">${booktitle}</div><div data-gt="neutral" class="ba">Essays in regional history</div><div data-gt="neutral" class="ba">Edited by Clara Lindqvist</div></section>`;
  body += `<section class="toc"><div data-gt="neutral" class="toch">Contents</div>${chs.map((c, i) => `<div data-gt="toc" class="tocl"><span>${i + 1} ${esc(c.title)}</span><span class="lead"></span><span class="pn">${3 + i * 5}</span></div>`).join('')}<div data-gt="toc" class="tocl"><span>Index</span><span class="lead"></span><span class="pn">19</span></div></section>`;
  let fn = 0;
  chs.forEach((c, ci) => {
    body += `<section class="chapter"><div data-gt="neutral" class="chn">Chapter ${ci + 1}</div><h1 data-gt="heading" data-level="1" class="cht">${esc(c.title)}</h1>`;
    c.secs.forEach((s, si) => {
      if (si) body += `<h2 data-gt="heading" data-level="2">${esc(s.h)}</h2>`;
      s.paras.forEach((p, pi) => {
        let h = hy(p);
        if (si === 0 && pi === 0) { h = `<span class="drop">${esc(p[0])}</span>` + hy(p.slice(1)); }
        if (pi === 2) { fn++; h = withNote(h, `<span class="fn" data-gt="footnote">${esc(clip(article(40 + fn).sections[0].paras[0], 30))}</span>`); }
        body += `<p data-gt="paragraph" class="${si === 0 && pi === 0 ? 'first' : ''}">${h}</p>`;
        if (si === 1 && pi === 1) body += `<blockquote data-gt="paragraph">${hy(clip(article(50 + ci).sections[0].paras[0], 60))}</blockquote>`;
      });
    });
    body += `</section>`;
  });
  const terms = ['archives', 'bridges', 'canals', 'census records', 'charters', 'ferries', 'harbours', 'land surveys', 'maps', 'mills', 'parish registers', 'railways', 'roads', 'tolls', 'trade routes', 'turnpikes', 'water rights'];
  body += `<section class="index"><h1 data-gt="neutral" class="cht">Index</h1><div class="icol">${terms.map((t, i) => `<div data-gt="index">${t}, ${3 + i % 9}, ${7 + (i * 3) % 11}</div>`).join('')}</div></section>`;
  const chrome = [booktitle, ...chs.map(c => c.title)];
  const css = `@page{size:148mm 210mm;margin:18mm 16mm 18mm 18mm}
  @page:left{@top-left{content:"${booktitle}";font:italic 8.5pt 'Liberation Serif'}@bottom-left{content:counter(page);font:9pt 'Liberation Serif'}}
  @page:right{@top-right{content:string(chap);font:italic 8.5pt 'Liberation Serif'}@bottom-right{content:counter(page);font:9pt 'Liberation Serif'}}
  @page chapter:first{@top-left{content:none}@top-right{content:none}@bottom-right{content:counter(page);font:9pt 'Liberation Serif'}}
  @page front{@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}}
  .titlepage,.toc{page:front;break-after:page} .bt{font:bold 22pt 'Liberation Serif';margin-top:40mm;text-align:center} .ba{text-align:center;margin-top:8pt;font-size:12pt}
  .toch{font:bold 14pt 'Liberation Serif';margin-bottom:10pt} .tocl{display:flex;font-size:10pt;margin:3pt 0} .lead{flex:1;border-bottom:1px dotted #444;margin:0 4px 3px}
  .chapter{page:chapter;break-before:page} .chn{font:10pt 'Liberation Serif';letter-spacing:2px;text-transform:uppercase;margin-top:20mm} .cht{font:bold 17pt 'Liberation Serif';string-set:chap content(text);margin:4pt 0 14pt}
  body{font:10pt/1.32 'Liberation Serif';text-align:justify} p{text-indent:1.3em} p.first{text-indent:0} h2{font:bold 11pt 'Liberation Serif';margin:10pt 0 4pt}
  .drop{float:left;font-size:31pt;line-height:0.9;padding:2pt 3pt 0 0}
  blockquote{margin:5pt 1.5em;font-size:9pt}
  .fn{float:footnote;font-size:8pt;text-align:left} ::footnote-call{font-size:6.5pt;vertical-align:super} ::footnote-marker{font-size:7pt}
  .index{break-before:page} .icol{column-count:2;font-size:9pt}`;
  return { id: 'syn-book', kind: 'book', title: booktitle, html: paged(css, body), chrome, paged: true };
}

// ---------------------------------------------------------------- 4. magazine: 3 columns, pull quotes, sidebar, drop cap
function magazine(seed = 4) {
  const r = rng(seed); const a = article(15); const ps = paras(a, 16, 110);
  const head = a.title.toUpperCase().length < 40 ? `The Long Story of ${a.title}` : a.title;
  let body = `<div class="kicker" data-gt="neutral">FEATURE · HISTORY</div><h1 data-gt="heading" data-level="1">${esc(head)}</h1><div data-gt="neutral" class="deck">${esc(clip(ps[0], 30))}</div><div data-gt="neutral" class="by">By Jonas Whitfield · Photographs by Ana Lucía Prieto</div><div class="cols">`;
  ps.slice(1).forEach((p, i) => {
    let h = hy(p);
    if (i === 0) h = `<span class="drop">${esc(p[0])}</span>` + hy(p.slice(1));
    body += `<p data-gt="paragraph" class="${i === 0 ? 'first' : ''}">${h}</p>`;
    if (i === 2) { const s = p.split(/(?<=\.) /)[0]; body += `<div class="pull" data-gt="other">“${esc(clip(s, 22))}”</div>`; }
    if (i === 4) body += `<div class="side" data-gt="neutral"><b>AT A GLANCE</b><br>${esc(clip(article(16).sections[0].paras[0], 60))}</div>`;
    if (i === 6) body += `<div class="img"></div><div data-gt="caption" class="cap">The old harbour wall at low tide. Much of the original stone was reused in later buildings.</div>`;
    if (i === 9) { const s = p.split(/(?<=\.) /)[0]; body += `<div class="pull" data-gt="other">“${esc(clip(s, 18))}”</div>`; }
    if (i === 6 || i === 11) body += `<h3 data-gt="heading" data-level="3">${esc(['A turning point', 'What came after'][i === 6 ? 0 : 1])}</h3>`;
  });
  body += `</div>`;
  const css = `@page{size:A4;margin:14mm 13mm 16mm 13mm;@bottom-left{content:"HORIZONS MAGAZINE | NOVEMBER 2026";font:7pt 'Liberation Sans';letter-spacing:1px}@bottom-right{content:counter(page);font:bold 9pt 'Liberation Sans'}}
  body{font:9.3pt/1.28 'Liberation Serif';text-align:justify} .kicker{font:bold 8pt 'Liberation Sans';color:#c0392b;letter-spacing:2px} h1{font:bold 30pt/1.05 'Liberation Sans';margin:4pt 0 6pt}
  .deck{font:italic 13pt/1.3 'Liberation Serif';margin-bottom:5pt} .by{font:8pt 'Liberation Sans';margin-bottom:10pt;text-transform:uppercase}
  .cols{column-count:3;column-gap:5mm} p{text-indent:1em} p.first{text-indent:0} .drop{float:left;font:bold 36pt/0.85 'Liberation Sans';padding:2pt 3pt 0 0;color:#c0392b}
  .pull{font:bold italic 14pt/1.2 'Liberation Sans';color:#c0392b;border-top:2px solid #c0392b;border-bottom:2px solid #c0392b;padding:5pt 0;margin:8pt 0;text-align:left}
  .side{background:#eef3f7;padding:6pt;font:8.5pt/1.3 'Liberation Sans';margin:8pt 0;text-align:left} .img{height:110px;background:#9aa;margin:6pt 0 2pt} .cap{font:italic 7.5pt 'Liberation Sans'}
  h3{font:bold 10.5pt 'Liberation Sans';margin:8pt 0 3pt;color:#c0392b}`;
  return { id: 'syn-magazine', kind: 'magazine', title: head, html: paged(css, body), chrome: ['HORIZONS MAGAZINE | NOVEMBER 2026'], paged: true };
}

// ---------------------------------------------------------------- 5. white paper: cover, TOC, numbered headings, charts, callouts, endnotes
function whitepaper(seed = 5) {
  const r = rng(seed); const a = article(18); const secs = sectioned(a, 6, 3, 120);
  const title = `${a.title}: Lessons for Policy`;
  let body = `<section class="cover"><div class="org" data-gt="neutral">INSTITUTE FOR PUBLIC RECORDS</div><div data-gt="heading" data-level="1" class="ct">${esc(title)}</div><div class="cs" data-gt="neutral">White Paper No. 14 · October 2026</div></section>`;
  body += `<section class="tocs"><div data-gt="neutral" class="toch">Table of Contents</div>${secs.map((s, i) => `<div data-gt="toc" class="tocl">${i + 1}. ${esc(s.h)} <span class="dots">............................................</span> ${3 + i}</div>`).join('')}</section>`;
  let en = 0;
  secs.forEach((s, si) => {
    body += `<h2 data-gt="heading" data-level="2">${si + 1}. ${esc(s.h)}</h2>`;
    s.paras.forEach((p, pi) => {
      if (pi === 1 && si < 4) body += `<h3 data-gt="heading" data-level="3">${si + 1}.${pi} ${esc(['Background', 'Evidence', 'Findings', 'Options'][si])}</h3>`;
      let h = esc(p); if (pi === 0) { en++; h = withNote(h, `<sup data-gt="other">${en}</sup>`); }
      body += `<p data-gt="paragraph">${h}</p>`;
    });
    if (si === 0) body += `<div class="call" data-gt="neutral"><b>Key finding:</b> ${esc(clip(a.sections[0].paras[1] || a.sections[0].paras[0], 35))}</div>`;
    if (si === 2) body += `<figure>${svgChart(r, 'Figure 2. Records digitised per year (thousands)', ['2019', '2020', '2021', '2022', '2023', '2024'], 'k')}<div data-gt="caption" class="cap">Source: Institute survey of 42 archives, 2025.</div></figure>`;
    if (si === 3) body += `<div data-gt="caption" class="cap">Table 3. Budget allocation by programme (per cent)</div>${table(r, ['Programme', '2024', '2025', '2026'], 5)}`;
  });
  body += `<h2 data-gt="neutral">Endnotes</h2>`;
  for (let i = 1; i <= en; i++) body += `<div data-gt="footnote" class="en">${i}. ${esc(clip(article(25 + i).sections[0].paras[0], 25))}</div>`;
  const css = `@page{size:Letter;margin:22mm 22mm 22mm 22mm;@bottom-left{content:"Institute for Public Records · White Paper No. 14";font:7.5pt Inter;color:#666}@bottom-right{content:counter(page);font:8pt Inter}}
  @page cover{@bottom-left{content:none}@bottom-right{content:none}} .cover{page:cover;break-after:page;background:#123;color:white;height:230mm;padding:20mm 14mm}
  .org{font:bold 10pt Inter;letter-spacing:3px} .ct{font:bold 28pt/1.15 Inter;margin-top:60mm} .cs{font:12pt Inter;margin-top:10pt}
  .tocs{break-after:page} .toch{font:bold 16pt Inter;margin-bottom:12pt} .tocl{font:10.5pt Inter;margin:5pt 0} .dots{color:#888}
  body{font:10.5pt/1.45 'Liberation Serif'} h2{font:bold 14pt Inter;color:#123;margin:14pt 0 5pt} h3{font:600 11pt Inter;margin:9pt 0 3pt} p{margin:0 0 7pt}
  .call{border-left:4px solid #e67e22;background:#fdf2e9;padding:6pt 10pt;font:10pt Inter;margin:8pt 0} .cap{font:8.5pt Inter;color:#444} .en{font-size:8.5pt;margin-bottom:3pt}`;
  return { id: 'syn-whitepaper', kind: 'report', title, html: paged(css, body), chrome: ['Institute for Public Records · White Paper No. 14'], paged: true };
}

// ---------------------------------------------------------------- 6. legal: line numbers, watermark, Page X of Y
function legal(seed = 6) {
  const a = article(21); const ps = paras(a, 14, 120);
  let body = `<div class="ln" data-gt="page-number">${Array.from({ length: 30 }, (_, i) => `<div>${i + 1}</div>`).join('')}</div><div class="wm" data-gt="other">DRAFT</div><div class="main">`;
  body += `<div data-gt="heading" data-level="1" class="t">AGREEMENT CONCERNING THE ${esc(a.title.toUpperCase())} ARCHIVE</div>`;
  let sec = 0;
  ps.forEach((p, i) => {
    if (i % 3 === 0) { sec++; body += `<div data-gt="heading" data-level="2" class="s">§ ${sec}. ${esc(['Definitions', 'Scope of the Agreement', 'Obligations of the Parties', 'Access to Records', 'Term and Termination'][sec - 1] || 'General Provisions')}</div>`; }
    if (i % 3 === 1) body += `<div data-gt="list-item" class="cl">(a) ${esc(clip(p, 45))}</div><div data-gt="list-item" class="cl">(b) ${esc(clip(ps[(i + 5) % ps.length], 35))}</div>`;
    else body += `<p data-gt="paragraph">${esc(p)}</p>`;
  });
  body += `</div>`;
  const css = `@page{size:Letter;margin:25mm 22mm 25mm 12mm} body{font:12pt/24pt 'Liberation Serif'} .main{margin-left:18mm}
  .ln{position:fixed;left:0;top:0;font:10pt/24pt 'Liberation Serif';color:#444;text-align:right;width:8mm}
  .wm{position:fixed;top:80mm;left:10mm;font:bold 110pt 'Liberation Sans';color:rgba(200,0,0,0.12);transform:rotate(-40deg)}
  .t{font-weight:bold;text-align:center;margin-bottom:0} .s{font-weight:bold} p{text-indent:2em;text-align:justify} .cl{margin-left:2em}`;
  return { id: 'syn-legal', kind: 'legal', title: a.title, html: plain(css, body), chrome: ['Case No. 26-cv-04417', 'Page of', 'DRAFT'], paged: false,
    pdf: { displayHeaderFooter: true, headerTemplate: `<div style="font:8pt 'Liberation Serif';width:100%;text-align:right;margin:0 22mm">Case No. 26-cv-04417</div>`, footerTemplate: `<div style="font:8pt 'Liberation Serif';width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` } };
}

// ---------------------------------------------------------------- 7. slides exported to PDF
function slides(seed = 7) {
  const r = rng(seed); const a = article(23); const secs = sectioned(a, 6, 3, 60);
  let body = `<section class="sl title"><div data-gt="heading" data-level="1" class="h">${esc(a.title)}</div><div data-gt="neutral" class="sub">Quarterly research briefing · Team Archive</div></section>`;
  secs.forEach((s, i) => {
    body += `<section class="sl"><div data-gt="heading" data-level="2" class="h">${esc(s.h)}</div><ul>${s.paras.map(p => `<li data-gt="list-item">${esc(clip(p.split(/(?<=\.) /)[0], 22))}</li>`).join('')}</ul>`;
    if (i % 2 === 1) body += `<div class="chart">${svgChart(r, 'Share of catalogued items', ['A', 'B', 'C', 'D'], '%')}</div>`;
    body += `<div class="foot" data-gt="header-footer">Team Archive · Confidential</div><div class="num" data-gt="page-number">${i + 2}</div></section>`;
  });
  const css = `@page{size:254mm 142.9mm;margin:0} body{font:18pt/1.3 Inter} .sl{width:254mm;height:142.9mm;position:relative;box-sizing:border-box;padding:14mm 16mm;break-after:page;overflow:hidden}
  .title .h{font:bold 34pt Inter;margin-top:30mm} .sub{font-size:16pt;color:#555} .h{font:bold 26pt Inter;color:#0b3d91;margin-bottom:8mm} ul{margin:0;padding-left:8mm;width:58%} li{margin-bottom:4mm;font-size:16pt}
  .chart{position:absolute;right:12mm;top:40mm;transform:scale(1.3);transform-origin:top right} .foot{position:absolute;bottom:6mm;left:16mm;font-size:9pt;color:#777} .num{position:absolute;bottom:6mm;right:16mm;font-size:9pt;color:#777}`;
  return { id: 'syn-slides', kind: 'slides', title: a.title, html: plain(css, body), chrome: ['Team Archive · Confidential'], paged: false, pdf: { preferCSSPageSize: true } };
}

// ---------------------------------------------------------------- 8. web article printed from browser (with Chrome's own header/footer)
function webprint(seed = 8) {
  const a = article(27); const secs = sectioned(a, 4, 3, 120);
  let body = `<nav data-gt="other" class="nav">Home  News  Culture  Science  Opinion  Subscribe  Sign in</nav><div data-gt="other" class="crumb">Home › Culture › History</div>`;
  body += `<article><h1 data-gt="heading" data-level="1">${esc(a.title)}: what the archives tell us</h1><div data-gt="neutral" class="meta">By Priya Raman · 12 November 2026 · 8 min read</div><div data-gt="other" class="share">Share  Facebook  X  LinkedIn  Email  Copy link</div>`;
  body += `<p data-gt="paragraph">${esc(clip(a.sections[0].paras[0], 120))}</p>`;
  secs.forEach((s, i) => {
    body += `<h2 data-gt="heading" data-level="2">${esc(s.h)}</h2>`;
    s.paras.forEach((p, j) => { body += `<p data-gt="paragraph">${esc(p)}</p>`; if (i === 1 && j === 0) body += `<div data-gt="other" class="ad">Advertisement</div><div data-gt="other" class="rel">Read more: How a lost map changed a city’s history</div>`; });
  });
  body += `</article><aside data-gt="other" class="aside"><b>Most popular</b><ol><li>Ten forgotten railway lines</li><li>The quiet return of the canal boat</li><li>Why old maps were wrong on purpose</li></ol></aside><footer data-gt="other" class="foot">© 2026 The Daily Ledger · Privacy policy · Terms of use · Cookie settings · Contact us</footer>`;
  const css = `@page{size:A4;margin:15mm 12mm} body{font:12pt/1.55 Georgia,'Liberation Serif';color:#111} .nav{font:bold 10pt 'Liberation Sans';border-bottom:1px solid #ccc;padding:4pt 0;word-spacing:14pt} .crumb{font:9pt 'Liberation Sans';color:#666;margin:6pt 0}
  h1{font:bold 26pt/1.15 'Liberation Sans'} .meta,.share{font:9.5pt 'Liberation Sans';color:#555;margin-bottom:8pt} .share{word-spacing:10pt} p{margin:0 0 11pt} h2{font:bold 16pt 'Liberation Sans';margin:16pt 0 6pt}
  .ad{font:8pt 'Liberation Sans';color:#999;text-align:center;border:1px dashed #ccc;padding:20pt;margin:10pt 0} .rel{font:bold 11pt 'Liberation Sans';color:#0645ad;margin:0 0 11pt}
  .aside{font:10pt 'Liberation Sans';border-top:3px solid #111;margin-top:12pt} .foot{font:8.5pt 'Liberation Sans';color:#666;margin-top:12pt;border-top:1px solid #ccc}`;
  const t = `${a.title}: what the archives tell us | The Daily Ledger`;
  return { id: 'syn-webprint', kind: 'web', title: t, html: plain(css, body).replace('<head>', `<head><title>${esc(t)}</title>`), chrome: [t, 'https://www.dailyledger.example/culture/history/archives-story', '11/12/26, 10:42 AM'], paged: false,
    pdf: { displayHeaderFooter: true, headerTemplate: `<div style="font:8px Arial;width:100%;display:flex;justify-content:space-between;margin:0 10mm"><span>11/12/26, 10:42 AM</span><span class="title"></span></div>`, footerTemplate: `<div style="font:8px Arial;width:100%;display:flex;justify-content:space-between;margin:0 10mm"><span>https://www.dailyledger.example/culture/history/archives-story</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>` } };
}

// ---------------------------------------------------------------- 9. colourful textbook: objectives box, margin notes, exercises, sidebar
function textbook(seed = 9) {
  const r = rng(seed); const a = article(31); const secs = sectioned(a, 4, 3, 110);
  let body = `<div class="unit" data-gt="neutral">UNIT 4</div><h1 data-gt="heading" data-level="1">${esc(a.title)}</h1>`;
  body += `<div class="obj" data-gt="other"><b>Learning objectives</b><br>After this lesson you will be able to: describe the main events; explain their causes; evaluate the sources.</div>`;
  secs.forEach((s, i) => {
    body += `<h2 data-gt="heading" data-level="2">4.${i + 1} ${esc(s.h)}</h2>`;
    s.paras.forEach((p, j) => {
      body += `<div class="row"><p data-gt="paragraph">${hy(p)}</p>${j === 0 ? `<div class="mn" data-gt="other"><b>Key term</b><br>${esc(s.h.split(' ')[0])}: a word used in this section.</div>` : ''}</div>`;
    });
    if (i === 1) body += `<div class="dyk" data-gt="neutral"><b>Did you know?</b> ${esc(clip(article(32).sections[0].paras[0], 45))}</div>`;
    if (i === 2) body += `<figure>${svgChart(r, 'Population of the region', ['1700', '1750', '1800', '1850'], 'k')}<div data-gt="caption" class="cap">Figure 4.${i}: Estimated population of the region over 150 years.</div></figure>`;
  });
  body += `<div class="ex"><div data-gt="heading" data-level="2" class="exh">Check your understanding</div>${['Summarise the main argument of this unit in two sentences.', 'Which source would you trust most, and why?', 'Draw a timeline of the events described in section 4.2.'].map((q, i) => `<div data-gt="list-item">${i + 1}. ${q}</div>`).join('')}</div>`;
  const css = `@page{size:A4;margin:16mm 14mm 18mm 14mm;@bottom-center{content:counter(page);font:bold 10pt Inter;color:#fff;background:#2a9d8f;padding:2pt 8pt}@top-right{content:"Unit 4 · History in Context";font:8pt Inter;color:#2a9d8f}}
  body{font:10.5pt/1.45 'Liberation Sans'} .unit{font:bold 11pt Inter;color:#2a9d8f;letter-spacing:3px} h1{font:bold 24pt Inter;color:#264653;margin:2pt 0 8pt}
  .obj{background:#e9f5f3;border-radius:6pt;padding:6pt 10pt;margin-bottom:8pt;font-size:9.5pt} h2{font:bold 13pt Inter;color:#e76f51;margin:12pt 0 4pt}
  .row{display:flex;gap:6mm} .row p{flex:1;margin:0 0 6pt;text-align:justify} .mn{width:38mm;font:8.5pt Inter;color:#264653;border-left:2px solid #e76f51;padding-left:4pt;flex:none}
  .dyk{background:#fff3cd;padding:6pt 10pt;font-size:9.5pt;margin:6pt 0;width:70%} .cap{font:italic 8.5pt Inter} .ex{border:2px solid #264653;padding:6pt 10pt;margin-top:10pt} .exh{font:bold 12pt Inter}`;
  return { id: 'syn-textbook', kind: 'textbook', title: a.title, html: paged(css, body), chrome: ['Unit 4 · History in Context'], paged: true };
}

// ---------------------------------------------------------------- 10. humanities article with heavy footnotes (Chicago style)
function footnoteHeavy(seed = 10) {
  const a = article(35); const ps = paras(a, 12, 130);
  let body = `<h1 data-gt="heading" data-level="1">${esc(a.title)} and the Making of Memory</h1><div data-gt="neutral" class="au">Elena Vasquez</div>`;
  let fn = 0;
  ps.forEach((p, i) => {
    if (i === 4 || i === 8) body += `<h2 data-gt="heading" data-level="2">${['II', 'III'][i === 4 ? 0 : 1]}</h2>`;
    let h = hy(p);
    const k = 1 + (i % 3);
    for (let j = 0; j < k; j++) { fn++; const note = `<span class="fn" data-gt="footnote">${esc(clip(article(36 + fn).sections[0].paras[0], 18 + (fn % 4) * 10))}</span>`; const idx = h.split('. ').slice(0, j + 1).join('. ').length; h = h.slice(0, idx) + (idx < h.length ? '.' : '') + note + h.slice(idx + (idx < h.length ? 1 : 0)); }
    body += `<p data-gt="paragraph">${h}</p>`;
  });
  const css = `@page{size:152mm 229mm;margin:20mm 17mm;@top-center{content:"JOURNAL OF MEMORY STUDIES";font:7.5pt 'Liberation Serif';letter-spacing:1.5px}@bottom-center{content:counter(page);font:9pt 'Liberation Serif'}}
  @page:first{@top-center{content:none}}
  body{font:10.5pt/1.35 'Liberation Serif';text-align:justify} h1{font:bold 16pt 'Liberation Serif';text-align:center} .au{text-align:center;font-variant:small-caps;margin-bottom:12pt}
  h2{text-align:center;font:11pt 'Liberation Serif';margin:10pt 0 4pt} p{text-indent:1.5em}
  .fn{float:footnote;font-size:8.3pt;line-height:1.25} ::footnote-call{font-size:6.5pt;vertical-align:super} ::footnote-marker{font-size:7pt} @footnote{border-top:0.5pt solid black;padding-top:3pt;margin-top:6pt}`;
  return { id: 'syn-footnotes', kind: 'paper-1col', title: a.title, html: paged(css, body), chrome: ['JOURNAL OF MEMORY STUDIES'], paged: true };
}

// ---------------------------------------------------------------- 11. lecture notes with equations and theorem boxes
function mathNotes(seed = 11) {
  const r = rng(seed); const a = article(38); const ps = paras(a, 9, 90);
  let body = `<h1 data-gt="heading" data-level="1">Lecture 7: Models of Growth</h1><div data-gt="neutral" class="au">Course notes · Applied Modelling · Autumn term</div>`;
  ps.forEach((p, i) => {
    if (i % 3 === 0) body += `<h2 data-gt="heading" data-level="2">7.${i / 3 + 1} ${esc(['Logistic growth', 'Regularised estimation', 'Conditional probability'][i / 3])}</h2>`;
    body += `<p data-gt="paragraph">${hy(p)}</p>`;
    if (i % 3 === 1) body += `${eq(i)}<div class="eqn" data-gt="equation">(7.${i})</div>`;
    if (i === 5) body += `<div class="thm"><b data-gt="neutral">Theorem 7.1.</b> <span data-gt="paragraph">${esc(clip(ps[0], 30))}</span></div>`;
  });
  const css = `@page{size:A4;margin:24mm 26mm;@bottom-center{content:"— " counter(page) " —";font:9pt 'Liberation Serif'}@top-left{content:"Applied Modelling";font:italic 8pt 'Liberation Serif'}@top-right{content:"Lecture 7";font:italic 8pt 'Liberation Serif'}}
  body{font:11pt/1.4 'Liberation Serif';text-align:justify} h1{font:bold 17pt 'Liberation Serif'} .au{font-style:italic;margin-bottom:10pt} h2{font:bold 12.5pt 'Liberation Serif';margin:12pt 0 4pt} p{margin:0 0 6pt}
  math[display=block]{font-size:13pt;margin:4pt 0} .eqn{text-align:right;margin-top:-22pt;margin-bottom:8pt} .thm{border:0.6pt solid #000;padding:5pt 8pt;margin:8pt 0;font-style:italic}`;
  return { id: 'syn-math', kind: 'lecture-notes', title: 'Lecture 7', html: paged(css, body), chrome: ['Applied Modelling', 'Lecture 7'], paged: true };
}

// ---------------------------------------------------------------- 12. newsletter: 2 columns with spanning heads, boxed items, list
function newsletter(seed = 12) {
  const r = rng(seed); const a1 = article(41), a2 = article(43);
  let body = `<div class="mast" data-gt="neutral">THE VALLEY BULLETIN</div><div class="issue" data-gt="neutral">Issue 87 · Autumn 2026 · Free to members</div>`;
  for (const [k, a] of [[0, a1], [1, a2]]) {
    body += `<h1 data-gt="heading" data-level="1">${esc(a.title)}</h1><div class="cols">`;
    paras(a, 6, 100).forEach((p, i) => { body += `<p data-gt="paragraph">${hy(p)}</p>`; if (k === 0 && i === 2) body += `<div class="box" data-gt="neutral"><b>Diary dates</b><br>14 Dec – Winter walk, 10:00 at the bridge<br>18 Jan – Talk: Mills of the valley<br>22 Feb – AGM in the village hall</div>`; });
    body += `</div>`;
  }
  body += `<div class="cols"><h2 data-gt="heading" data-level="2">Members’ notices</h2><ul>${['The library is open on Tuesdays and Saturdays.', 'Subscriptions are due by the end of January.', 'Volunteers are needed for the spring clean-up.'].map(x => `<li data-gt="list-item">${x}</li>`).join('')}</ul></div>`;
  const css = `@page{size:A4;margin:15mm;@bottom-center{content:"The Valley Bulletin · Issue 87 · page " counter(page);font:7.5pt 'Liberation Sans';color:#555}}
  body{font:10pt/1.35 'DejaVu Serif';text-align:justify} .mast{font:bold 30pt 'Liberation Serif';text-align:center;border-bottom:3px double #000} .issue{text-align:center;font:9pt 'Liberation Sans';margin:3pt 0 10pt}
  h1{font:bold 17pt 'Liberation Sans';column-span:all;margin:10pt 0 5pt;border-bottom:1px solid #999} h2{font:bold 12pt 'Liberation Sans'} .cols{column-count:2;column-gap:7mm} p{margin:0 0 6pt}
  .box{border:1px solid #444;padding:5pt;font:9pt 'Liberation Sans';margin:6pt 0;break-inside:avoid;text-align:left}`;
  return { id: 'syn-newsletter', kind: 'newsletter', title: 'The Valley Bulletin', html: paged(css, body), chrome: ['The Valley Bulletin · Issue 87 · page'], paged: true };
}

module.exports = { builders: [paper2col, report1col, book, magazine, whitepaper, legal, slides, webprint, textbook, footnoteHeavy, mathNotes, newsletter] };
