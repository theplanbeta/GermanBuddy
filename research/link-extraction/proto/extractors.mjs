import { parseHTML } from 'linkedom';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { Defuddle } from 'defuddle/node';
import { htmlToText } from './lib-text.mjs';

const vc = new VirtualConsole(); // silence CSS errors
export const X = {
  baseline_body: async (html, url) => {
    const { document } = parseHTML(html);
    document.querySelectorAll('script,style,noscript').forEach(e => e.remove());
    return { text: htmlToText(document.body ? document.body.innerHTML : '') };
  },
  readability_linkedom: async (html, url) => {
    const { document } = parseHTML(html);
    const r = new Readability(document, { keepClasses: false }).parse();
    return r ? { text: htmlToText(r.content), title: r.title, byline: r.byline, lang: r.lang, site: r.siteName, date: r.publishedTime } : { text: '' };
  },
  readability_jsdom: async (html, url) => {
    const dom = new JSDOM(html, { url, virtualConsole: vc });
    const r = new Readability(dom.window.document).parse();
    dom.window.close();
    return r ? { text: htmlToText(r.content), title: r.title, byline: r.byline, lang: r.lang } : { text: '' };
  },
  defuddle_linkedom: async (html, url) => {
    const { document } = parseHTML(html);
    const r = await Defuddle(document, url, {});
    return { text: htmlToText(r.content), title: r.title, byline: r.author, date: r.published, site: r.site, lang: r.language };
  },
  defuddle_jsdom: async (html, url) => {
    const dom = new JSDOM(html, { url, virtualConsole: vc });
    const r = await Defuddle(dom.window.document, url, {});
    dom.window.close();
    return { text: htmlToText(r.content), title: r.title, byline: r.author, date: r.published };
  },
  postlight: async (html, url) => {
    const Parser = (await import('@postlight/parser')).default;
    const r = await Parser.parse(url, { html, contentType: 'html', fetchAllPages: false });
    return { text: htmlToText(r.content || ''), title: r.title, byline: r.author, date: r.date_published };
  },
  extractus: async (html, url) => {
    const { extractFromHtml } = await import('@extractus/article-extractor');
    const r = await extractFromHtml(html, url);
    return r ? { text: htmlToText(r.content || ''), title: r.title, byline: r.author, date: r.published } : { text: '' };
  },
  unfluff: async (html, url) => {
    const { default: unfluff } = await import('unfluff');
    const r = unfluff(html);
    return { text: r.text || '', title: r.title, byline: (r.author || []).join(', '), date: r.date, lang: r.lang };
  },
};
