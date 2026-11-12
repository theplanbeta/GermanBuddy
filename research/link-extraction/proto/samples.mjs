import fs from 'fs'; import zlib from 'zlib'; import path from 'path';
import { parseHTML } from 'linkedom';
import { extractForListening, renderSpeech, WPM } from './hearshot-extract.mjs';
import { htmlToText } from './lib-text.mjs';
const root = path.resolve('..'); const aeb = id => { const g = JSON.parse(fs.readFileSync(root + '/corpora/article-extraction-benchmark/ground-truth.json')); const k = Object.keys(g).find(x => x.startsWith(id)); return { url: g[k].url.replace(/#.*$/, ''), html: zlib.gunzipSync(fs.readFileSync(`${root}/corpora/article-extraction-benchmark/html/${k}.html.gz`)).toString('utf8') }; };
const rdb = (d, url) => ({ url, html: fs.readFileSync(`${root}/corpora/readability/test/test-pages/${d}/source.html`, 'utf8') });
const S = [
  ['1-news-article', 'News article (Los Angeles Times, 2019 snapshot)', aeb('8634d1211c3f')],
  ['2-blog-post', 'Blog post (GiveWell blog, 2018 snapshot)', aeb('ad9e9e596f21')],
  ['3-wikipedia', 'Wikipedia article ("Mozilla", old snapshot)', rdb('wikipedia', 'https://en.wikipedia.org/wiki/Mozilla')],
  ['4-documentation', 'Documentation / technical blog (V8 blog, code listings)', rdb('v8-blog', 'https://v8.dev/blog/')],
  ['5-long-essay', 'Long essay (Slate, 3,500+ words, 2019 snapshot)', aeb('851498a2b9f4')],
];
fs.mkdirSync(root + '/samples', { recursive: true }); let index = '# Hearshot link-to-listening: before / after samples\n\nFor each page: "BEFORE" is all visible text a naive reader would speak (menus, ads, footers included, scripts removed). "AFTER" is what Hearshot would read with default settings. Pages are saved 2018-2019 snapshots used for testing (no live fetching was possible from this machine).\n\n';
const origErr = console.error; console.error = () => {};
for (const [slug, title, p] of S) {
  const { document } = parseHTML(p.html); document.querySelectorAll('script,style,noscript,template').forEach(e => e.remove());
  const before = htmlToText(document.body ? document.body.innerHTML : '');
  const r = await extractForListening(p.html, p.url); const spoken = r.blocks.filter(b => !b.skip);
  const speak = (b) => b.type === 'heading' ? `\n## ${b.text}\n` : b.type === 'quote' ? `    "${b.text}"` : b.type === 'list-item' ? `  - ${b.text}` : b.text;
  const afterText = renderSpeech(r).map(sg => sg.kind === 'heading' ? `\n## ${sg.text}\n` : sg.kind === 'list-item' ? `  - ${sg.text}` : sg.kind === 'quote' ? `    ${sg.text}` : sg.kind === 'skip-note' || sg.kind.startsWith('quote-') ? `[${sg.text}]` : sg.text).join('\n').replace(/\n{3,}/g, '\n\n');
  const dropped = {}; for (const b of r.blocks.filter(b => b.skip)) { const k = b.type + (b.why ? ` (${b.why})` : ''); (dropped[k] ||= []).push(b.text); }
  const wcount = s => (s.match(/\S+/g) || []).length;
  let md = `# ${title}\n\nSource: ${p.url}\nExtractor chosen: ${r.meta.extractor} (candidates: ${r.meta.extractorsTried.map(x => `${x.name} ${x.words}w`).join(', ')})\nLanguage: ${r.meta.lang}${r.warnings.length ? '\nWarnings: ' + r.warnings.join(' | ') : ''}\n\n| | words | listening time at ${WPM} wpm |\n|---|---|---|\n| BEFORE (whole page text) | ${wcount(before)} | ${Math.round(wcount(before) / WPM)} min |\n| AFTER (default listening text) | ${wcount(afterText)} | ${Math.round(wcount(afterText) / WPM)} min |\n\n## What Hearshot announces first\n\n> ${r.meta.announce || '(nothing found)'}\n\n## BEFORE: first 900 characters of raw page text\n\n\`\`\`\n${before.slice(0, 900)}\n\`\`\`\n\n## AFTER: first 1,800 characters of the listening text\n\n${afterText.slice(0, 1800)}\n\n## AFTER: last 600 characters\n\n${afterText.slice(-600)}\n\n## Left out by default (counts, with examples)\n\n`;
  for (const [k, v] of Object.entries(dropped).sort((a, b) => b[1].length - a[1].length)) md += `- **${k}**: ${v.length} block(s), e.g. "${v[0].replace(/\s+/g, ' ').slice(0, 110)}"${v[1] ? `; "${v[1].replace(/\s+/g, ' ').slice(0, 80)}"` : ''}\n`;
  fs.writeFileSync(`${root}/samples/${slug}.md`, md); index += `\n---\n\n` + md.replace(/^# /, '# ').replace(/\n## /g, '\n### ').replace(/^# /, '## ');
  console.log(slug, r.meta.extractor, 'before', wcount(before), 'after', wcount(afterText), 'minutes', r.meta.listenMinutes, r.warnings);
}
fs.writeFileSync(root + '/samples/ALL-SAMPLES.md', index);
