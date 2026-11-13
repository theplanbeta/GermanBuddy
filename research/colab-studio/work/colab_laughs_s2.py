"""Runs ON the Colab machine, after s2_setup.sh. Laugh audition for Fish Audio S2-Pro.

The first S2-Pro run wrote laughs as "[laughing] Hahaha!" and the model read the word aloud.
This renders each of the scene's six laughs in several ways without a written "ha":
  tag     "[laughing]"                      the tag alone
  burst   "[bursts out laughing]"           a free-form description
  chuck   "[chuckle]"                       a soft one
  line    "[laughing] Oh, come on!"         a laugh carried by a short line
Outputs in /content/studio/laughs: <slot>_<variant>.wav (24 kHz), laughs.json; packed as laughs.tgz
"""
import os, io, sys, json, time, wave, subprocess, tarfile
import numpy as np, requests, ormsgpack, soundfile, librosa

S = "/content/studio"; R = f"{S}/laughs"; FISH = "/content/fish-speech"; URL = "http://127.0.0.1:18080"
REF_TEXT = ("The morning was quiet, and the old house creaked softly in the wind. "
            "She poured a cup of tea, opened the window, and listened to the birds outside.")
os.makedirs(R, exist_ok=True)
JSONH = {"accept": "application/json"}
def smi(q): return subprocess.run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
def healthy():
    try: return requests.get(f"{URL}/v1/health", timeout=3).json().get("status") == "ok"
    except Exception: return False
load_s = 0.0
if not healthy():
    cmd = [f"{FISH}/.venv/bin/python", "tools/api_server.py", "--listen", "127.0.0.1:18080", "--llama-checkpoint-path", "checkpoints/s2-pro",
           "--decoder-checkpoint-path", "checkpoints/s2-pro/codec.pth", "--decoder-config-name", "modded_dac_vq"]
    log = open(f"{R}/server.log", "w"); t0 = time.time()
    srv = subprocess.Popen(cmd, cwd=FISH, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    while not healthy():
        if srv.poll() is not None: sys.exit("SERVER DIED\n" + open(f"{R}/server.log").read()[-4000:])
        if time.time() - t0 > 900: sys.exit("SERVER NOT READY\n" + open(f"{R}/server.log").read()[-4000:])
        time.sleep(2)
    load_s = time.time() - t0
print("server ready", round(load_s, 1), "s; card", smi("name,memory.used,memory.total"), flush=True)
have = requests.get(f"{URL}/v1/references/list", headers=JSONH, timeout=30).json().get("reference_ids", [])
for v in ("af_aoede", "am_fenrir"):
    if v not in have:
        r = requests.post(f"{URL}/v1/references/add", data=dict(id=v, text=REF_TEXT), headers=JSONH,
                          files=dict(audio=(f"{v}.wav", open(f"{S}/refs/{v}.wav", "rb"), "audio/wav")), timeout=300)
        assert r.status_code == 200, r.text

SLOTS = [  # sentence, voice, what the story says, the short line for the "line" variant
    (4, "am_fenrir", "He laughed.", "[laughing] Oh, come on!"),
    (40, "af_aoede", "A giggle.", "[giggling] Mm-hm."),
    (41, "af_aoede", "Then another.", "[giggling] Oh no."),
    (42, "af_aoede", "Sarah burst into uncontrollable laughter.", "[laughing uncontrollably] Oh, Daniel!"),
    (55, "af_aoede", "She laughed even harder.", "[laughing hard] Stop, stop!"),
    (56, "am_fenrir", "Daniel began to laugh too.", "[laughing] Oh, man."),
]
VARIANTS = lambda line: [("tag", "[laughing]"), ("burst", "[bursts out laughing]"), ("chuck", "[chuckle]"), ("line", line)]
rows = []
for sent, voice, story, line in SLOTS:
    for var, text in VARIANTS(line):
        body = dict(text=text, reference_id=voice, format="wav", seed=sent * 10 + 7, use_memory_cache="on", streaming=False, chunk_length=200)
        t = time.time()
        r = requests.post(f"{URL}/v1/tts", params={"format": "msgpack"}, data=ormsgpack.packb(body), headers={"content-type": "application/msgpack"}, timeout=600)
        dt = time.time() - t
        if r.status_code != 200: rows.append(dict(sent=sent, variant=var, text=text, error=r.text[:300])); print("ERROR", sent, var, r.text[:200], flush=True); continue
        a, sr = soundfile.read(io.BytesIO(r.content), dtype="float32")
        if a.ndim > 1: a = a.mean(1)
        w = librosa.resample(a, orig_sr=sr, target_sr=24000)
        peak = float(np.abs(w).max()) if w.size else 0.0
        name = f"s{sent:02d}_{var}.wav"
        with wave.open(f"{R}/{name}", "wb") as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000); f.writeframes((np.clip(w, -1, 1) * 32767).astype(np.int16).tobytes())
        rows.append(dict(sent=sent, voice=voice, story=story, variant=var, text=text, file=name, audio_s=round(len(a) / sr, 2), compute_s=round(dt, 2), peak=round(peak, 3)))
        print(f"s{sent:02d} {var:6s} {dt:5.1f}s -> {len(a) / sr:4.1f}s peak {peak:.3f}  {text}", flush=True)

from transformers import pipeline
asr = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=0)
for r in rows:
    if "file" not in r: continue
    a, _ = librosa.load(f"{R}/{r['file']}", sr=16000)
    r["heard_as"] = asr({"raw": a, "sampling_rate": 16000}, generate_kwargs={"max_new_tokens": 48})["text"].strip() if a.size > 1600 else ""
    print(r["file"], "|", r["heard_as"], flush=True)
json.dump(dict(gpu=smi("name,memory.total"), card_used=smi("memory.used"), server_ready_s=round(load_s, 1), rows=rows), open(f"{R}/laughs.json", "w"), indent=1)
with tarfile.open(f"{S}/laughs.tgz", "w:gz") as t: t.add(R, arcname="laughs")
print("DONE", smi("memory.used"))
