"""Assemble H1 (with / without laugh inserts) and H2 from prank_C_voices.wav slices, Kokoro part renders and
guarded Chatterbox renders. One gain per Chatterbox voice (matched on neutral lines), plus the C style's own
gainDb for quiet styles (Chatterbox has no quiet control). Writes WAVs to WORK and out/hyb/assembly.json."""
import sys, json, os
import numpy as np
# Workbench copy of research/dialogue-hybrid/models/hybrid/assemble.py. Only the paths differ:
#   python3 assemble.py <run>   reads out/hyb/plan.json, out/hyb/kok/ and the Colab run in
#   out/runs/<run>/ (cb_jobs.json + cb/*.wav); writes the listening files to out/runs/<run>/.
from wavio import read_wav, write_wav, frame_db
HERE = os.path.dirname(os.path.abspath(__file__))
RUN = sys.argv[1]
D = f"{HERE}/out"
H = f"{D}/hyb"; SR = 24000
W = f"{D}/runs/{RUN}"
# optional second argument: another plan file (the S2-Pro run adds two breathing inserts to it)
plan = json.load(open(sys.argv[2] if len(sys.argv) > 2 else f"{H}/plan.json"))["plan"]
jobs = {j["name"]: j for j in json.load(open(f"{W}/cb_jobs.json"))["jobs"]}
for j in jobs.values():  # the paths in cb_jobs.json are the Colab machine's; point them at the download
    if j["use"]: j["use"] = f"{W}/cb/{os.path.basename(j['use'])}"
C, sr = read_wav(f"{D}/prank_C_voices.wav"); assert sr == SR
QUIET = ("whisper", "soft", "softsay", "tremble")
WHISPER_VARIANT = "whisp"  # measured: [whispering] slightly less voiced (0.70 vs 0.76) and -1.2 dB vs plain on 11 lines

def level(a):
    db = frame_db(a, SR, 0.02); act = db > db.max() - 40
    return float(10 * np.log10(np.mean(10 ** (db[act] / 10))))
def edges(a, rel=45):
    db = frame_db(a, SR, 0.01); idx = np.where(db > db.max() - rel)[0]
    return (idx[0] * 0.01, len(a) / SR - (idx[-1] + 1) * 0.01) if idx.size else (0, 0)
def trim_to(a, lead, tail, rel=45):
    db = frame_db(a, SR, 0.01); idx = np.where(db > db.max() - rel)[0]
    s, e = int(idx[0] * 0.01 * SR), int((idx[-1] + 1) * 0.01 * SR)
    return np.concatenate([np.zeros(int(lead * SR), np.float32), a[s:e], np.zeros(int(tail * SR), np.float32)])
def gain(a, db): return a * (10 ** (db / 20))

# C sentence slices
def cslice(i):
    e = plan[i]; end = e["end"] if e["end"] is not None else len(C)
    return C[e["start"]:end].copy()
# Kokoro edge margins in C (median over sentences) -> used for every Chatterbox piece
m = np.array([edges(cslice(i)) for i in range(len(plan))])
LEAD, TAIL = float(np.median(m[:, 0])), float(np.median(m[:, 1]))

def cb_name(e, k, p):
    if p["cat"] in ("whisper", "soft", "softsay"): return f"s{e['i']:02d}p{k}_{WHISPER_VARIANT}"
    return f"s{e['i']:02d}p{k}"
def cb_audio(name):
    j = jobs[name]
    return None if j["use"] is None else read_wav(j["use"])[0]
# per-voice gain from neutral whole-sentence quote lines: Kokoro C slice vs Chatterbox render of the same line
G = {}; gain_rows = {}
for v in ("af_aoede", "am_fenrir"):
    d = []
    for e in plan:
        if len(e["parts"]) == 1 and e["parts"][0]["quote"] and e["parts"][0]["voice"] == v and e["parts"][0]["cat"] == "neutral":
            a = cb_audio(cb_name(e, 0, e["parts"][0]))
            if a is not None: d.append((e["i"], level(cslice(e["i"])), level(a)))
    G[v] = float(np.median([k - c for _, k, c in d])); gain_rows[v] = d
