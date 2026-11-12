// "Director": rule-based pre-pass that turns raw fiction text into a list of chunks, each
// with performer settings. Pure string code, no model calls -> runs anywhere (browser too).
//
//   direct(text, opts) -> [{ text, lang, perf: {whisper, firm, pitch, speed, gainDb, shelfDb, tremolo},
//                            tags, kind: 'narr'|'quote', pauseAfter, speaker }]
import { detectLanguage } from "./foreign.mjs";

// ---------------------------------------------------------------- normalisation
const STOP = new Set(["of", "in", "and", "or", "was", "is", "were", "to", "for", "from", "on", "at", "by", "with", "a", "an", "the", "per", "each", "that", "which", "but"]);
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export function normalize(text) {
  return text
    // €2.45 million -> 2.45 million euros ; €5 -> 5 euros (kokoro-js only knows $ and £)
    // ("a €2 million budget" -> "a 2 million euro budget": singular when a noun follows)
    .replace(/€\s?(\d[\d,]*(?:\.\d+)?)(\s(?:hundred|thousand|million|billion|trillion))?(?=(\s+[\p{L}]+)?)/gu, (_, n, big = "", __, off, all) => {
      const next = (all.slice(off + _.length).match(/^\s+([\p{L}]+)/u) || [])[1] || "";
      const noun = next && /^\p{Ll}/u.test(next) && !STOP.has(next);
      return `${n}${big} ${n === "1" && !big ? "euro" : noun ? "euro" : "euros"}`;
    })
    // 0.75 -> zero point seven five (espeak's own "0" sounds odd: zˈiəɹoʊ)
    .replace(/(?<![\d.])0\.(\d+)/g, (_, d) => `zero point ${[...d].map((c) => ONES[+c]).join(" ")}`)
    // a.m. / p.m. keep as is (kokoro-js reads them well); 7:43 handled by kokoro-js
    .replace(/[ \t]+/g, " ");
}

