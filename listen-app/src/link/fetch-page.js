// Asks the owner's helper to fetch one web page (POST /read; research/colab-studio/REPORT.md).
// A browser cannot fetch other sites itself, so the helper does it: the helper and the
// website both see the request (PRIVACY_NOTE). The page is read on this device afterwards.
//
// fetchPage({ url, helper: { url, key }, fetch, timeoutMs }) never throws and resolves to
//   { ok: true, kind: 'html', type, finalUrl, html, bytes, redirects }
//   { ok: true, kind: 'pdf', finalUrl }
//   { ok: false, code, message }    message: one plain sentence or two, saying what to do next

export const TIMEOUT_MS = 20_000;

/** For the settings or the link field. It must stay true: do not say that nothing leaves the device. */
export const PRIVACY_NOTE =
  'To read a link, your own helper server fetches the page: the helper and the website both see that request. ' +
  'The helper keeps no copy of the page; its log notes only the site name. The text is then prepared on this device.';

const PASTE = 'Open the page, select the text, copy it and paste it here.';

export const FETCH_MESSAGES = {
  bad_url: 'Hearshot cannot open that address. Check that it is a normal web link starting with https://.',
  blocked_address: 'That address belongs to a private network (such as a home router or the helper itself), so it is not opened. Only public web pages can be read.',
  too_many_redirects: 'That link kept sending the helper on to other addresses, so the page was never reached. Open it in your browser and copy the address from there.',
  too_large: `That page is too large to read (over 2 MB). ${PASTE}`,
  timeout: `The website took too long to answer. Try again in a minute; if it keeps happening: ${PASTE.toLowerCase()}`,
  unsupported_type: 'That link leads to a file (such as a picture or a download), not a web page. Hearshot reads articles.',
  blocked_by_site: `The website would not show this page to the helper (it may need a login, or it blocks automatic readers). ${PASTE}`,
  paywall: `This page is behind a paywall. If you have access: ${PASTE.toLowerCase()}`,
  not_found: 'The website says this page does not exist. Check the link, or copy it again.',
  site_rate_limited: 'The website is busy and asked the helper to slow down. Try again in a few minutes.',
  site_error: `The website had a problem showing this page. Try again later, or: ${PASTE.toLowerCase()}`,
  unreachable: 'The website could not be reached. Check the link; the site may be down.',
  bad_certificate: 'The website\'s security certificate did not check out, so the helper did not read it. Try again later.',
  busy: 'Your helper is already fetching two pages. Try again in a moment.',
  read_limit: 'That is a lot of links in one minute. Wait a minute, then try again.',
  daily_limit: 'Today\'s number of links is used up; it starts again tomorrow. Meanwhile you can paste the text itself.',
  bad_request: 'Something went wrong between Hearshot and your helper. Try again.',
  // not codes the helper sends; what went wrong on the way to it
  no_helper: 'To read links, Hearshot needs your helper. Paste your studio link in Settings first.',
  key: 'Your helper did not accept the key. Paste the studio link again in Settings.',
  helper_busy: 'Your helper is getting too many requests. Wait a minute, then try again.',
  helper_old: 'Your helper cannot read links yet: it needs the update that adds link reading.',
  helper_timeout: 'Your helper took too long to answer. Try again in a minute.',
  network: 'Hearshot could not reach your helper. Check the internet connection, and that the helper is running.',
  bad_answer: 'Your helper sent an answer Hearshot did not understand. Try again.',
};

const fail = (code, fallback) => ({ ok: false, code, message: FETCH_MESSAGES[code] ?? fallback ?? FETCH_MESSAGES.bad_answer });

export async function fetchPage({ url, helper, fetch: fetchFn, timeoutMs = TIMEOUT_MS } = {}) {
  const base = String(helper?.url ?? '').replace(/\/+$/, '');
  if (!base || !helper?.key) return fail('no_helper');
  const doFetch = fetchFn ?? globalThis.fetch;
  let res;
  try {
    res = await doFetch(`${base}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${helper.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: String(url) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    return fail(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'helper_timeout' : 'network');
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.status === 401) return fail('key');
  if (res.ok) {
    if (body?.kind === 'pdf' && typeof body.finalUrl === 'string') return { ok: true, kind: 'pdf', finalUrl: body.finalUrl };
    if (body?.kind === 'html' && typeof body.html === 'string') {
      return { ok: true, kind: 'html', type: body.type || 'text/html', finalUrl: String(body.finalUrl || url), html: body.html, bytes: body.bytes ?? body.html.length, redirects: body.redirects ?? 0 };
    }
    return fail('bad_answer');
  }
  const code = typeof body?.error === 'string' ? body.error : '';
  if (FETCH_MESSAGES[code]) return fail(code);
  if (res.status === 429) return fail('helper_busy');                 // the helper's general limit ("too many requests")
  if (res.status === 404) return fail('helper_old');                  // a helper from before /read
  return fail(code || 'bad_answer', typeof body?.message === 'string' ? body.message : undefined);
}