LIMIT = 0.95
def piece_for(e, k, p, use_cb):
    if use_cb:
        a = cb_audio(cb_name(e, k, p))
        if a is not None:
            g = G[p["voice"]] + (p["style"].get("gainDb", 0) if p["cat"] in QUIET else 0)
            a = gain(trim_to(a, LEAD, TAIL), g); pk = float(np.abs(a).max()); lim = None
            if pk > LIMIT: a = a * (LIMIT / pk); lim = round(20 * np.log10(LIMIT / pk), 1)
            return a, dict(engine="CB", job=cb_name(e, k, p), gain_db=round(g, 1), limited_db=lim)
        use_cb = False  # fallback
    if len(e["parts"]) == 1: return cslice(e["i"]), dict(engine="K", src="C slice")
    a = read_wav(f"{H}/kok/s{e['i']:02d}p{k}.wav")[0]
    return trim_to(a, LEAD, TAIL), dict(engine="K", src="K part render")
def build(name, mode, inserts):
    out = []; rows = []; t = 0.0
    for e in plan:
        sel = [(p["h1"] if mode == "H1" else p["h2"]) for p in e["parts"]]
        if not any(sel):
            a = cslice(e["i"]); info = [dict(engine="K", src="C slice")]
        else:
            segs = []; info = []
            for k, p in enumerate(e["parts"]):
                x, inf = piece_for(e, k, p, sel[k]); segs.append(x); info.append(dict(inf, text=p["text"], voice=p["voice"], tag=(p["tag"] if p["cat"] not in ("whisper", "soft", "softsay") else "[whispering]") if inf["engine"] == "CB" else "", cat=p["cat"]))
                if k < len(e["parts"]) - 1: segs.append(np.zeros(int(0.12 * SR), np.float32))
            a = np.concatenate(segs)
        start = t; out.append(a); t += len(a) / SR
        pause = e["pause"]; ins = None
        if inserts and e["insert"]:
            j = jobs[f"s{e['i']:02d}laugh"]
            if j["use"]:
                la = trim_to(read_wav(j["use"])[0], 0, 0)
                # laughs vary ~12 dB between renders: per-insert level = that voice's Kokoro neutral speech median - 3 dB
                tgt = float(np.median([k for _, k, _ in gain_rows[e["insert"]["voice"]]])) - 3
                g = tgt - level(la); la = gain(la, g)
                pk = float(np.abs(la).max()); lim = None
                if pk > LIMIT: la = la * (LIMIT / pk); lim = round(20 * np.log10(LIMIT / pk), 1)
                pre = 0.25; rest = max(pause - pre - len(la) / SR, 0.4)
                out += [np.zeros(int(pre * SR), np.float32), la]; t += pre + len(la) / SR
                ins = dict(job=j["name"], voice=e["insert"]["voice"], text=e["insert"]["text"], dur=round(len(la) / SR, 2), gain_db=round(g, 1), limited_db=lim,
                           pause_was=pause, pause_now=round(pre + len(la) / SR + rest, 2))
                pause = rest
        out.append(np.zeros(int(round(pause * SR)), np.float32)); t += pause
        rows.append(dict(i=e["i"], start=round(start, 2), dur=round(len(a) / SR, 2), text=e["text"], parts=info, insert=ins))
    full = np.concatenate(out); pk = float(np.abs(full).max())
    write_wav(f"{W}/{name}.wav", full, SR)
    return dict(file=f"{W}/{name}.wav", dur=round(len(full) / SR, 2), peak=round(pk, 3), clipped=int((np.abs(full) >= 0.999).sum()), rows=rows)
res = dict(lead=LEAD, tail=TAIL, gains=G, gain_rows=gain_rows,
           H1=build("prank_H1_hybrid_minimal", "H1", True), H1n=build("prank_H1_hybrid_minimal_nolaughs", "H1", False),
           H2=build("prank_H2_hybrid_dialogue", "H2", False), H2i=build("prank_H2_hybrid_dialogue_laughs", "H2", True), C=dict(dur=round(len(C) / SR, 2)))
json.dump(res, open(f"{W}/assembly.json", "w"), indent=1, default=float)
print("margins lead/tail", round(LEAD, 3), round(TAIL, 3), "gains", {k: round(v, 2) for k, v in G.items()})
for v, d in gain_rows.items(): print(v, [(i, round(k, 1), round(c, 1)) for i, k, c in d])
for k in ("H1", "H1n", "H2", "H2i"): print(k, res[k]["file"].split("/")[-1], res[k]["dur"], "peak", res[k]["peak"], "clipped", res[k]["clipped"])
print("C", res["C"]["dur"])
