"""Render every Chatterbox job needed by H1/H2 with the guard:
 attempt 1 (seed s) -> guard (ASR words + plausible length + no long internal silence) -> attempt 2 (seed s+500) -> else fallback.
Jobs: each quoted part (H2 superset; whisper/soft categories in two variants: plain and [whispering]) and each laugh insert.
Writes out/hyb/cb/<job>_a<n>.wav and out/hyb/cb_jobs.json (compute, tokens, guard)."""
import sys, os, json, time, re, subprocess, difflib
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from cbt import CBT
from scene import write_wav, frame_db
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
H = f"{W}/out/hyb"; os.makedirs(f"{H}/cb", exist_ok=True)
plan = json.load(open(f"{H}/plan.json"))["plan"]
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
def words(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", s)
    return re.findall(r"[a-z0-9']+", s)
LAUGHY = re.compile(r"^(h+[aeiou]+h*|ah+|eh+|heh|hah|ha|he|hm+|mm+|oh|uh|you)$")
def guard(j, path, asr):
    from scene import read_wav
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
        r.update(ok=ok, why=None if ok else f"words={ws} core={core:.2f}")
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
def run_asr(paths):
    env = dict(os.environ, NODE_USE_ENV_PROXY="1", NODE_EXTRA_CA_CERTS="/root/.ccr/ca-bundle.crt")
    out = subprocess.run(["node", f"{W}/scripts/asr.mjs"] + paths, capture_output=True, text=True, env=env).stdout
    return {json.loads(l)["file"]: json.loads(l)["text"] for l in out.strip().splitlines()}
t0 = time.time(); m = CBT(f"{W}/dl/cbt"); load_s = time.time() - t0
t0 = time.time()
for v in ("af_aoede", "am_fenrir"): m.voice(f"{W}/refs/{v}.wav")
cond_s = time.time() - t0
la = [os.getloadavg()[0]]
def render(j, attempt):
    seed = j["seed"] + (500 if attempt == 2 else 0)
    t = time.time(); w = m.synth(j["text"], f"{W}/refs/{j['voice']}.wav", seed=seed); dt = time.time() - t
    path = f"{H}/cb/{j['name']}_a{attempt}.wav"
    peak = float(np.abs(w).max()); write_wav(path, w, m.sr)  # write_wav scales down only if peak > 0.98
    j.setdefault("attempts", []).append(dict(attempt=attempt, seed=seed, compute_s=round(dt, 2), audio_s=round(len(w) / m.sr, 2), raw_peak=round(peak, 3), path=path, **m.last))
    la.append(os.getloadavg()[0])
for j in jobs: render(j, 1)
asr = run_asr([j["attempts"][0]["path"] for j in jobs])
for j in jobs: j["attempts"][0]["guard"] = guard(j, j["attempts"][0]["path"], asr[os.path.basename(j["attempts"][0]["path"])])
retry = [j for j in jobs if not j["attempts"][0]["guard"]["ok"]]
for j in retry: render(j, 2)
if retry:
    asr2 = run_asr([j["attempts"][1]["path"] for j in retry])
    for j in retry: j["attempts"][1]["guard"] = guard(j, j["attempts"][1]["path"], asr2[os.path.basename(j["attempts"][1]["path"])])
for j in jobs:
    good = [a for a in j["attempts"] if a["guard"]["ok"]]
    j["result"] = "ok" if j["attempts"][0]["guard"]["ok"] else ("retry-ok" if good else "fallback")
    j["use"] = good[0]["path"] if good else None
    print(f"{j['name']:16s} {j['result']:9s} {j['text'][:48]:48s} | " + " || ".join(f"a{a['attempt']} {a['compute_s']}s->{a['audio_s']}s tok{a['tokens']} {'OK' if a['guard']['ok'] else 'FAIL ' + str(a['guard']['why'])} asr='{a['guard']['asr']}'" for a in j["attempts"]))
json.dump(dict(load_s=round(load_s, 2), cond_s=round(cond_s, 2), loadavg=[round(x, 2) for x in la], jobs=jobs), open(f"{H}/cb_jobs.json", "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
