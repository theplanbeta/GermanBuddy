import fs from 'fs'; import path from 'path';
import { scorePage, tok } from './score.mjs';
import { guessLang } from './hearshot-extract.mjs';
const root = path.resolve('..');
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function corpus(name) {
  if (name === 'aeb') { const g = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); return Object.entries(g).map(([id, v]) => ({ id, url: v.url, gt: v.articleBody, dataset: 'scrapinghub' })); }
  return JSON.parse(fs.readFileSync(root + '/out/manifests/wceb.json'));
}
function pageType(c) {
  const u = c.url.toLowerCase();
  if (c.dataset === 'cleaneval' || c.dataset === 'cleanportaleval') return 'misc web (cleaneval-style)';
  if (/blog|medium\.com|wordpress|blogspot|substack|tumblr/.test(u)) return 'blog';
  if (/\/20\d\d\/\d\d|\/news\/|news|times|post\b|herald|guardian|cnn|bbc|reuters|nytimes|wsj|latimes|slate|vox|verge|wired|cbs|nbc|abc|fox|yahoo|telegraph|independent|mirror|sun\b|dailymail|forbes|bloomberg|politico/.test(u)) return 'news/magazine';
  return 'other site';
}
const bucket = n => n < 150 ? 'short (<150w)' : n < 600 ? 'medium (150-600w)' : 'long (>600w)';
export function run(name, exts, opts = {}) {
  const C = corpus(name); const res = {};
  for (const e of exts) { const f = `${root}/out/${name}/${e}.json`; if (!fs.existsSync(f)) continue; const o = JSON.parse(fs.readFileSync(f)); res[e] = { o, per: C.map(c => scorePage(c.gt, (o[c.id] || {}).text || '')), ms: Object.values(o).map(x => x.ms), err: Object.values(o).filter(x => x.error).length }; }
  return { C, res };
}
const fmt = x => x.toFixed(3);
export function table(name, exts, groupFn) {
  const { C, res } = run(name, exts); const rows = [];
  const groups = groupFn ? [...new Set(C.map(groupFn))].sort() : ['all'];
  for (const g of groups) { const idx = C.map((c, i) => (!groupFn || groupFn(c) === g) ? i : -1).filter(i => i >= 0);
    for (const e of Object.keys(res)) { const v = idx.map(i => res[e].per[i]); const ord = v.map(x => x.order).filter(x => x != null); const sorted = v.map(x => x.f1).sort((a, b) => a - b);
      rows.push({ g, n: idx.length, e, P: mean(v.map(x => x.p)), R: mean(v.map(x => x.r)), F1: mean(v.map(x => x.f1)), med: sorted[sorted.length >> 1], ge9: v.filter(x => x.f1 >= .9).length / v.length, lt5: v.filter(x => x.f1 < .5).length, ord: mean(ord), leak: mean(v.map(x => x.leak)) }); } }
  return rows;
}
export function md(rows, withGroup) {
  const head = (withGroup ? '| group | n ' : '') + '| extractor | P | R | F1 | median F1 | pages F1>=0.9 | pages F1<0.5 | order | listening leak |\n' + (withGroup ? '|---|---|' : '') + '|---|---|---|---|---|---|---|---|---|\n';
  return head + rows.map(r => (withGroup ? `| ${r.g} | ${r.n} ` : '') + `| ${r.e} | ${fmt(r.P)} | ${fmt(r.R)} | ${fmt(r.F1)} | ${fmt(r.med)} | ${(r.ge9 * 100).toFixed(0)}% | ${r.lt5} | ${fmt(r.ord)} | ${fmt(r.leak)} |`).join('\n');
}
if (process.argv[1].endsWith('analyze.mjs')) {
  const ALL = ['baseline_body', 'readability_linkedom', 'readability_jsdom', 'defuddle_linkedom', 'defuddle_jsdom', 'postlight', 'extractus', 'unfluff', 'trafilatura', 'trafilatura_recall', 'readability_lxml', 'goose3', 'newspaper4k', 'justext', 'hs_readability', 'hs_defuddle', 'hs_auto', 'hs_readability_all'];
  let out = '';
  for (const name of ['aeb', 'wceb']) {
    const r = table(name, ALL).sort((a, b) => b.F1 - a.F1); out += `\n## ${name}: overall\n` + md(r, false) + '\n';
  }
  // breakdowns
  const langOf = c => { const l = guessLang(c.gt.slice(0, 3000)).lang; return l === 'en' ? 'English' : l === 'und' ? 'undetermined' : 'non-English'; };
  const core = ['readability_linkedom', 'defuddle_linkedom', 'postlight', 'extractus', 'unfluff', 'trafilatura', 'readability_lxml', 'goose3', 'newspaper4k', 'justext'];
  out += '\n## aeb by language\n' + md(table('aeb', core, langOf), true) + '\n';
  out += '\n## aeb by page type (URL heuristic)\n' + md(table('aeb', core, pageType), true) + '\n';
  out += '\n## aeb by length\n' + md(table('aeb', core, c => bucket(tok(c.gt).length)), true) + '\n';
  out += '\n## wceb by dataset\n' + md(table('wceb', core, c => c.dataset), true) + '\n';
  fs.writeFileSync(root + '/out/report_tables.md', out); console.log(out);
}
