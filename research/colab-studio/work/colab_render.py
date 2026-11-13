"""Runs ON the Colab machine. Renders every Chatterbox job of the scene with the guard and measures the machine.

Same jobs, tags, seeds and guard rules as research/dialogue-hybrid/models/hybrid/cb_render.py. What differs:
  - the official PyTorch package on the graphics card (ChatterboxTurboTTS, official sampling defaults:
    temperature 0.8, top-p 0.95, repetition penalty 1.2) instead of the q4 ONNX files on a processor;
  - speech recognition by Whisper (whisper-base.en, the model the earlier test used) on the same card;
  - measurements: time to load, seconds of compute per second of audio, card memory.
Output of the official package carries its inaudible watermark.

Inputs in /content/studio: plan.json, refs/af_aoede.wav, refs/am_fenrir.wav
Outputs in /content/studio/run: cb/<job>_a<n>.wav, cb_jobs.json; packed as /content/studio/run.tgz
"""
import os, re, json, time, wave, difflib, subprocess, tarfile
import numpy as np

T_START = time.time()
S = "/content/studio"
R = f"{S}/run"
os.makedirs(f"{R}/cb", exist_ok=True)

import torch
t0 = time.time()
from chatterbox.tts_turbo import ChatterboxTurboTTS
import_s = time.time() - t0
DEV = "cuda"
gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()

# ---------- wav and meter (as scene.py) ----------
def read_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate(); raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768, sr
def write_wav(path, a, sr):
    a = np.asarray(a, dtype=np.float32); peak = float(np.abs(a).max()) if a.size else 0
    if peak > 0.98: a = a * (0.98 / peak)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
    return peak
def frame_db(a, sr, hop=0.02):
    h = int(sr * hop); n = len(a) // h
    if n == 0: return np.array([-120.0])
    f = a[: n * h].reshape(n, h)
    return 20 * np.log10(np.sqrt((f ** 2).mean(1)) + 1e-9)

# ---------- jobs (as cb_render.py) ----------
plan = json.load(open(f"{S}/plan.json"))["plan"]
jobs = []
for e in plan:
    for k, p in enumerate(e["parts"]):
        if not p["quote"]: continue
        base = dict(sent=e["i"], part=k, voice=p["voice"], cat=p["cat"], expect=p["src"], seed=e["i"] * 10 + k + 1, kind="speech")
        if p["cat"] in ("whisper", "soft", "softsay"):
            plain = re.sub(r"^\[[a-z ]+\] ", "", p["cb_text"])
            jobs.append(dict(base, name=f"s{e['i']:02d}p{k}_plain", text=plain, variant="plain"))
            jobs.append(dict(base, name=f"s{e['i']:02d}p{k}_whisp", text="[whispering] " + plain, variant="whispering"))
        else:
            jobs.append(dict(base, name=f"s{e['i']:02d}p{k}", text=p["cb_text"], variant="main"))
    if e["insert"]:
        jobs.append(dict(sent=e["i"], part=None, voice=e["insert"]["voice"], cat="laugh-insert", expect="", seed=e["i"] * 10 + 7,
                         kind="laugh", name=f"s{e['i']:02d}laugh", text=e["insert"]["text"], variant="insert"))

# ---------- guard (as cb_render.py) ----------
def words(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", s)
    return re.findall(r"[a-z0-9']+", s)
LAUGHY = re.compile(r"^(h+[aeiou]+h*|ah+|eh+|heh|hah|ha|he|hm+|mm+|oh|uh|you)$")
def guard(j, path, asr):
    a, sr = read_wav(path); dur = len(a) / sr; db = frame_db(a, sr, 0.02); act = db > db.max() - 40
    idx = np.where(act)[0]; core = (idx[-1] - idx[0] + 1) * 0.02 if idx.size else 0
    gaps = 0; run = 0
    for v in act[idx[0]:idx[-1] + 1] if idx.size else []:
        run = run + 1 if not v else 0; gaps = max(gaps, run)
    gap_s = gaps * 0.02; peak = float(np.abs(a).max())
    r = dict(dur=round(dur, 2), core=round(core, 2), max_gap=round(gap_s, 2), peak=round(peak, 3), asr=asr)
    if j["kind"] == "laugh":
        ws = [w for w in words(asr) if not LAUGHY.match(w)]
        ok = not ws and 0.25 <= core <= 3.5 and act.sum() * 0.02 >= 0.2
        r.update(ok=bool(ok), why=None if ok else f"words={ws} core={core:.2f}")
        return r
    ref, hyp = words(j["expect"]), words(asr)
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False); miss = ins = 0
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op in ("replace", "delete"): miss += a1 - a0
        if op in ("replace", "insert"): ins += max(0, (b1 - b0) - (a1 - a0 if op == "replace" else 0))
    n = len(re.sub(r"\[[a-z ]+\]|\W", "", j["text"].lower()))  # letters
    lo, hi = 0.15 + 0.03 * n, 0.8 + 0.12 * n
    why = []
    if miss > (0 if len(ref) <= 3 else max(1, int(0.2 * len(ref)))): why.append(f"missing/replaced {miss}/{len(ref)}")
    if ins >= 2: why.append(f"inserted {ins}")
    if not (lo <= core <= hi): why.append(f"length {core:.2f}s not in [{lo:.2f},{hi:.2f}] for {n} letters")
    if gap_s > 0.8: why.append(f"internal silence {gap_s:.2f}s")
    r.update(ok=not why, why="; ".join(why) or None, miss=miss, ins=ins, letters=n)
    return r

