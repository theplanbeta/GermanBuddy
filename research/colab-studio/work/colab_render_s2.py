"""Runs ON the Colab machine, after s2_setup.sh. Renders the scene's dialogue with Fish Audio S2-Pro.

Same lines, seeds and guard as colab_render.py (Chatterbox). What differs:
  - the voice model is S2-Pro, run by its maker's own server (tools/api_server.py) in its own
    environment; this script starts that server and talks to it on 127.0.0.1;
  - S2-Pro's own tags: real [whisper], [screaming], [shouting], a free-form frightened voice,
    laughs, and two breathing sounds the Chatterbox run did not have ("Heavy breathing." and
    "Inhaled slowly.");
  - output is resampled from 44.1 kHz to 24 kHz and written under the same names as the
    Chatterbox run, so assemble.py builds the listening files unchanged:
        python3 assemble.py s2 out/runs/s2/plan_s2.json

Inputs in /content/studio: plan.json, refs/af_aoede.wav, refs/am_fenrir.wav
Outputs in /content/studio/run: cb/<job>_a<n>.wav, cb_jobs.json, plan_s2.json, server.log;
packed as /content/studio/run.tgz
DRY=1 prints the jobs and stops (no server, no card needed).
"""
import os, re, io, sys, json, time, wave, copy, difflib, subprocess, tarfile
import numpy as np

T_START = time.time()
S = os.environ.get("STUDIO", "/content/studio")
R = f"{S}/run"
FISH = "/content/fish-speech"
URL = "http://127.0.0.1:18080"
# the sentence both reference clips speak (kokoro_refs.mjs); S2-Pro wants the transcript
REF_TEXT = ("The morning was quiet, and the old house creaked softly in the wind. "
            "She poured a cup of tea, opened the window, and listened to the birds outside.")
os.makedirs(f"{R}/cb", exist_ok=True)

# ---------- jobs ----------
TAG = {  # director category -> S2-Pro tag. Tags in the maker's list, except "tremble" (free-form, which the model accepts)
    "whisper": "[whisper]", "soft": "[low voice]", "softsay": "[low voice]",
    "tremble": "[scared, trembling voice]", "shout": "[shouting]",
    "laugh": "[laughing tone]", "excited": "[excited]", "neutral": "",
}
SCREAM = {27}                     # "OH MY GOD!" she screamed.
LAUGH_TEXT = {40: "[chuckling] Hehe.", 42: "[laughing] Hahahaha, hahaha!", 55: "[laughing] Hahahaha, hahaha!"}
BREATH = {31: ("af_aoede", "[panting] [inhale] [exhale] [panting]"),   # "Heavy breathing." on her end of the line
          51: ("am_fenrir", "[inhale]")}                               # "Inhaled slowly."
plan_doc = json.load(open(f"{S}/plan.json")); plan = plan_doc["plan"]
plan_s2 = copy.deepcopy(plan_doc)
jobs = []
for e in plan:
    for k, p in enumerate(e["parts"]):
        if not p["quote"]: continue
        plain = re.sub(r"^\[[a-z ]+\] ", "", p["cb_text"])
        tag = "[screaming]" if e["i"] in SCREAM else TAG[p["cat"]]
        quiet = p["cat"] in ("whisper", "soft", "softsay")
        jobs.append(dict(sent=e["i"], part=k, voice=p["voice"], cat=p["cat"], expect=p["src"], seed=e["i"] * 10 + k + 1, kind="speech",
                         name=f"s{e['i']:02d}p{k}" + ("_whisp" if quiet else ""), text=(tag + " " + plain).strip(), variant=tag or "plain"))
    if e["insert"]:
        jobs.append(dict(sent=e["i"], part=None, voice=e["insert"]["voice"], cat="laugh-insert", expect="", seed=e["i"] * 10 + 7, kind="laugh",
                         name=f"s{e['i']:02d}laugh", text=LAUGH_TEXT.get(e["i"], "[laughing] Hahaha!"), variant="insert"))
    elif e["i"] in BREATH:
        v, txt = BREATH[e["i"]]
        # assemble.py only knows inserts named "<sentence>laugh"; a breath uses the same slot
        jobs.append(dict(sent=e["i"], part=None, voice=v, cat="breath-insert", expect="", seed=e["i"] * 10 + 7, kind="laugh",
                         name=f"s{e['i']:02d}laugh", text=txt, variant="insert"))
        plan_s2["plan"][e["i"]]["insert"] = dict(voice=v, text=txt)
json.dump(plan_s2, open(f"{R}/plan_s2.json", "w"))
if os.environ.get("DRY"):
    for j in jobs: print(f"{j['name']:14s} {j['voice']:10s} {j['cat']:13s} {j['text']}")
    print(len(jobs), "jobs"); sys.exit()

