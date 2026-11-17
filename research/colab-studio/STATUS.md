# Hearshot: where things stand (saved 2026-11-17)

Branch `feature/colab-studio`. Pull request #2 is open and **not merged**, so hearshot.app is unchanged.

## What is built

| Feature | State |
|---|---|
| Studio voice: lost first sentence fixed | Live on the helper server, tested for real |
| Studio only mode, start-on-open, 45-minute keep-awake | In pull request #2; helper part live |
| **Open PDF** (read on the device) | In pull request #2 (commit `6fdf225`); works in a real browser on the Mac |
| **Read a link** (helper fetches, device extracts) | In pull request #2; works for real through the helper |
| Helper: pages with a stated length load | On the server; committed locally (`6107bbe`), not pushed |
| Helper: a stop during a start leaves no machine behind | Live on the server since 2026-11-17 13:24 UTC; tested for real (stop 15 s in, stop at once, normal start to ready): no machine left |

## Tests (run on 2026-11-17)

- App: 185 of 185 pass (`npm test` in `listen-app/`).
- Helper page fetch: 43 of 43 pass (`python3 test_read.py`).
- Helper machine start and stop: 16 of 16 pass (`python3 test_machine.py`).
- Live on the server: every forbidden address refused (own addresses, private ranges, the Tailscale network, the cloud's internal address, disguised addresses, the helper's own public name); bad certificates, too many redirects, pictures and payment pages refused; a PDF link recognised; the per-minute limit works; the log holds site names only.

## Waiting for the owner

1. Merge pull request #2 (publishes everything to hearshot.app).

## Known problems and open checks

- A stop during a start now waits for the current step to end before the machine goes: up to about 3 minutes in the worst case (seen live: 2.8 minutes while Colab was still making the machine). Those minutes are counted.
- A German news page (tagesschau.de) was refused as "a file, not a web page". Cause unknown.
- A Rust blog post gave "no article text found"; the helper received only 460 bytes, probably a redirect page. Not confirmed.
- One plain-http site (neverssl.com) could not be reached by the helper although the server can reach it. Cause unknown.
- Two live redirect checks (redirect to a forbidden address) were inconclusive because the test site refused the requests. The same case passes in the automated tests.
- Sites with a bot check (for example The Guardian) return a few words only; the app warns about it.
- Not tested on a phone: the PDF file picker, speed and memory with a large PDF, the link form.
- Scanned PDFs are detected and reported, not read (no text recognition in this version).
- `npm audit` reports 3 high-severity items in `sharp`, which comes with the phone-voice package (`kokoro-js`). No fix is available; it is not used in the browser.

## Server

- Helper folder `~/hearshot-helper/`. Backups there: `helper.py.before-read` (before today), `helper.py.read-v1` (today's first version), plus the two older ones.
- Undo for today's helper change: copy `helper.py.before-read` over `helper.py`, then `systemctl --user restart hearshot-helper`.
- Limits: link reading 12 pages a minute and 300 a day, 2 MB, 9 seconds; studio quiet limit 45 minutes after the last line, 12 minutes if none was served, 90 minutes a session, 360 minutes a day.

## Set aside

- Gemini: the command-line tool was installed on the Mac on 2026-11-17 and is unused, at the owner's word ("leave gemini out for now"). Remove with `npm uninstall -g @google/gemini-cli`.

## Undo for the code

- Drop today's two commits: `git reset --hard 32cb367` (then a forced push would be needed for the first one, which is already on GitHub).
