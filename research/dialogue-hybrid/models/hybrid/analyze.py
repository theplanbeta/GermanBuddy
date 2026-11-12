"""Measurements for the hybrid renders: per-line table, levels after matching, join steps, voice difference
(clone vs Kokoro original, and Kokoro-vs-Kokoro / CB-vs-CB for scale), cost and look-ahead."""
import sys, json, re
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/pylib")
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np, parselmouth
from scene import read_wav, frame_db
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
D = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/dialogue"
H = f"{W}/out/hyb"; SR = 24000
plan = json.load(open(f"{H}/plan.json"))["plan"]; A = json.load(open(f"{H}/assembly.json"))
J = json.load(open(f"{H}/cb_jobs.json")); jobs = {j["name"]: j for j in J["jobs"]}
C, _ = read_wav(f"{D}/prank_C_voices.wav")
G = A["gains"]
def cslice(i):
    e = plan[i]; end = e["end"] if e["end"] is not None else len(C); return C[e["start"]:end]
def level(a):
    db = frame_db(a, SR, 0.02); act = db > db.max() - 40
    return float(10 * np.log10(np.mean(10 ** (db[act] / 10))))
def g(a, db): return a * 10 ** (db / 20)
QUIET = ("whisper", "soft", "softsay", "tremble")
def cbname(i, k, p): return f"s{i:02d}p{k}_whisp" if p["cat"] in ("whisper", "soft", "softsay") else f"s{i:02d}p{k}"
def cbmatched(i, k, p):
    a = read_wav(jobs[cbname(i, k, p)]["use"])[0]
    return g(a, G[p["voice"]] + (p["style"].get("gainDb", 0) if p["cat"] in QUIET else 0))
def kokline(i, k):
    e = plan[i]
    return cslice(i) if len(e["parts"]) == 1 else read_wav(f"{H}/kok/s{i:02d}p{k}.wav")[0]
# ---------- 1. line table + levels after matching ----------
print("== line table (quoted parts; K = Kokoro C, CB = Chatterbox)")
print("sent voice     cat      H1  H2  tags(H1/H2)            guard       CB-K level dB | text")
lv = {"H1": [], "H2": []}
for e in plan:
    for k, p in enumerate(e["parts"]):
        if not p["quote"]: continue
        n = cbname(e["i"], k, p); j = jobs[n]
        d = level(cbmatched(e["i"], k, p)) - level(kokline(e["i"], k)) if j["use"] else float("nan")
        if j["use"]:
            lv["H2"].append((p["cat"], d))
            if p["h1"]: lv["H1"].append((p["cat"], d))
        t1 = p["tag"] if p["h1"] else "-"; t2 = "[whispering]" if p["cat"] in ("whisper", "soft", "softsay") else (p["tag"] or "none")
        gd = j["result"] + "".join(f" a{a['attempt']}:{'ok' if a['guard']['ok'] else 'X'}" for a in j["attempts"])
        print(f"{e['i']:3d}  {p['voice']:9s} {p['cat']:8s} {'CB' if p['h1'] else 'K ':3s} CB  {t1 or 'none':8s}/{t2:12s}  {gd:11s} {d:+6.1f}       | {p['src'][:50]}")
    if e["insert"]:
        j = jobs[f"s{e['i']:02d}laugh"]
        print(f"{e['i']:3d}+ {e['insert']['voice']:9s} insert   CB  --  {e['insert']['text']:21s}  {j['result']:11s}          | (after) {e['text'][:45]}")
for f, L in lv.items():
    by = {}
    for c, d in L: by.setdefault(c, []).append(d)
    print(f"{f}: CB-minus-Kokoro level per line after matching: mean {np.mean([d for _, d in L]):+.1f} dB, |d| median {np.median([abs(d) for _, d in L]):.1f}, range {min(d for _, d in L):+.1f}..{max(d for _, d in L):+.1f};",
          " ".join(f"{c}:{np.mean(v):+.1f}(n{len(v)})" for c, v in by.items()))
# ---------- 2. joins: level of each speech piece in the assembled files, step at engine switches ----------
def pieces(res):
    out = []
    for r in res["rows"]:
        for p in r["parts"]: out.append(p["engine"])
    return out
