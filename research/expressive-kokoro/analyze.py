"""Acoustic measurements for A/B clips.

python3 -I analyze.py a.wav [b.wav ...]          -> one summary line per file
python3 -I analyze.py --json a.wav ...           -> JSON per file (with pause list)
python3 -I analyze.py --tail 0.6 a.wav           -> also F0 slope of the last 0.6 s of speech

Measures (Praat via parselmouth):
  dur      total seconds
  speech   seconds of non-pause audio
  f0       median F0 (Hz) of voiced frames
  rng      F0 range in semitones (5th..95th percentile)
  sd       F0 standard deviation in semitones
  vf       voiced fraction of speech time (whisper -> low)
  rms      RMS level of speech portions, dBFS
  hnr      harmonics-to-noise ratio (dB) - breathy / whispery voices are lower
  pauses   internal silences >= 120 ms: count, total seconds, list (start, length)
  tailst   F0 movement over the last voiced 0.5 s in semitones (+ rising, - falling)
"""
import json
import sys

import numpy as np
import os
import parselmouth
FLOOR = float(os.environ.get("F0_FLOOR", 110))
CEIL = float(os.environ.get("F0_CEIL", 550))

SIL_DB = -40.0  # relative to the file's peak frame
MIN_PAUSE = 0.12


def frames_rms(x, sr, hop=0.01, win=0.03):
    h, w = int(sr * hop), int(sr * win)
    n = max(1, (len(x) - w) // h + 1)
    r = np.array([np.sqrt(np.mean(x[i * h:i * h + w] ** 2) + 1e-12) for i in range(n)])
    return 20 * np.log10(r), hop


def pauses_of(db, hop, total):
    thr = db.max() + SIL_DB
    sil = db < thr
    out = []
    i = 0
    n = len(sil)
    # skip leading / trailing silence
    first = np.argmax(~sil) if (~sil).any() else 0
    last = n - np.argmax((~sil)[::-1]) if (~sil).any() else n
    i = first
    while i < last:
        if sil[i]:
            j = i
            while j < last and sil[j]:
                j += 1
            L = (j - i) * hop
            if L >= MIN_PAUSE and j < last:
                out.append((round(i * hop, 2), round(L, 2)))
            i = j
        else:
            i += 1
    lead = first * hop
    trail = (n - last) * hop
    return out, lead, trail, sil, thr


def analyze(path, tail=0.5):
    snd = parselmouth.Sound(path)
    x = snd.values[0]
    sr = snd.sampling_frequency
    dur = len(x) / sr
    db, hop = frames_rms(x, sr)
    pauses, lead, trail, sil, thr = pauses_of(db, hop, dur)
    speech_mask = ~sil
    speech = speech_mask.sum() * hop
    # level of speech frames
    lin = 10 ** (db[speech_mask] / 20)
    rms = 20 * np.log10(np.sqrt(np.mean(lin ** 2))) if len(lin) else -99
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=FLOOR, pitch_ceiling=CEIL)
    f0 = pitch.selected_array["frequency"]
    t = pitch.xs()
    voiced = f0 > 0
    st = 12 * np.log2(f0[voiced] / 100.0) if voiced.any() else np.array([0.0])
    vf = voiced.sum() * 0.01 / max(speech, 1e-6)
    hnr = snd.to_harmonicity_cc(time_step=0.01)
    hv = hnr.values[0]
    hv = hv[hv > -100]
    # final contour: last `tail` seconds that contain voicing
    tailst = None
    if voiced.sum() > 10:
        tv = t[voiced]
        sv = st
        end = tv[-1]
        m = tv >= end - tail
        if m.sum() > 4:
            k = max(2, m.sum() // 3)
            tailst = float(np.median(sv[m][-k:]) - np.median(sv[m][:k]))
    # stats of the stretch after the last internal pause (e.g. the "what" in "Wait... what?!")
    seg_from = (pauses[-1][0] + pauses[-1][1]) if pauses else lead
    seg_to = dur - trail
    sm = voiced & (t >= seg_from) & (t <= seg_to)
    last = None
    if sm.sum() > 3:
        a = int(seg_from * sr); b = int(seg_to * sr)
        last = {"dur": round(seg_to - seg_from, 2), "f0": round(float(np.median(f0[sm])), 0), "f0max": round(float(np.percentile(f0[sm], 95)), 0),
                "rms": round(float(20 * np.log10(np.sqrt(np.mean(x[a:b] ** 2)) + 1e-9)), 1)}
    # spectral tilt of speech frames: level of 1-4 kHz band minus 0-1 kHz band (dB). Shouted / pressed
    # voice is flatter (less negative); soft / breathy voice is steeper.
    from numpy.fft import rfft
    h, w = int(sr * 0.01), int(sr * 0.03)
    lo = hi = 1e-12
    win = np.hanning(w)
    for i in np.nonzero(speech_mask)[0]:
        seg = x[i * h:i * h + w]
        if len(seg) < w: continue
        S = np.abs(rfft(seg * win)) ** 2
        fq = np.arange(len(S)) * sr / w
        lo += S[fq < 1000].sum(); hi += S[(fq >= 1000) & (fq < 4000)].sum()
    tilt = 10 * np.log10(hi / lo)
    return {
        "tilt": round(float(tilt), 1),
        "last": last,
        "file": path.split("/")[-1],
        "dur": round(dur, 2),
        "speech": round(speech, 2),
        "lead": round(lead, 2),
        "trail": round(trail, 2),
        "f0": round(float(np.median(f0[voiced])), 1) if voiced.any() else 0,
        "rng": round(float(np.percentile(st, 95) - np.percentile(st, 5)), 1),
        "sd": round(float(np.std(st)), 2),
        "vf": round(float(min(vf, 1.0)), 2),
        "rms": round(float(rms), 1),
        "hnr": round(float(np.mean(hv)), 1) if len(hv) else 0,
        "npause": len(pauses),
        "pause_s": round(sum(p[1] for p in pauses), 2),
        "pauses": pauses,
        "tailst": None if tailst is None else round(tailst, 1),
    }


def line(r):
    ps = " ".join(f"{a:.2f}+{b:.2f}" for a, b in r["pauses"])
    return (f"{r['file']:<44} dur {r['dur']:5.2f} sp {r['speech']:5.2f} f0 {r['f0']:5.1f} rng {r['rng']:4.1f} sd {r['sd']:4.2f} "
            f"vf {r['vf']:.2f} rms {r['rms']:6.1f} hnr {r['hnr']:5.1f} tilt {r['tilt']:5.1f} tail {r['tailst']} last {r['last']} | {r['npause']}p {r['pause_s']:.2f}s [{ps}]")


if __name__ == "__main__":
    args = sys.argv[1:]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    tail = 0.5
    if "--tail" in args:
        i = args.index("--tail")
        tail = float(args[i + 1])
        del args[i:i + 2]
    for p in args:
        r = analyze(p, tail)
        print(json.dumps(r) if as_json else line(r))