// ---------------------------------------------------------------- spans and sentences
/** Paragraph -> alternating narration / quote spans. Handles “ ” and straight " pairs. */
export function spans(par) {
  const out = [];
  let i = 0, buf = "", inQ = false;
  const push = (kind) => { if (buf.trim()) out.push({ kind, text: buf.trim() }); buf = ""; };
  for (; i < par.length; i++) {
    const c = par[i];
    if (!inQ && (c === "“" || (c === '"' && /(^|[\s(—–-])$/.test(par[i - 1] ?? " ")))) { push("narr"); inQ = true; continue; }
    if (inQ && (c === "”" || c === '"')) { push("quote"); inQ = false; continue; }
    buf += c;
  }
  push(inQ ? "quote" : "narr");
  return out;
}

const ABBR = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "no", "fig", "approx", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
/** Split one span into sentences. "…" ends a sentence only in narration and only before a capital. */
export function sentences(text, kind) {
  const out = [];
  let start = 0;
  const re = /([.!?…]+)\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length;
    const next = text.slice(m.index + m[0].length);
    if (!/^[\p{Lu}\p{N}¡¿"“]/u.test(next)) continue;
    const word = text.slice(start, m.index).split(/\s/).pop().toLowerCase().replace(/^[("“]+/, "");
    if (m[1] === "." && (ABBR.has(word) || /^(\p{L}\.)+\p{L}$/u.test(word) || /^\p{Lu}$/u.test(word))) continue;
    if (m[1] === "…" && kind === "quote") continue; // "Wait… WHAT?!" stays one utterance
    out.push(text.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

// ---------------------------------------------------------------- cues -> performance
const CUES = [
  ["whisper", /\bwhisper|\bmurmur|\bmutter|\bunder (?:her|his|their) breath|\bbreathed\b/i],
  ["shout", /\bshout|\byell|\bscream|\bbellow|\broar|\bcried out|\bcalled out|\bhollered/i],
  ["excited", /\bexclaim|\bcried\b|\bgasp|\bblurted/i],
  ["tremble", /\btrembl|\bshaking\b|\bshaky|\bquaver|\bvoice broke|\bstammer/i],
  ["slow", /\bslow(?:ly|ing)?\b|\bdeliberately\b|\bmeasured\b|\bdrawled/i],
  ["laugh", /\blaugh|\bgiggl|\bchuckl/i],
  ["sigh", /\bsigh/i],
  ["soft", /\bsoft(?:ly)?\b|\bquiet(?:ly)?\b|\bgently\b|\bhushed/i],
];
// Performer settings per cue. whisper/firm: timbre-half direction strength; pitch: prosody-half
// direction strength (F0 up); speed: Kokoro speed; gainDb / shelfDb: post DSP; tremolo: {rate, depth}.
export const PRESETS = {
  whisper: { whisper: 1.1, speed: 0.92 },
  shout: { pitch: 0.55, firm: 0.6, speed: 1.06, gainDb: 4, shelfDb: 3 },
  excited: { pitch: 0.3, firm: 0.3, speed: 1.03, gainDb: 1.5 },
  tremble: { whisper: 0.3, tremolo: { rate: 5.5, depth: 0.22 } },
  slow: { speed: 0.85 },
  laugh: { pitch: 0.35, speed: 1.04, gainDb: 1 },
  sigh: { whisper: 0.45, speed: 0.94 },
  soft: { whisper: 0.35, gainDb: -1.5 },
};
export function perfFor(tags) {
  const p = { whisper: 0, firm: 0, pitch: 0, speed: 1, gainDb: 0, shelfDb: 0, tremolo: null };
  // shouting beats whispering when both appear
  if (tags.includes("shout")) tags = tags.filter((t) => t !== "whisper" && t !== "soft" && t !== "sigh");
  for (const t of tags) {
    const q = PRESETS[t];
    if (!q) continue;
    p.whisper = Math.max(p.whisper, q.whisper ?? 0);
    p.firm = Math.max(p.firm, q.firm ?? 0);
    p.pitch = Math.max(p.pitch, q.pitch ?? 0);
    p.speed *= q.speed ?? 1;
    p.gainDb += q.gainDb ?? 0;
    p.shelfDb = Math.max(p.shelfDb, q.shelfDb ?? 0);
    if (q.tremolo) p.tremolo = q.tremolo;
  }
  if (p.whisper && p.firm) p.firm = 0;
  p.speed = Math.min(1.15, Math.max(0.8, p.speed));
  p.gainDb = Math.min(4.5, p.gainDb);
  return p;
}
const cuesIn = (s) => CUES.filter(([, re]) => re.test(s)).map(([t]) => t);
const speakerIn = (s) => (/\b(she|her|girl|woman|mother|lady)\b/i.test(s) ? "f" : /\b(he|his|him|boy|man|father|professor)\b/i.test(s) ? "m" : null);

// ---------------------------------------------------------------- main
export const PAUSE = { clause: 0.22, ellipsisMid: 0.45, sentence: 0.42, dramatic: 0.75, ellipsisEnd: 0.6, chain: 0.15, paragraph: 0.9 };

// v2: cues whose effect is small (measured: <= +2 st, <= 1.5 dB, <= 6% speed) are not worth a
// chunk boundary in the middle of a sentence; with mergeMild they are dropped so the sentence stays whole.
const MILD = new Set(["laugh", "sigh", "soft", "excited", "tremble"]);
export function direct(text, { splitQuotes = true, cues = true, foreign = true, norm = true, mergeMild = false } = {}) {
  if (norm) text = normalize(text);
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks = [];
  for (const par of paragraphs) {
    const sp = spans(par);
    // attach cues to quotes from the adjacent attribution narration
    let prevQuoteTags = null;
    sp.forEach((s, i) => {
      if (s.kind !== "quote") return;
      const before = sp[i - 1]?.kind === "narr" && /[,:]\s*$/.test(sp[i - 1].text) ? sp[i - 1].text : "";
      const after = sp[i + 1]?.kind === "narr" && /^[\p{Ll}]/u.test(sp[i + 1].text) ? sp[i + 1].text.split(/(?<=[.!?])\s/)[0] : "";
      const attrib = before.split(/(?<=[.!?])\s/).pop() + " " + after;
      let tags = cues ? cuesIn(attrib) : [];
      if (cues && !attrib.trim() && prevQuoteTags) tags = prevQuoteTags.filter((t) => ["slow", "whisper", "soft"].includes(t)); // same speaker continues
      if (cues && !attrib.trim() && !prevQuoteTags && i > 0 && sp[i - 1].kind === "narr" && sp[i - 2]?.kind === "quote") tags = [];
      s.tags = tags;
      s.speaker = speakerIn(attrib) ?? (!attrib.trim() && i >= 2 ? sp[i - 2].speaker : null); // inherit only when unattributed
      prevQuoteTags = tags.length ? tags : prevQuoteTags;
    });
    // units: (span, sentence[, sub-part]) with their own tags
    const units = [];
    for (const s of sp) {
      const sents = sentences(s.text, s.kind);
      sents.forEach((t, k) => {
        const endsSentence = k < sents.length - 1 || /[.!?…]["”’]?$/.test(t);
        let tags = s.kind === "quote" ? [...(s.tags || [])] : [];
        if (cues && s.kind === "quote") {
          if (/[!?]!|!\?|\?!/.test(t) && !tags.includes("shout")) tags.push("excited");
          else if (/!$/.test(t) && !tags.length) tags.push("excited");
        }
        // an ALL-CAPS word run ending in ! or ?! inside a quote is shouted on its own
        const caps = cues && s.kind === "quote" ? t.match(/^(.*?[…,—-]\s*)((?:\p{Lu}{2,}[\s,]*)+[!?]+)$/u) : null;
        if (caps && caps[1].trim() && splitQuotes) {
          units.push({ kind: s.kind, text: caps[1].trim(), tags: tags.filter((x) => x !== "excited"), endsSentence: false, speaker: s.speaker });
          units.push({ kind: s.kind, text: caps[2].trim().toLowerCase(), tags: [...new Set([...tags, "shout"])], endsSentence, speaker: s.speaker });
        } else {
          const tt = caps ? t.replace(/\b\p{Lu}{2,}\b/gu, (w) => w.toLowerCase()) : t;
          units.push({ kind: s.kind, text: tt, tags, endsSentence, speaker: s.speaker });
        }
      });
    }
    if (mergeMild) for (const u of units) if (u.tags.length && u.tags.every((t) => MILD.has(t))) u.tags = [];
    // language per unit (whole-unit foreign phrases only; foreign words inside English are handled by the performer)
    for (const u of units) u.lang = foreign ? detectLanguage(u.text) : "en";
    // merge units of the same sentence when they need the same performance
    const merged = [];
    for (const u of units) {
      const last = merged.at(-1);
      const key = (x) => `${x.lang}|${[...new Set(x.tags)].sort().join(",")}|${x.kind === "quote" ? x.speaker : "narr"}`;
      if (last && !last.endsSentence && (!splitQuotes || (key(last) === key(u) || (!u.tags.length && !last.tags.length && u.lang === last.lang)))) {
        const q = last.kind !== u.kind;
        last.text = last.kind === "quote" && q ? `“${last.text}” ${u.text}` : q ? `${last.text} “${u.text}”` : `${last.text} ${u.text}`;
        if (!splitQuotes) last.tags = [...new Set([...last.tags, ...u.tags])];
        last.endsSentence = u.endsSentence;
        last.kind = "mixed";
        continue;
      }
      merged.push({ ...u });
    }
    // pauses
    merged.forEach((c, i) => {
      const next = merged[i + 1];
      const words = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;
      let p;
      if (!next) p = PAUSE.paragraph;
      else if (!c.endsSentence) p = /…$/.test(c.text) ? PAUSE.ellipsisMid : PAUSE.clause;
      else if (/…["”]?$/.test(c.text)) p = PAUSE.ellipsisEnd;
      else if (c.kind === "quote" && next.kind === "quote" && c.tags.includes("shout") && next.tags.includes("shout")) p = PAUSE.chain;
      else if (c.kind !== "quote" && (words(c.text) <= 4 || (next.kind !== "quote" && words(next.text) <= 4))) p = PAUSE.dramatic;
      else p = PAUSE.sentence;
      c.pauseAfter = p;
      c.paraEnd = !next;
      // the next chunk continues the same written sentence (attribution after a quote, quote after "she said,")
      c.sentenceCont = !!next && (!c.endsSentence || /^[\p{Ll}]/u.test(next.text));
      c.perf = perfFor(c.tags);
    });
    chunks.push(...merged);
  }
  return chunks;
}