print("\n== level steps between consecutive sentences (assembled file, active-frame RMS)")
for key in ("H1", "H2"):
    res = A[key]; a, _ = read_wav(res["file"]); steps = {"switch": [], "same": []}
    prev = None
    for r in res["rows"]:
        s0 = int(r["start"] * SR); x = a[s0:s0 + int(r["dur"] * SR)]
        eng = "CB" if any(p["engine"] == "CB" for p in r["parts"]) else "K"
        L = level(x)
        if prev: steps["switch" if prev[0] != eng else "same"].append(abs(L - prev[1]))
        prev = (eng, L)
    print(f"{key}: engine switches {len(steps['switch'])}, |step| median {np.median(steps['switch']):.1f} dB (max {max(steps['switch']):.1f}); same-engine neighbours |step| median {np.median(steps['same']):.1f} dB (max {max(steps['same']):.1f})")
# ---------- 3. voice difference ----------
MEL = None
def melspec(a):
    global MEL
    n = 1024; hop = 240
    if MEL is None:
        f = np.fft.rfftfreq(n, 1 / SR); mel = lambda x: 2595 * np.log10(1 + x / 700)
        edges = 700 * (10 ** (np.linspace(mel(60), mel(10000), 42) / 2595) - 1)
        MEL = np.array([np.clip(np.minimum((f - edges[b]) / (edges[b + 1] - edges[b]), (edges[b + 2] - f) / (edges[b + 2] - edges[b + 1])), 0, None) for b in range(40)])
    fr = np.lib.stride_tricks.sliding_window_view(a, n)[::hop] * np.hanning(n)
    S = np.abs(np.fft.rfft(fr, axis=1)) ** 2 @ MEL.T
    return 10 * np.log10(S + 1e-12)
def feats(a, text):
    db = frame_db(a, SR, 0.01); top = db.max(); act = db > top - 40; idx = np.where(act)[0]
    core = a[int(idx[0] * 0.01 * SR):int((idx[-1] + 1) * 0.01 * SR)]
    cdb = db[idx[0]:idx[-1] + 1]
    M = melspec(core); fdb = M.max(1); env = M[fdb > fdb.max() - 25].mean(0); env = env - env.mean()
    p = parselmouth.Sound(core.astype(np.float64), SR).to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=500).selected_array["frequency"]
    v = p[p > 0]
    letters = len(re.sub(r"\[[a-z ]+\]|\W", "", text.lower()))
    # tail decay: 10 ms frames after the last frame within 20 dB of max until below max-50
    last = np.where(db > top - 20)[0][-1]; after = db[last:]; below = np.where(after < top - 50)[0]
    hf = M[fdb > fdb.max() - 25][:, -6:].mean() - M[fdb > fdb.max() - 25][:, 10:20].mean()
    return dict(f0=np.median(v) if v.size else np.nan, env=env, rate=letters / (len(core) / SR),
                floor=float(np.percentile(cdb, 5) - top), hf=float(hf), tail=float(below[0] * 0.01) if below.size else np.nan)
def setfeats(lines): return [feats(a, t) for a, t in lines]
def summ(F):
    return dict(f0=np.nanmedian([f["f0"] for f in F]), rate=np.mean([f["rate"] for f in F]), floor=np.mean([f["floor"] for f in F]),
                hf=np.mean([f["hf"] for f in F]), tail=np.nanmean([f["tail"] for f in F]), env=np.mean([f["env"] for f in F], 0))
def cmp(F1, F2):
    a, b = summ(F1), summ(F2)
    return dict(f0_st=12 * np.log2(b["f0"] / a["f0"]), env_db=float(np.sqrt(np.mean((a["env"] - b["env"]) ** 2))), rate_pct=100 * (b["rate"] / a["rate"] - 1),
                floor_db=b["floor"] - a["floor"], hf_db=b["hf"] - a["hf"], tail_ms=1000 * (b["tail"] - a["tail"]), a=a, b=b)
