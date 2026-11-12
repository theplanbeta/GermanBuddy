"""Summary statistics for ablate.mjs renders.
python3 -I abl_stats.py dir/name1 dir/name2 ...   (without extension)
rate    phonemes per second of the sentence's own token durations (pads excluded), mean and CV
final   duration of the sentence-final rime (tokens after the last vowel symbol, before the full stop), ms
f0      median F0 (Hz) and 5-95% range (st) per sentence, averaged; start = sd of sentence-initial F0 (st)
decl    F0 slope within a sentence: last third minus first third (st)
sil     silence between sentences (s): mean / sd, excluding paragraph ends
rms/hnr level of speech, harmonics-to-noise
"""
import json, sys, re
import numpy as np, parselmouth
VOW = set("aeiouæɑɐɒɔəɚɛɜɪʊʌᵻyøœAIOWYQɨ")
PH = re.compile(r"[ˈˌː\s;:,.!?—…\"“”]")
def stats(base):
    d = json.load(open(base + ".json"))["sentences"]
    snd = parselmouth.Sound(base + ".wav"); x = snd.values[0]; sr = snd.sampling_frequency
    P = snd.to_pitch_ac(time_step=0.01, pitch_floor=110, pitch_ceiling=550); f0 = P.selected_array["frequency"]; tt = P.xs()
    H = snd.to_harmonicity_cc(time_step=0.01); hv = H.values[0]; ht = H.xs()
    rates, finals, meds, rngs, starts, decl, rms, hnr = [], [], [], [], [], [], [], []
    for s in d:
        ch = list(s["ph"]); td = s["tokDur"][: len(ch)]
        ph_n = sum(1 for c in ch if not PH.match(c))
        span = sum(td[i] for i, c in enumerate(ch) if not re.match(r"[;:,.!?—…\"“”]", c))
        rates.append(ph_n / span)
        # final rime: from the last vowel to the end, excluding trailing punctuation
        j = len(ch) - 1
        while j > 0 and re.match(r"[;:,.!?—…\"“” ]", ch[j]): j -= 1
        k = j
        while k > 0 and ch[k] not in VOW: k -= 1
        finals.append(1000 * sum(td[k:j + 1]))
        m = (tt >= s["speechStart"]) & (tt <= s["speechEnd"]) & (f0 > 0)
        st = 12 * np.log2(f0[m] / 100)
        if len(st) > 10:
            meds.append(np.median(f0[m])); rngs.append(np.percentile(st, 95) - np.percentile(st, 5))
            starts.append(np.median(st[:30])); n3 = len(st) // 3; decl.append(np.median(st[-n3:]) - np.median(st[:n3]))
        seg = x[int(s["speechStart"] * sr):int(s["speechEnd"] * sr)]; rms.append(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
        hm = (ht >= s["speechStart"]) & (ht <= s["speechEnd"]); h = hv[hm]; h = h[h > -100]; hnr.append(np.mean(h))
    sil = [s["silenceAfter"] for s in d[:-1] if s["design"] < 0.8]
    rates = np.array(rates)
    return {"name": base.split("/")[-1], "total": round(len(x) / sr, 1), "rows": sorted(set(s["row"] for s in d)), "rate": round(rates.mean(), 2), "rateCV": round(100 * rates.std() / rates.mean(), 1),
            "final_ms": round(float(np.mean(finals))), "f0": round(float(np.mean(meds))), "f0rng": round(float(np.mean(rngs)), 1), "startSD": round(float(np.std(starts)), 2),
            "decl": round(float(np.mean(decl)), 2), "sil": round(float(np.mean(sil)), 2), "silSD": round(float(np.std(sil)), 2), "rms": round(float(np.mean(rms)), 1), "hnr": round(float(np.mean(hnr)), 1)}
for b in sys.argv[1:]:
    r = stats(b)
    print(f"{r['name']:<34} total {r['total']:5.1f}s  rate {r['rate']:5.2f} ph/s (cv {r['rateCV']:4.1f}%)  final {r['final_ms']:3d} ms  f0 {r['f0']} Hz rng {r['f0rng']:4.1f} st  startSD {r['startSD']:.2f}  decl {r['decl']:+.2f}  sil {r['sil']:.2f}±{r['silSD']:.2f}  rms {r['rms']:.1f}  hnr {r['hnr']:.1f}  rows {r['rows'][:4]}{'…' if len(r['rows'])>4 else ''}")
