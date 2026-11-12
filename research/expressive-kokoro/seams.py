"""Within-call sentence boundaries vs seams between calls. python3 -I seams.py dir/name ..."""
import json, sys, re
import numpy as np, parselmouth
VOW = set("aeiouæɑɐɒɔəɚɛɜɪʊʌᵻyøœ")
for base in sys.argv[1:]:
    d = json.load(open(base + ".json"))["sentences"]
    snd = parselmouth.Sound(base + ".wav"); P = snd.to_pitch_ac(time_step=0.01, pitch_floor=110, pitch_ceiling=550)
    f0 = P.selected_array["frequency"]; tt = P.xs()
    def edge(sent, first):
        m = (tt >= sent["speechStart"]) & (tt <= sent["speechEnd"]) & (f0 > 0); v = 12 * np.log2(f0[m] / 100)
        if len(v) < 20: return None
        return float(np.median(v[:20] if first else v[-20:]))  # first / last 20 voiced frames
    def fin(s):
        ch = list(s["ph"]); td = s["tokDur"]; j = len(ch) - 1
        while j > 0 and re.match(r"[;:,.!?—…\"“” ]", ch[j]): j -= 1
        k = j
        while k > 0 and ch[k] not in VOW: k -= 1
        return 1000 * sum(td[k:j + 1])
    rows = {"within": [], "seam": []}
    for a, b in zip(d, d[1:]):
        e = edge(a, False); s = edge(b, True)
        if e is None or s is None: continue
        rows["within" if a["gi"] == b["gi"] else "seam"].append((s - e, s, fin(a)))
    out = []
    for k, v in rows.items():
        if v: v = np.array(v); out.append(f"{k} n={len(v)} F0 step {v[:,0].mean():+.1f}±{v[:,0].std():.1f} st, next start {v[:,1].mean():.1f} st, final rime {v[:,2].mean():.0f} ms")
    print(f"{base.split('/')[-1]:<24}", " | ".join(out))