print("\n== voice difference (same lines; neutral/laugh/excited/sweet/shout categories, Kokoro C vs Chatterbox clone)")
OKC = ("neutral", "laugh", "excited", "sweet")
for v in ("af_aoede", "am_fenrir"):
    K = []; B = []
    for e in plan:
        for k, p in enumerate(e["parts"]):
            if p["quote"] and p["voice"] == v and p["cat"] in OKC and jobs[cbname(e["i"], k, p)]["use"]:
                K.append((kokline(e["i"], k), p["src"])); B.append((read_wav(jobs[cbname(e["i"], k, p)]["use"])[0], p["src"]))
    FK, FB = setfeats(K), setfeats(B)
    x = cmp(FK, FB); kk = cmp(FK[0::2], FK[1::2]); bb = cmp(FB[0::2], FB[1::2])
    print(f"{v}: n={len(K)} lines. Kokoro F0 {x['a']['f0']:.0f} Hz, clone {x['b']['f0']:.0f} Hz; rate Kokoro {x['a']['rate']:.1f} vs clone {x['b']['rate']:.1f} letters/s; "
          f"noise floor (5th pct frame re line max) Kokoro {x['a']['floor']:.0f} dB vs clone {x['b']['floor']:.0f} dB; HF(>~7kHz re 1-2kHz) Kokoro {x['a']['hf']:.0f} vs clone {x['b']['hf']:.0f} dB; tail decay Kokoro {1000*x['a']['tail']:.0f} ms vs clone {1000*x['b']['tail']:.0f} ms")
    for nm, r in (("clone vs Kokoro", x), ("Kokoro vs Kokoro (even/odd lines)", kk), ("clone vs clone (even/odd)", bb)):
        print(f"   {nm:34s} pitch {r['f0_st']:+5.1f} st  envelope {r['env_db']:4.1f} dB  rate {r['rate_pct']:+5.0f}%  floor {r['floor_db']:+5.1f} dB  HF {r['hf_db']:+5.1f} dB  tail {r['tail_ms']:+5.0f} ms")
    # where the envelopes differ most
    d = x["b"]["env"] - x["a"]["env"]; bands = np.argsort(-np.abs(d))[:4]
    print("   largest envelope band differences (band index of 40 mel bands 60 Hz-10 kHz, clone minus Kokoro):", [(int(b), round(float(d[b]), 1)) for b in sorted(bands)])
    # reference clip itself vs Kokoro lines (how much the clone drifts from the clip it was given)
    R = feats(read_wav(f"{W}/refs/{v}.wav")[0], "The morning was quiet, and the old house creaked softly in the wind. She poured a cup of tea, opened the window, and listened to the birds outside.")
    print(f"   reference clip (Kokoro {v}, 9 s): F0 {R['f0']:.0f} Hz, rate {R['rate']:.1f} letters/s, envelope distance to Kokoro lines {np.sqrt(np.mean((R['env']-x['a']['env'])**2)):.1f} dB, to clone lines {np.sqrt(np.mean((R['env']-x['b']['env'])**2)):.1f} dB")
# ---------- 4. cost & look-ahead ----------
print("\n== cost")
total_letters = sum(len(re.sub(r"\W", "", e["text"])) for e in plan)
for key, file in (("H1", "H1"), ("H2", "H2")):
    res = A[file]; n_l = 0; sec = 0; comp = 0; items = []
    for r in res["rows"]:
        off = 0.0
        for p in r["parts"]:
            if p["engine"] == "CB":
                j = jobs[p["job"]]; a = [x for x in j["attempts"] if x["path"] == j["use"]][0]
                n_l += len(re.sub(r"\W", "", p["text"])); sec += a["audio_s"]; c = sum(x["compute_s"] for x in j["attempts"]); comp += c
                items.append((r["start"] + off, c))
            off += 0  # quote parts are first in all mixed sentences but 14 (narration first); ignored (<2.5 s)
        if r["insert"]:
            j = jobs[r["insert"]["job"]]; c = sum(x["compute_s"] for x in j["attempts"]); a = [x for x in j["attempts"] if x["path"] == j["use"]][0]
            sec += a["audio_s"]; comp += c; items.append((r["start"] + r["dur"] + 0.25, c))
    items.sort(); ready = np.cumsum([c for _, c in items]); need = np.array([t for t, _ in items])
    lead = max(0.0, float(np.max(ready - need)))
    # with Chatterbox starting at the same moment as playback, how far behind is the worst line
    print(f"{key}: {len(items)} Chatterbox renders, {n_l} of {total_letters} letters ({100*n_l/total_letters:.0f}%), {sec:.1f} s of Chatterbox audio in a {res['dur']:.1f} s file ({100*sec/res['dur']:.0f}%), compute {comp:.1f} s "
          f"(this CPU, 4 threads, load avg during run up to {max(J['loadavg']):.1f}, mostly this process), sequential-from-t0 needs a head start of {lead:.1f} s; first CB line needed at {items[0][0]:.1f} s")
print(f"model load {J['load_s']} s, voice conditioning for 2 voices {J['cond_s']} s (one-off)")
