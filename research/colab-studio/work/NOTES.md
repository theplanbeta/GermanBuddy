# Colab studio workbench: run notes

Measured on the owner's account (Google AI Pro, 200 compute units a month per Google's plan
page, units expire after 90 days). Tool: `google-colab-cli` 0.8.0, signed in on the Mac
(the key is in the macOS Keychain, not in this repository).

## How to repeat the T4 run

On the Mac, from this folder:

```
npm install            # once
npm run setup          # copies the app modules beside the fiction director
npm run kokoro-c       # out/prank_C_voices.wav + .json  (Kokoro C, 118 s)
npm run refs           # out/refs/af_aoede.wav, am_fenrir.wav (9 s each)
npm run plan           # out/hyb/plan.json, kok_jobs.json
npm run kok-parts      # out/hyb/kok/*.wav
```

On Colab (always `colab usage` before and after, always `colab stop`):

```
colab new -s cbt4 --gpu T4
echo '!mkdir -p /content/studio/refs' | colab exec -s cbt4
colab upload -s cbt4 out/hyb/plan.json /content/studio/plan.json
colab upload -s cbt4 out/refs/af_aoede.wav /content/studio/refs/af_aoede.wav
colab upload -s cbt4 out/refs/am_fenrir.wav /content/studio/refs/am_fenrir.wav
colab install -s cbt4 chatterbox-tts
echo '!pip uninstall -y -q torchvision torchcodec' | colab exec -s cbt4   # see "Clashes"
colab restart-kernel -s cbt4
colab exec -s cbt4 -f colab_render.py
colab download -s cbt4 /content/studio/run.tgz out/runs/t4/run.tgz
colab stop -s cbt4
```

Then `tar -xzf out/runs/t4/run.tgz -C out/runs/t4 --strip-components=1` and
`python3 assemble.py t4` writes the listening files into `out/runs/t4/`.

## Clashes between chatterbox-tts 0.1.7 and Colab (2026-11-13, Python 3.13)

`chatterbox-tts` pins torch 2.6.0 and transformers 5.2.0; Colab ships torch 2.14.

1. Colab's `torchvision` (built for torch 2.14) breaks `import transformers` models
   ("operator torchvision::nms does not exist"). Removed; not needed here.
2. Colab's `torchcodec` breaks the speech-recognition pipeline ("undefined symbol:
   aoti_torch_abi_version"). Removed; audio is passed as an array.
3. With NumPy 2 the package's loudness step returns 64-bit audio that its own tokenizer
   rejects ("expected scalar type Double but found Float"). `colab_render.py` wraps that
   step and keeps the result 32-bit.

Chatterbox's own page says it was retired in August 2026 (MIT archive, unmaintained).

## T4 measurements (Tesla T4, 15 GB; 52 jobs, 77.7 s of audio)

| | |
|---|---|
| Hourly rate | 1.15 compute units |
| Compute per second of audio | 0.58 s (0.6 to 1.6 s per line) |
| All 52 jobs | 45 s, plus 9 s speech recognition (0.11 s per second of audio) |
| Model load | 23 s with the download from Hugging Face, 12 s when already on the machine |
| Voice sample preparation | 1.1 s for the first voice, 0.2 s after |
| Card memory | 2.7 GB after loading, 3.7 GB peak (clean first run) |
| Guard | 50 ok, 2 ok on retry ("Sarah?" heard as "Sierra"; a laugh heard as "Pfft"), 0 fallbacks |
| Cost | balance 539.84 -> 539.74 for a 10.5 minute session |

The laugh rule of the guard was widened: this Whisper build writes a laugh as one run
("hahahaha"), which the earlier list did not count as laughter.

Gains found by `assemble.py`: af_aoede +5.7 dB (from two lines only, 8.1 and 3.3 dB apart),
am_fenrir +4.2 dB. The earlier CPU test had +6.3 and +4.9 dB.

Owner's verdict by ear on `out/runs/t4/prank_H1_hybrid_minimal.wav`: "good, with expressions".
The session cost 0.19 units once the meter settled (539.84 -> 539.65).

## Correction: model load on a fresh machine

The "23 s with the download" above is wrong. Both figures were taken after an earlier attempt
in the same session had already fetched the model. On a fresh machine the load took 190 s:
`from_pretrained` fetches 4.1 GB (t3_turbo_v1 1.9 GB, s3gen_meanflow 1.06 GB, and
s3gen.safetensors 1.06 GB, which Turbo never loads), at about 24 MB/s without a Hugging
Face token.