import requests, ormsgpack, soundfile, librosa

def smi(q): return subprocess.run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader"], capture_output=True, text=True).stdout.strip()
gpu = smi("name,memory.total")

# ---------- wav and meter (as colab_render.py) ----------
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

# ---------- guard (as colab_render.py) ----------
def words(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", s)
    return re.findall(r"[a-z0-9']+", s)
LAUGHY = re.compile(r"^((h+[aeiou]+)+h*|ah+|eh+|heh|hah|ha|he|hm+|mm+|oh|uh|you)$")
def guard(j, path, asr):
    a, sr = read_wav(path); dur = len(a) / sr; db = frame_db(a, sr, 0.02); act = db > db.max() - 40
    idx = np.where(act)[0]; core = (idx[-1] - idx[0] + 1) * 0.02 if idx.size else 0
    gaps = 0; run = 0
    for v in act[idx[0]:idx[-1] + 1] if idx.size else []:
        run = run + 1 if not v else 0; gaps = max(gaps, run)
    gap_s = gaps * 0.02; peak = float(np.abs(a).max())
    r = dict(dur=round(dur, 2), core=round(core, 2), max_gap=round(gap_s, 2), peak=round(peak, 3), asr=asr)
    if j["kind"] == "laugh":  # laughs and breaths: no real words, a plausible length, some sound
        ws = [w for w in words(asr) if not LAUGHY.match(w)]
        ok = not ws and 0.25 <= core <= 3.5 and act.sum() * 0.02 >= 0.2 and peak > 0.01
        r.update(ok=bool(ok), why=None if ok else f"words={ws} core={core:.2f} peak={peak:.3f}")
        return r
    ref, hyp = words(j["expect"]), words(asr)
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False); miss = ins = 0
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op in ("replace", "delete"): miss += a1 - a0
        if op in ("replace", "insert"): ins += max(0, (b1 - b0) - (a1 - a0 if op == "replace" else 0))
    n = len(re.sub(r"\[[a-z, ]+\]|\W", "", j["text"].lower()))  # letters
    lo, hi = 0.15 + 0.03 * n, 0.8 + 0.12 * n
    why = []
    if miss > (0 if len(ref) <= 3 else max(1, int(0.2 * len(ref)))): why.append(f"missing/replaced {miss}/{len(ref)}")
    if ins >= 2: why.append(f"inserted {ins}")
    if not (lo <= core <= hi): why.append(f"length {core:.2f}s not in [{lo:.2f},{hi:.2f}] for {n} letters")
    if gap_s > 0.8: why.append(f"internal silence {gap_s:.2f}s")
    r.update(ok=not why, why="; ".join(why) or None, miss=miss, ins=ins, letters=n)
    return r

# ---------- the voice model: the maker's server, in its own environment ----------
def healthy():
    try: return requests.get(f"{URL}/v1/health", timeout=3).json().get("status") == "ok"
    except Exception: return False
