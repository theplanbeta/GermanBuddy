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