## Light install (second session, fresh T4)

Keeps Colab's own torch 2.14 and transformers 5.22, so none of the three clashes occur:

```
uv pip install --system -q --no-deps chatterbox-tts
uv pip install --system -q s3tokenizer conformer pyloudnorm omegaconf resemble-perth spacy-pkuseg pykakasi
```

9 s. Same guard result as the pinned install (50 ok, 2 ok on retry, 0 fallbacks), 0.62 s of
compute per second of audio, 3.7 GB peak card memory.

Cold start, fresh T4, light install, nothing cached:

| Step | Time |
|---|---|
| `colab new --gpu T4` | 4 s |
| Install | 9 s |
| `import` of the package | 31 s |
| Model load including the 4.1 GB download | 190 s |
| First voice sample (second: 0.2 s) | 21 s |
| Whisper load including its 290 MB download | 40 s |
| Whole script (52 jobs and the guard included) | 352 s |

`colab exec` gives up after 30 s without output; use `--timeout 600` for this script.

## Can a web page start a Colab machine?

No. The preflight a browser must send first (`OPTIONS /tun/m/assign` with an `Origin` and the
`authorization`, `x-goog-colab-token`, `x-colab-client-agent` request headers) is answered
401 with no `Access-Control-Allow-Origin`. Tested with curl, not in a browser. A machine can
be started from the Colab page itself or by the signed-in command-line tool.

## Drive

`colab drivemount` prints a consent link and then waits for Enter on a real terminal; run
without one it fails ("Error propagating: 400", "mount failed"). The owner has to run it in
the Terminal app. The consent covers the whole Drive (Google's standard list for Colab).
Not yet measured: model files read from Drive instead of Hugging Face.

## Card prices and sizes (read from the machines, 2026-11-13)

| Card | Units per hour | Card memory | Machine memory |
|---|---|---|---|
| T4 | 1.15 | 15 GB | |
| L4 | 1.94 | 22.5 GB (23034 MiB) | 52 GB |
| A100 | 6.73 | 40 GB (A100-SXM4-40GB) | 83 GB |

Desk check of stronger models (makers' own pages, nothing run): Orpheus dropped (no whisper or
shout, preset voices, dormant since May 2025); IndexTTS-2.5 second (emotion dial per line, no
sound tags, fits a T4); Fish Audio Drama 3 needs at least 48 GB, more than Colab's A100.

## Fish Audio S2-Pro (first run A100, laugh test L4)

Licence: Fish Audio Research License, non-commercial use only. Not gated; 11 GB.
The maker pins Python 3.12, torch 2.8.0, transformers 5.19.0, so `s2_setup.sh` builds a
separate environment with `uv sync` beside Colab's Python 3.13. No clash occurred.

```
colab new -s s2 --gpu L4
echo '!mkdir -p /content/studio/refs' | colab exec -s s2
colab upload -s s2 out/hyb/plan.json /content/studio/plan.json      # and both refs, s2_setup.sh, colab_render_s2.py
echo '!nohup bash /content/studio/s2_setup.sh > /content/studio/setup.log 2>&1 &' | colab exec -s s2
echo '!nohup python /content/studio/colab_render_s2.py > /content/studio/render.log 2>&1 &' | colab exec -s s2
colab download -s s2 /content/studio/run.tgz out/runs/s2/run.tgz ; colab stop -s s2
python3 assemble.py s2 out/runs/s2/plan_s2.json
```

Long steps are started with `nohup` and polled, because `colab exec` loses its connection on
long silent commands. Port 8080 is taken on Colab; the scripts use 18080. The server answers
msgpack unless asked for JSON (`accept: application/json`).

| | S2-Pro | Chatterbox Turbo (T4) |
|---|---|---|
| Install on a fresh machine | 35 to 55 s | 9 s |
| Model download | 11 GB in about 30 s | 4.1 GB in about 190 s |
| Server ready after start | 80 s (A100), 96 s (L4) | |
| Compute per second of audio, no `--compile` | 2.9 s on the A100, about the same on the L4 | 0.6 s |
| Card memory | 19.7 GB (A100), 19.4 GB (L4): fits the L4 | 3.7 GB |
| Guard, 43 jobs | 38 ok, 2 ok on retry, 3 fallback | 50 ok, 2 retry, 0 fallback of 52 |

The three guard fallbacks were set aside by hand for the listening files: Whisper invents words
for breathing ("Phew", "Thank you"), so the guard cannot judge "[panting]" and "[inhale]"; and
the whisper "Daniel… I need you…" had a 0.82 s pause against a 0.8 s limit. The breaths are
very quiet and `assemble.py` raises them 16 to 19 dB.

Laughs: "[laughing] Hahaha!" is read aloud as words (owner: "like hahaha read aloud"). The tag
alone ("[laughing]", "[chuckle]") gives a laugh sound; "[bursts out laughing]" is unreliable
(breath or noise in 4 of 6); one tag-only request returned a server error 500 (cause not found).
`colab_laughs_s2.py` renders the 23 variants; `out/runs/s2laughs/laugh_audition.wav`.

Owner's verdicts by ear:
- `out/runs/s2/prank_H1_hybrid_minimal.wav` (S2-Pro for the acted lines): "good", laughs excepted.
- Of S2-Pro lines with tag-only S2-Pro laughs (`s2b`), with Chatterbox laughs (`s2cb`) and the
  audition: "s2cb was better". Current best: Kokoro narration and whispers, S2-Pro acted
  lines, Chatterbox laughs.

Both models together need about 23.1 GB, just over the L4 (arithmetic, not tested). Idea, not
tested: make a small library of Chatterbox laughs once per voice, so only S2-Pro runs on Colab.

Costs: S2-Pro on the A100, 13 minutes, about 1.2 units; laugh test on the L4, 9 minutes, about
0.2 to 0.3 units.

## S2-Pro with `--compile` on the L4 (S2_COMPILE=1)

Not worth it as run here. The model's own rate doubled (about 7 to 14 tokens a second, 21.5
tokens per second of audio), but each request also carries about 1.3 s that does not shrink, so
the 43 short lines went from 2.9 to 2.55 s of compute per second of audio. The one-time
compile made the server take 426 s to become ready instead of 96 s. Guard: 41 ok, 2 fallback
(the two breaths, as before). Card memory unchanged at 19.4 GB. Not tried: the maker's SGLang
engine, which is what its published speed figures use.