load_s = 0.0
if not healthy():
    cmd = [f"{FISH}/.venv/bin/python", "tools/api_server.py", "--listen", "127.0.0.1:18080",
           "--llama-checkpoint-path", "checkpoints/s2-pro", "--decoder-checkpoint-path", "checkpoints/s2-pro/codec.pth",
           "--decoder-config-name", "modded_dac_vq"] + (["--compile"] if os.environ.get("S2_COMPILE") else [])
    log = open(f"{R}/server.log", "w"); t0 = time.time()
    srv = subprocess.Popen(cmd, cwd=FISH, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    while not healthy():
        if srv.poll() is not None: sys.exit("SERVER DIED\n" + open(f"{R}/server.log").read()[-4000:])
        if time.time() - t0 > 900: sys.exit("SERVER NOT READY after 900 s\n" + open(f"{R}/server.log").read()[-4000:])
        time.sleep(2); print(f"waiting for the server, {time.time() - t0:.0f} s", flush=True) if int(time.time() - t0) % 20 < 2 else None
    load_s = time.time() - t0
vram_model = smi("memory.used")
cond_s = {}
have = requests.get(f"{URL}/v1/references/list", headers={"accept": "application/json"}, timeout=30).json().get("reference_ids", [])
for v in ("af_aoede", "am_fenrir"):  # one saved voice per character
    t0 = time.time()
    if v not in have:
        r = requests.post(f"{URL}/v1/references/add", data=dict(id=v, text=REF_TEXT),
                          files=dict(audio=(f"{v}.wav", open(f"{S}/refs/{v}.wav", "rb"), "audio/wav")), headers={"accept": "application/json"}, timeout=300)
        assert r.status_code == 200, r.text
    cond_s[v] = round(time.time() - t0, 2)

def tts(text, voice, seed):
    body = dict(text=text, reference_id=voice, format="wav", seed=seed, use_memory_cache="on", streaming=False, chunk_length=200)
    t = time.time()
    r = requests.post(f"{URL}/v1/tts", params={"format": "msgpack"}, data=ormsgpack.packb(body),
                      headers={"content-type": "application/msgpack"}, timeout=600)
    dt = time.time() - t
    if r.status_code != 200: raise RuntimeError(f"{r.status_code} {r.text[:500]}")
    a, sr = soundfile.read(io.BytesIO(r.content), dtype="float32")
    if a.ndim > 1: a = a.mean(1)
    return a, sr, dt
def render(j, attempt):
    seed = j["seed"] + (500 if attempt == 2 else 0)
    a, sr, dt = tts(j["text"], j["voice"], seed)
    w = librosa.resample(a, orig_sr=sr, target_sr=24000) if sr != 24000 else a
    path = f"{R}/cb/{j['name']}_a{attempt}.wav"
    peak = float(np.abs(w).max()) if w.size else 0.0; write_wav(path, w, 24000)
    j.setdefault("attempts", []).append(dict(attempt=attempt, seed=seed, compute_s=round(dt, 3), audio_s=round(len(a) / sr, 2), raw_peak=round(peak, 3), model_sr=sr, path=path))
    print(f"{j['name']:14s} a{attempt} {dt:.1f}s -> {len(a) / sr:.1f}s  {j['text'][:60]}", flush=True)

t0 = time.time(); _ = tts("Hello there.", "af_aoede", 0); warm_s = time.time() - t0   # first call, measured apart
t_render = time.time()
for j in jobs: render(j, 1)
render1_s = time.time() - t_render
vram_peak = smi("memory.used")

# ---------- speech recognition (Colab's own Python and card) ----------
from transformers import pipeline
t0 = time.time(); asr_pipe = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=0); asr_load_s = time.time() - t0
def run_asr(paths):
    out = {}
    for p in paths:
        a, _ = librosa.load(p, sr=16000)
        out[p] = asr_pipe({"raw": a, "sampling_rate": 16000}, generate_kwargs={"max_new_tokens": 48})["text"].strip() if a.size > 1600 else ""
    return out
t0 = time.time(); asr = run_asr([j["attempts"][0]["path"] for j in jobs]); asr1_s = time.time() - t0
for j in jobs: j["attempts"][0]["guard"] = guard(j, j["attempts"][0]["path"], asr[j["attempts"][0]["path"]])
retry = [j for j in jobs if not j["attempts"][0]["guard"]["ok"]]
for j in retry: render(j, 2)
if retry:
    asr2 = run_asr([j["attempts"][1]["path"] for j in retry])
    for j in retry: j["attempts"][1]["guard"] = guard(j, j["attempts"][1]["path"], asr2[j["attempts"][1]["path"]])

for j in jobs:
    good = [a for a in j["attempts"] if a["guard"]["ok"]]
    j["result"] = "ok" if j["attempts"][0]["guard"]["ok"] else ("retry-ok" if good else "fallback")
    j["use"] = good[0]["path"] if good else None
    print(f"{j['name']:14s} {j['result']:9s} {j['text'][:48]:48s} | " + " || ".join(
        f"a{a['attempt']} {a['compute_s']}s->{a['audio_s']}s {'OK' if a['guard']['ok'] else 'FAIL ' + str(a['guard']['why'])} asr='{a['guard']['asr']}'" for a in j["attempts"]))

first = [j["attempts"][0] for j in jobs]
comp = sum(a["compute_s"] for a in first); aud = sum(a["audio_s"] for a in first)
summary = dict(
    model="fishaudio/s2-pro", gpu=gpu, compiled=bool(os.environ.get("S2_COMPILE")), server_ready_s=round(load_s, 1), cond_s=cond_s, warmup_s=round(warm_s, 2),
    jobs=len(jobs), audio_s=round(aud, 1), compute_s=round(comp, 1), compute_per_audio_s=round(comp / max(aud, 1e-9), 3),
    render_wall_s=round(render1_s, 1), asr_load_s=round(asr_load_s, 1), asr_s=round(asr1_s, 1),
    card_used_after_load=vram_model, card_used_after_render=vram_peak,
    ok=sum(j["result"] == "ok" for j in jobs), retry_ok=sum(j["result"] == "retry-ok" for j in jobs), fallback=sum(j["result"] == "fallback" for j in jobs),
    script_wall_s=round(time.time() - T_START, 1))
json.dump(dict(summary=summary, jobs=jobs), open(f"{R}/cb_jobs.json", "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
with tarfile.open(f"{S}/run.tgz", "w:gz") as t: t.add(R, arcname="run")
print("SUMMARY " + json.dumps(summary))
