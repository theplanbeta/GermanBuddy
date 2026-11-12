# Hearshot studio voice on Colab: handoff (2026-11-12)

Written by the cloud session for a Claude Code session on the owner's Mac.
The cloud session cannot reach Colab (its network blocks Colab's servers and
it cannot sign in as the owner); the Mac can. Read this file, then
`listen-app/README.md` and `research/dialogue-hybrid/README.md`.

## How the owner works

- Not a programmer. Explain in plain, non-technical language.
- Safety over speed: work on a branch, never on the default branch; explain
  the plan and wait for approval before changing anything; one step at a
  time; say the risk and how to undo; never suggest immediate deployment.
- Decides by ear. Every step so far was settled with listening files, not
  arguments. Prepare files to compare before building.
- Prefers a strong model to plan and review, with sub-agents doing the coding
  and cheaper ones doing lookups.
- Never commit secrets (Google tokens, keys). Never paste them into chat.

## Where the project stands

- Hearshot is a private web app in `listen-app/` that reads pasted text aloud
  with the open-source Kokoro voice, entirely in the browser.
- Branch: `claude/side-quest-dug5b6`. Hosted on GitHub Pages from `docs/`:
  the main address runs an older engine; the preview at `/next/` has the
  current engine, the waiting ring, spoken forms ("€2.5 million" as "2.5
  million euros") and the "Expressive reading" switch.
- The owner's domain `hearshot.app` (Vercel) is not connected yet.

## Decisions made by ear on a dialogue scene

Scene: `research/dialogue-hybrid/kokoro/prank.txt`.

1. The published preview was "not very impressive" on it.
2. Kokoro with wider rules, designed pauses and a voice per character
   (variant C: narration af_heart, Sarah af_aoede, Daniel am_fenrir) was
   "really good".
3. Chatterbox Turbo on the whole scene was far better, but it cannot run in
   the phone browser.
4. Chosen: **H1**. Kokoro C for everything, Chatterbox only for the lines
   Kokoro cannot act (screams, laughing lines, frightened lines), plus real
   laugh sounds where the story says someone laughs. H1 without laugh sounds
   and "all dialogue by Chatterbox" were "not so good".

## The two steps

- **Step 1, Kokoro C in the app.** Rules and speaker assignment are
  prototyped in `research/dialogue-hybrid/kokoro/director/`. Not built yet;
  not approved yet. Planned for the cloud session, so do not start it on the
  Mac without agreeing who does it.
- **Step 2, the studio voice.** This is the Mac's job: prove that Chatterbox
  on the owner's Colab Pro can serve H1 without a computer in daily use.

## Design for step 2: Drive as the mailbox

The owner has Colab Pro, Google AI Pro and 5 TB of Drive, and wants no
computer in the middle. The Mac is the workbench only.

1. In Hearshot the owner taps "Studio". It opens a one-cell notebook in Colab
   on the phone; they tap Run once and switch back. Kokoro plays meanwhile.
2. Hearshot writes the lines Kokoro cannot act into a "Hearshot Studio"
   folder in the owner's Drive.
3. The notebook watches the folder, renders the lines with Chatterbox on the
   Colab graphics card, checks each with speech recognition, and writes the
   audio back.
4. Hearshot swaps the audio in when playback reaches those lines; if nothing
   arrives, the Kokoro line plays.
5. The notebook releases the machine after a quiet spell. Rendered audio
   stays in Drive, so a text rendered once needs no Colab later.

Why not drive Colab straight from the phone: the official tool
(`googlecolab/google-colab-cli`, Apache-2.0, Mac and Linux) uses plain web
requests (`/tun/m/assign` to start a machine, a Jupyter connection through a
runtime proxy with a token, `/tun/m/<endpoint>/keep-alive/`), but it signs in
with Google's own client and a browser page would hit cross-site blocking.
Untested; do not build on it.

## What must be proven (test plan)

Use a branch of your own, for example `feature/colab-studio`, cut from
`claude/side-quest-dug5b6`, so the two sessions never push to one branch.

1. **Set up the tool** (ask the owner first): `uv tool install
   google-colab-cli` or `pip install google-colab-cli`, then the tool's
   sign-in. `colab new`, `colab exec`, `colab run --gpu T4 script.py`,
   `colab stop`. Always stop sessions: they spend the owner's compute units.
2. **Chatterbox on a T4.** Render the H1 lines of the scene. Line selection,
   tags and gains: `research/dialogue-hybrid/models/hybrid/` (`build_plan.py`,
   `cb_render.py`, `assemble.py`, `guard_check.py`). Measure seconds of
   compute per second of audio, time to load, memory, and compute units used.
3. **The guard.** Speech recognition per line on the same machine; retry
   once, then report a fallback.
4. **Drive round trip.** Time from a job file appearing in Drive to the audio
   file being readable again. Compare the mounted Drive folder with direct
   Drive requests; the mount can lag.
5. **Background on the phone.** A notebook the owner starts in Chrome on
   their phone (Samsung S25 Ultra), then leaves in the background for 30
   minutes: does the cell keep working, and for how long? Have it write a
   heartbeat file every minute.
6. **Rules.** Read Colab's current terms and FAQ (the cloud session could not
   open them). The design uses no tunnel or proxy and only the owner's own
   Drive; confirm that this is ordinary use on a paid plan.
7. Give the owner an H1 file made on Colab to compare by ear with the one
   they approved, and a short plain-language report.

If all of that holds, the next pieces are the real notebook and a free Google
sign-in key so Hearshot may use its own Drive folder (narrow access: only
files the app created).

## What is known about Chatterbox Turbo

Measured on a 4-core processor with the q4 ONNX files; details in
`research/dialogue-hybrid/README.md`.

- Needs a voice sample longer than 5 s per voice. We used 9 s clips made with
  the same Kokoro voice the character has. Sarah's copy came out about two
  semitones lower; a livelier or pitch-matched sample is the first thing to
  try if she sounds like someone else.
- Tags that make real sounds: [laugh] [chuckle] [gasp] [groan] [sigh]
  [cough]. [angry] makes shouted lines about 5 dB louder; [fear] widens the
  pitch range. [whispering], [happy] and [surprised] do little, so whispered
  lines stay with Kokoro.
- Lower-case ALL-CAPS words before sending, or they are spelled out.
- Use the official sampling settings (temperature 0.8, top-p 0.95,
  repetition penalty 1.2); greedy decoding produced long silences.
- It misreads about 4% of words, hence the guard.
- Loudness: one gain per copied voice was enough (about +6 dB Sarah, +5 dB
  Daniel against Kokoro C in that test). Laugh sounds vary a lot in level and
  were set 3 dB below the character's speech.
- The official PyTorch package adds an inaudible watermark; the ONNX example
  does not.

## What is not in the repository

Listening files and downloaded models lived in the cloud session's temporary
storage. The scripts that made them are here; regenerate what you need.
