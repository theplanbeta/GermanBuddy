# Hearshot Studio: the one cell. Tap Run, approve Drive, switch back to Hearshot.
#
# It uses one folder in your Drive, "Hearshot Studio", and nothing else:
#   jobs/    line requests put there by the app      {"id","voice","text","kind","expect","seed"}
#   audio/   the rendered line (<id>.wav) and its check result (<id>.json)
#   refs/    one short voice sample per character    <voice>.wav
#   models/  the voice model, kept so later starts need no download
#   status/  ready.json, heartbeat.json and log.txt (one line a minute)
# The machine is released after IDLE_MIN quiet minutes, so it stops spending compute units.
IDLE_MIN = 10

import os, re, json, time, wave, shutil, difflib, threading, subprocess
T0 = time.time(); stamps = {}
def stamp(k): stamps[k] = round(time.time() - T0, 1); print(f"{stamps[k]:7.1f} s  {k}", flush=True)

from google.colab import drive
drive.mount("/content/drive")
D = "/content/drive/MyDrive/Hearshot Studio"
for d in ("jobs/done", "audio", "refs", "models", "status"): os.makedirs(f"{D}/{d}", exist_ok=True)
REFS = {}  # voice samples (Kokoro-made, synthetic); build_notebook.py fills this in
import base64
for v, b64 in REFS.items():
    if not os.path.exists(f"{D}/refs/{v}.wav"): open(f"{D}/refs/{v}.wav", "wb").write(base64.b64decode(b64))
stamp("drive connected")
def log(msg):
    with open(f"{D}/status/log.txt", "a") as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
log("cell started")

# Chatterbox on Colab's own torch: the package without its pinned versions, plus what it needs.
subprocess.run("uv pip install --system -q --no-deps chatterbox-tts && "
               "uv pip install --system -q s3tokenizer conformer pyloudnorm omegaconf resemble-perth spacy-pkuseg pykakasi",
               shell=True, check=True)
stamp("installed")

import numpy as np, torch, librosa
from huggingface_hub import snapshot_download

def fetch(repo, name, ignore=()):
    """Model files: from the Drive folder if they are there, else from Hugging Face, and then a
    copy goes to Drive in the background. Returns the local folder and where the files came from."""
    local, kept = f"/content/models/{name}", f"{D}/models/{name}"
    if os.path.exists(f"{kept}/COMPLETE"):
        shutil.copytree(kept, local, dirs_exist_ok=True); return local, "drive"
    snapshot_download(repo, local_dir=local, ignore_patterns=list(ignore) + ["*.md", ".gitattributes", "*.png", "*.msgpack", "*.h5", "*.ot"])
    def keep():
        t = time.time(); shutil.copytree(local, kept, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".cache"))
        open(f"{kept}/COMPLETE", "w").write(time.strftime("%Y-%m-%d %H:%M:%S")); log(f"kept {name} in Drive, {time.time() - t:.0f} s")
    threading.Thread(target=keep, daemon=True).start()
    return local, "download"

from chatterbox.tts_turbo import ChatterboxTurboTTS
path, src_voice = fetch("ResembleAI/chatterbox-turbo", "chatterbox-turbo", ignore=["s3gen.safetensors"])  # Turbo never loads that file
stamp(f"voice model files ({src_voice})")
m = ChatterboxTurboTTS.from_local(path, "cuda")
_norm = m.norm_loudness  # NumPy 2: keep the voice sample 32-bit (see NOTES.md)
m.norm_loudness = lambda wav, sr, target_lufs=-27: np.asarray(_norm(wav, sr, target_lufs), dtype=np.float32)
stamp("voice model loaded")
from transformers import pipeline
path, src_asr = fetch("openai/whisper-base.en", "whisper-base.en")
asr_pipe = pipeline("automatic-speech-recognition", model=path, device=0)
stamp(f"checker loaded ({src_asr})")

conds = {}
def voice(v):  # one voice sample per character, prepared once
    if v not in conds: m.prepare_conditionals(f"{D}/refs/{v}.wav"); conds[v] = m.conds
    return conds[v]

# ---------- the guard (as colab_render.py) ----------
def frame_db(a, sr, hop=0.02):
    h = int(sr * hop); n = len(a) // h
    if n == 0: return np.array([-120.0])
    return 20 * np.log10(np.sqrt((a[: n * h].reshape(n, h) ** 2).mean(1)) + 1e-9)
def words(s):
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", s.lower().replace("’", "'"))
    return re.findall(r"[a-z0-9']+", s)
LAUGHY = re.compile(r"^((h+[aeiou]+)+h*|ah+|eh+|heh|hah|ha|he|hm+|mm+|oh|uh|you)$")
def guard(j, a, sr, heard):
    db = frame_db(a, sr); act = db > db.max() - 40; idx = np.where(act)[0]
    core = (idx[-1] - idx[0] + 1) * 0.02 if idx.size else 0
    gaps = run = 0
    for v in act[idx[0]:idx[-1] + 1] if idx.size else []:
        run = run + 1 if not v else 0; gaps = max(gaps, run)
    r = dict(core=round(core, 2), max_gap=round(gaps * 0.02, 2), heard=heard)
    if j.get("kind") == "laugh":
        ws = [w for w in words(heard) if not LAUGHY.match(w)]
        ok = not ws and 0.25 <= core <= 3.5; r.update(ok=bool(ok), why=None if ok else f"words={ws} core={core:.2f}"); return r
    ref, hyp = words(j.get("expect") or j["text"]), words(heard)
    miss = ins = 0
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False).get_opcodes():
        if op in ("replace", "delete"): miss += a1 - a0
        if op in ("replace", "insert"): ins += max(0, (b1 - b0) - (a1 - a0 if op == "replace" else 0))
    n = len(re.sub(r"\[[a-z ]+\]|\W", "", j["text"].lower())); lo, hi = 0.15 + 0.03 * n, 0.8 + 0.12 * n
    why = []
    if miss > (0 if len(ref) <= 3 else max(1, int(0.2 * len(ref)))): why.append(f"missing/replaced {miss}/{len(ref)}")
    if ins >= 2: why.append(f"inserted {ins}")
    if not (lo <= core <= hi): why.append(f"length {core:.2f}s not in [{lo:.2f},{hi:.2f}]")
    if gaps * 0.02 > 0.8: why.append(f"internal silence {gaps * 0.02:.2f}s")
    r.update(ok=not why, why="; ".join(why) or None); return r

