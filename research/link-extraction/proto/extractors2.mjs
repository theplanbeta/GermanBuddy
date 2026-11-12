import { extractForListening } from './hearshot-extract.mjs';
const mk = (prefer, toggles = {}) => async (html, url) => {
  const r = await extractForListening(html, url, { prefer, toggles: { announceTitle: false, announceByline: false, announceDate: false, ...toggles } });
  if (!r.ok) return { text: '', error: r.kind };
  return { text: r.blocks.filter(b => !b.skip).map(b => b.text).join('\n'), title: r.meta.title, byline: r.meta.byline, date: r.meta.date, lang: r.meta.lang, extractor: r.meta.extractor };
};
export const X = {
  hs_readability: mk('readability'),
  hs_defuddle: mk('defuddle'),
  hs_auto: mk('auto'),
  // everything kept (all block types), to measure what the listening filter removes
  hs_readability_all: mk('readability', { caption: true, code: true, table: true, footnote: true, reference: true, other: true }),
};
