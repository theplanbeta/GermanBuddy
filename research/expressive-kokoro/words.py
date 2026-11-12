"""Per-word prosody from a WAV plus its whisper word timestamps (<file>.words.json).

python3 -I words.py file.wav [word ...]
For every word (or only the listed ones): duration, F0 median / max (Hz), F0 slope (st, last third
minus first third), RMS dB, and the pause after it. Used to check emphasis and clause-final contours.
"""
import json
import sys

import numpy as np
import os
import parselmouth
FLOOR = float(os.environ.get("F0_FLOOR", 110))
CEIL = float(os.environ.get("F0_CEIL", 550))


def word_stats(path, only=None):
    words = json.load(open(path[:-4] + ".words.json"))
    snd = parselmouth.Sound(path)
    x = snd.values[0]
    sr = snd.sampling_frequency
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=FLOOR, pitch_ceiling=CEIL)
    f0 = pitch.selected_array["frequency"]
    t = pitch.xs()
    out = []
    for i, w in enumerate(words):
        s, e = w["s"], w["e"]
        if s is None or e is None:
            continue
        key = w["w"].lower().strip(".,!?\"'…")
        if only and key not in only:
            continue
        m = (t >= s) & (t <= e) & (f0 > 0)
        seg = x[int(s * sr):int(e * sr)]
        rms = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -99
        st = 12 * np.log2(f0[m] / 100) if m.sum() else np.array([])
        slope = None
        if len(st) >= 6:
            k = len(st) // 3
            slope = float(np.median(st[-k:]) - np.median(st[:k]))
        nxt = words[i + 1]["s"] if i + 1 < len(words) and words[i + 1]["s"] is not None else None
        out.append({
            "w": w["w"], "s": s, "dur": round(e - s, 2),
            "f0": round(float(np.median(f0[m])), 0) if m.sum() else 0,
            "f0max": round(float(f0[m].max()), 0) if m.sum() else 0,
            "slope": None if slope is None else round(slope, 1),
            "rms": round(float(rms), 1),
            "gap": None if nxt is None else round(nxt - e, 2),
        })
    return out


if __name__ == "__main__":
    f = sys.argv[1]
    only = set(a.lower() for a in sys.argv[2:]) or None
    for r in word_stats(f, only):
        print(f"{r['w']:<16} t {r['s']:6.2f} dur {r['dur']:.2f} f0 {r['f0']:4.0f} max {r['f0max']:4.0f} slope {r['slope']} rms {r['rms']:6.1f} gap {r['gap']}")