def render(j):
    """One line: render, check, one retry with another seed. Returns the audio (or None) and the record."""
    tries = []
    for attempt in (1, 2):
        seed = int(j.get("seed", 1)) + (500 if attempt == 2 else 0)
        torch.manual_seed(seed); torch.cuda.manual_seed_all(seed); m.conds = voice(j["voice"])
        t = time.time(); w = m.generate(j["text"]).squeeze(0).cpu().numpy().astype(np.float32); dt = time.time() - t
        a16 = librosa.resample(w, orig_sr=m.sr, target_sr=16000)
        heard = asr_pipe({"raw": a16, "sampling_rate": 16000}, generate_kwargs={"max_new_tokens": 48})["text"].strip()
        g = guard(j, w, m.sr, heard); tries.append(dict(attempt=attempt, seed=seed, compute_s=round(dt, 2), audio_s=round(len(w) / m.sr, 2), **g))
        if g["ok"]: return w, tries
    return None, tries
def write_wav(path, a, sr):
    pk = float(np.abs(a).max()) if a.size else 0
    if pk > 0.98: a = a * (0.98 / pk)
    with wave.open(path, "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr); f.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())

_ = m.generate("Hello there.") if (m.conds is not None) else None  # first call on a card is slow; get it over with
stamp("ready")
json.dump(dict(stamps=stamps, gpu=torch.cuda.get_device_name(0), voice_model_from=src_voice, checker_from=src_asr,
               at=time.strftime("%Y-%m-%d %H:%M:%S")), open(f"{D}/status/ready.json", "w"))
log(f"ready after {stamps['ready']} s (voice model from {src_voice})")

SELF_TEST = True  # on a start with an empty jobs folder, put three test lines there (proves the loop end to end)
if SELF_TEST and not [n for n in os.listdir(f"{D}/jobs") if n.endswith(".json")]:
    for i, (v, text, kind) in enumerate([("af_aoede", "[fear] I'm serious.", "speech"), ("am_fenrir", "[angry] Run, Sarah!", "speech"), ("af_aoede", "[laugh]", "laugh")]):
        json.dump(dict(id=f"selftest-{int(T0)}-{i}", voice=v, text=text, kind=kind, expect=re.sub(r"\[[a-z ]+\] ?", "", text), seed=11 + i, created=round(time.time(), 1)),
                  open(f"{D}/jobs/selftest-{int(T0)}-{i}.json", "w"))

# ---------- watch the folder ----------
done = 0; last_work = time.time(); last_beat = 0
print(f"Watching {D}/jobs. This machine is released after {IDLE_MIN} quiet minutes.", flush=True)
while True:
    now = time.time()
    if now - last_beat >= 60:
        last_beat = now; idle = round((now - last_work) / 60, 1)
        json.dump(dict(at=time.strftime("%Y-%m-%d %H:%M:%S"), epoch=round(now), jobs_done=done, idle_min=idle), open(f"{D}/status/heartbeat.json", "w"))
        log(f"alive, {done} lines done, {idle} min quiet")
    for name in sorted(n for n in os.listdir(f"{D}/jobs") if n.endswith(".json")):
        src = f"{D}/jobs/{name}"; seen = time.time()
        try: j = json.load(open(src))
        except Exception: continue  # still being written; next round
        jid = j.get("id") or name[:-5]
        try:
            w, tries = render(j)
            if w is not None: write_wav(f"{D}/audio/{jid}.tmp", w, m.sr); os.replace(f"{D}/audio/{jid}.tmp", f"{D}/audio/{jid}.wav")
            rec = dict(id=jid, result="ok" if w is not None and len(tries) == 1 else "retry-ok" if w is not None else "fallback", tries=tries)
        except Exception as e:
            rec = dict(id=jid, result="error", error=repr(e)[:300])
        rec.update(created=j.get("created"), seen_epoch=round(seen, 1), done_epoch=round(time.time(), 1), seen_to_done_s=round(time.time() - seen, 2))
        json.dump(rec, open(f"{D}/audio/{jid}.json", "w")); os.replace(src, f"{D}/jobs/done/{name}")
        done += 1; last_work = time.time(); log(f"line {jid}: {rec['result']} in {rec['seen_to_done_s']} s"); print(jid, rec["result"], rec["seen_to_done_s"], "s", flush=True)
    if time.time() - last_work > IDLE_MIN * 60:
        log(f"quiet for {IDLE_MIN} min, releasing the machine"); drive.flush_and_unmount()
        from google.colab import runtime; runtime.unassign()
    time.sleep(2)