# ---------- the voice model ----------
torch.cuda.reset_peak_memory_stats()
t0 = time.time(); m = ChatterboxTurboTTS.from_pretrained(device=DEV); load_s = time.time() - t0
vram_model = torch.cuda.max_memory_allocated() / 2**20
conds = {}; cond_s = {}
for v in ("af_aoede", "am_fenrir"):  # one voice sample per character, prepared once and kept
    t0 = time.time(); m.prepare_conditionals(f"{S}/refs/{v}.wav"); conds[v] = m.conds; cond_s[v] = round(time.time() - t0, 2)

def render(j, attempt):
    seed = j["seed"] + (500 if attempt == 2 else 0)
    torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)
    m.conds = conds[j["voice"]]
    torch.cuda.synchronize(); t = time.time()
    w = m.generate(j["text"])
    torch.cuda.synchronize(); dt = time.time() - t
    w = w.squeeze(0).cpu().numpy().astype(np.float32)
    path = f"{R}/cb/{j['name']}_a{attempt}.wav"
    peak = float(np.abs(w).max()); write_wav(path, w, m.sr)
    j.setdefault("attempts", []).append(dict(attempt=attempt, seed=seed, compute_s=round(dt, 3), audio_s=round(len(w) / m.sr, 2), raw_peak=round(peak, 3), path=path))

# warm-up: the first call on a card is slower (kernels are set up); measured separately, not used
torch.manual_seed(0); t0 = time.time(); m.conds = conds["af_aoede"]; _ = m.generate("Hello there."); torch.cuda.synchronize(); warm_s = time.time() - t0
t_render = time.time()
for j in jobs: render(j, 1)
render1_s = time.time() - t_render

# ---------- speech recognition on the same card ----------
from transformers import pipeline
import librosa
t0 = time.time(); asr_pipe = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=0); asr_load_s = time.time() - t0
def run_asr(paths):
    out = {}
    for p in paths:
        a, _ = librosa.load(p, sr=16000)
        out[p] = asr_pipe({"raw": a, "sampling_rate": 16000})["text"].strip()
    return out
t0 = time.time(); asr = run_asr([j["attempts"][0]["path"] for j in jobs]); asr1_s = time.time() - t0
for j in jobs: j["attempts"][0]["guard"] = guard(j, j["attempts"][0]["path"], asr[j["attempts"][0]["path"]])
retry = [j for j in jobs if not j["attempts"][0]["guard"]["ok"]]
for j in retry: render(j, 2)
if retry:
    asr2 = run_asr([j["attempts"][1]["path"] for j in retry])
    for j in retry: j["attempts"][1]["guard"] = guard(j, j["attempts"][1]["path"], asr2[j["attempts"][1]["path"]])
vram_peak = torch.cuda.max_memory_allocated() / 2**20

for j in jobs:
    good = [a for a in j["attempts"] if a["guard"]["ok"]]
    j["result"] = "ok" if j["attempts"][0]["guard"]["ok"] else ("retry-ok" if good else "fallback")
    j["use"] = good[0]["path"] if good else None
    print(f"{j['name']:16s} {j['result']:9s} {j['text'][:48]:48s} | " + " || ".join(
        f"a{a['attempt']} {a['compute_s']}s->{a['audio_s']}s {'OK' if a['guard']['ok'] else 'FAIL ' + str(a['guard']['why'])} asr='{a['guard']['asr']}'" for a in j["attempts"]))

first = [j["attempts"][0] for j in jobs]
comp = sum(a["compute_s"] for a in first); aud = sum(a["audio_s"] for a in first)
summary = dict(
    gpu=gpu, torch=torch.__version__, import_s=round(import_s, 1), load_s=round(load_s, 1), cond_s=cond_s, warmup_s=round(warm_s, 2),
    jobs=len(jobs), audio_s=round(aud, 1), compute_s=round(comp, 1), compute_per_audio_s=round(comp / aud, 3),
    render_wall_s=round(render1_s, 1), asr_load_s=round(asr_load_s, 1), asr_s=round(asr1_s, 1), asr_per_audio_s=round(asr1_s / aud, 3),
    vram_model_mb=round(vram_model), vram_peak_mb=round(vram_peak),
    ok=sum(j["result"] == "ok" for j in jobs), retry_ok=sum(j["result"] == "retry-ok" for j in jobs), fallback=sum(j["result"] == "fallback" for j in jobs),
    script_wall_s=round(time.time() - T_START, 1))
json.dump(dict(summary=summary, jobs=jobs), open(f"{R}/cb_jobs.json", "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
with tarfile.open(f"{S}/run.tgz", "w:gz") as t: t.add(R, arcname="run")
print("SUMMARY " + json.dumps(summary))