## The studio notebook and Drive as the mailbox (2026-11-13)

`studio_cell.py` is the one cell; `python3 build_notebook.py` wraps it into
`hearshot_studio.ipynb` (git-ignored: it carries the two Kokoro-made voice samples as text, so
it needs nothing uploaded beforehand). It uses only `MyDrive/Hearshot Studio/`:
`jobs/` (requests), `audio/` (`<id>.wav` and `<id>.json`), `refs/`, `models/`, `status/`
(`ready.json`, `heartbeat.json`, `log.txt` with one line a minute). It releases the machine
after `IDLE_MIN` quiet minutes. A request is a JSON file:
`{"id","voice","text","kind":"speech"|"laugh","expect","seed","created"}`.

Measured on a T4 with the owner's real Drive:

| | |
|---|---|
| Fresh start to ready (model from Hugging Face, 3 GB, `s3gen.safetensors` skipped) | 123 s (114 s in a trial without Drive) |
| Start with the model from the Drive folder | 73 s (same machine, soon after writing: Drive may have served a local copy; a fresh machine is untested) |
| Copying the model into the Drive folder (background) | 46 s for Chatterbox, 11 s for Whisper; 3.4 GB |
| Request created in Drive from outside -> machine sees it | about 7 s (one clean sample) |
| Render and check of that line | 1.7 s |
| Audio written by the machine -> visible through the Drive API | under 1 s |

Running it from the Mac: `colab drivemount` waits for Enter after the browser consent. Give it
a pipe and send the newline once the owner has approved:
`mkfifo f; (sleep 900 > f &); colab drivemount -s NAME < f` and later `echo > f`. The cell is
then run as a script with the `drive.mount` line replaced (the folder is already mounted) and
the `runtime.unassign()` replaced by `break`. `pkill -f` inside `colab exec` kills its own shell
if the pattern also appears elsewhere in the same command.

Colab's rules (FAQ and terms, read by a helper, wording approximate): nothing found forbids one
person on a paid plan running a hand-started notebook against their own Drive. Always banned:
file hosting or media serving unrelated to interactive compute, proxies, mining. Free-tier-only
restrictions (remote shells, bypassing the notebook UI) lift with a positive unit balance. Named
risks: idle timeouts with unpublished limits; "background execution" only on higher plans;
Drive quotas and folders over about 10,000 items.

Still unproven: the notebook started on the phone and left in the background for 30 minutes;
a start from Drive on a truly fresh machine.
