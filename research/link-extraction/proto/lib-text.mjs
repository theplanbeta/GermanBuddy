import { parseHTML } from 'linkedom';
const BLOCK = 'p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote,pre,figcaption,section,article,ul,ol,table,dd,dt,br';
export function htmlToText(html) {
  if (!html) return '';
  const { document } = parseHTML('<!doctype html><html><body>' + html + '</body></html>');
  document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
  document.querySelectorAll(BLOCK).forEach(e => { e.after(document.createTextNode('\n')); });
  return (document.body.textContent || '').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
