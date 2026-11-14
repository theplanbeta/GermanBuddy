# Hearshot studio voice on Colab: report from the Mac (2026-11-13)

Answer to `HANDOFF.md`. Details, commands and all measurements: `work/NOTES.md`.

## Bottom line

Chatterbox on the owner's Colab can serve the acted lines with **no tap and no computer in
daily use**. The design changed on the way: Drive as the mailbox works, but costs about six
taps per listening session, so the owner chose a small **helper** on one of their own cloud
servers. The app calls the helper; the helper starts the Colab machine, passes lines in and
audio out, and releases the machine. This is built and tested end to end over the internet.
The app side is not built. It needs Kokoro C first (step 1, yours).

## Decisions the owner made

| Question | Decision | How |
|---|---|---|
| Bigger model than Chatterbox? | No. Chatterbox Turbo alone, on a T4 | By ear; Fish Audio S2-Pro was tried on an A100 and L4 ("we are over engineering a bit") |
| Laughs | Chatterbox laugh sounds | By ear; S2-Pro read "Hahaha" aloud |
| Drive mailbox or helper | Helper | "our aim was that the app does the colab cell placement in background" |
| Where the helper runs | The owner's small cloud server (1 GB) | A spare phone with Termux was tried and dropped |
| How the app reaches it | Tailscale Funnel plus a secret key | Nothing to install on the phone |

## What was proven

| Handoff item | Result |
|---|---|
| 1 Tool and units | Works on Mac and on a Linux server. T4 costs 1.15 units an hour |
| 2 Chatterbox on a T4 | 0.6 s of compute per second of audio, 3.7 GB of card memory, ready about 2 minutes after start |
| 3 The guard | Works for speech and laughs; it cannot judge breaths |
| 4 Drive round trip | About 9 s from request to audio; fine, but see taps |
| 5 Phone in the background | **Not tested** (the owner could not do it). No longer needed with the helper |
| 6 Rules | Nothing found that forbids one person's own paid plan. Starting machines from a program on a server is not addressed either way: a grey area the owner knows about |
| 7 Listening file | H1 made on Colab approved by ear |

## The helper, as the app sees it

One secure address (the owner has it; on the server: `tailscale funnel status`). Every request
carries `Authorization: Bearer <key>`. Without it: 401.

| Request | Does | Answer |
|---|---|---|
| `POST /start` | starts the Colab machine and the voice model; returns at once | JSON status |
| `GET /status` | | `{"state": "idle" \| "starting" \| "ready" \| "stopping", "error", "today": {...}}` |
| `POST /line` | body `{"id","voice","text","kind","expect","seed"}` | 200 `audio/wav` (24 kHz mono); 422 JSON when the line failed its check twice; 503 when not ready |
| `POST /stop` | releases the machine now | JSON |

- `voice`: `af_aoede` or `am_fenrir` (the two voice samples the machine carries; more voices
  mean more samples in `work/out/refs/` and in `VOICES` in `helper.py`).
- `text`: the line with Chatterbox tags, at most 400 characters, e.g. `[angry] Run, Sarah!`.
  `kind`: `speech` or `laugh` (`text` is then `[laugh]`). `expect`: the words without tags, for
  the check. Tags and line choice: `research/dialogue-hybrid/models/hybrid/`.
- Limits inside the helper: one machine, T4, released after 10 quiet minutes, 90 minutes a
  session, 180 machine minutes a day (about 3.5 units).

Measured over the internet: ready 123 to 145 s after `/start`; a line takes 5 to 13 s from
request to audio (render about 1 s; the rest is the Colab tool reconnecting for each line).

## What the app has to do

1. A "Studio" switch and a field where the owner pastes the address and the key once. Keep
   both in the browser's storage on the device, never in the code: the app's code is public.
2. When listening starts with Studio on: `POST /start`, play Kokoro C meanwhile.
3. Once `/status` says `ready`, ask for the acted lines **ahead of the spoken position**
   (20 to 30 s ahead at today's speed), one request at a time.
4. Swap the audio in when playback reaches the line. On 422, 503, a late answer or no network:
   play the Kokoro line. Never wait for the studio.
5. Keep rendered lines on the device, so a text heard once needs no Colab again.
6. Nothing to do at the end; the helper releases the machine by itself.

Before a browser can call the helper, the helper must be told the app's web address
(`HS_ORIGIN` in `work/helper/hearshot-helper.service`). **Open: which address the app will run
on** (GitHub Pages or `hearshot.app`).

## Not proven, or not good enough yet

- Speed per line. A kept-open connection to the machine should bring 5 s down to 2 or 3 s. Untried.
- A long real session, and the helper coming back after a server restart.
- Funnel is labelled beta by Tailscale, with bandwidth limits it does not state.
- The sign-in the helper holds is stored unencrypted on the server and reaches more than Colab
  (see NOTES). The owner accepted this.

## Where things are

- Branch `feature/colab-studio`, not pushed. `work/helper/`: `helper.py` (the helper),
  `hearshot-helper.service`, `make_helper_cell.py`, `proof.sh`, `session_test.sh`,
  `internet_test.py`. `work/studio_cell.py`: what runs on the Colab machine.
- No secret is in the repository: not the key, not the sign-in, not the server's login.
