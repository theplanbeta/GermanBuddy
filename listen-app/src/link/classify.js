// What a person pasted, tidied and sorted before anything is fetched
// (research/link-extraction/proto/hearshot-extract.mjs, classifyUrl).
//
// classifyUrl(input) -> { ok: true, kind: 'page', url }
//                     | { ok: false, kind, message, url? }
// kind: 'page' | 'pdf' | 'video' | 'audio' | 'media' | 'login-wall' | 'gdoc' | 'invalid'
// Pure: no network, no DOM.

const TRACKING = /^(utm_[a-z0-9_]*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi)$/i;

const VIDEO = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'dailymotion.com'];
const AUDIO = ['open.spotify.com', 'podcasts.apple.com', 'music.apple.com', 'soundcloud.com', 'overcast.fm', 'pca.st', 'podcasts.google.com'];
const LOGIN = ['x.com', 'twitter.com', 'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'threads.net'];
const MEDIA = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|webm|mov|mkv|avi|zip|gz|rar|7z|exe|dmg|pkg|apk|ipa|png|jpe?g|gif|webp|avif|heic|svg|docx?|pptx?|xlsx?|odt|epub)$/;

export const MESSAGES = {
  invalid: 'That does not look like a web address. Paste a link such as https://example.com/article.',
  pdf: 'This link is a PDF. Download it to your device, then use Open PDF.',
  video: 'This is a video page, and it has no article to read. Hearshot reads written articles.',
  audio: 'This is a podcast or music page; it is already audio. Hearshot reads written articles.',
  media: 'That link is a file (a picture, a recording or a download), not a web page.',
  'login-wall': 'This site only shows posts to people who are logged in, so it cannot be read from a link. Open the post, select the text, copy it and paste it here.',
  gdoc: 'Google Docs cannot be read from a link. In the document, use File > Download (plain text or PDF), or select the text, copy it and paste it here.',
};

const onSite = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

/** The link as Hearshot would fetch it: trimmed, with https:// added to a bare domain, without tracking parts or #. */
export function tidyUrl(input) {
  let s = String(input ?? '').trim().replace(/^<(.*)>$/s, '$1').replace(/^["'“”‘’](.*)["'“”‘’]$/s, '$1').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (s.startsWith('//')) s = 'https:' + s;
    else if (/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#]|$)/u.test(s)) s = 'https://' + s;
    else return null;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname.includes('.')) return null;
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u;
}

export function classifyUrl(input) {
  const u = tidyUrl(input);
  if (!u) return { ok: false, kind: 'invalid', message: MESSAGES.invalid };
  const url = u.href;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const path = u.pathname.toLowerCase();
  const no = (kind) => ({ ok: false, kind, url, message: MESSAGES[kind] });
  if (onSite(host, VIDEO)) return no('video');
  if (onSite(host, AUDIO)) return no('audio');
  if (host === 'docs.google.com' || host === 'drive.google.com') return no('gdoc');
  if (onSite(host, LOGIN)) return no('login-wall');
  if (/\.pdf$/.test(path)) return no('pdf');
  if (MEDIA.test(path)) return no('media');
  return { ok: true, kind: 'page', url };
}
