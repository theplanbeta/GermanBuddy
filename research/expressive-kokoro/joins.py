"""Measure every within-sentence join of a render.
python3 -I joins.py out.wav plan.json [label]
gap   = silence (frames < peak-40 dB) around the join, s
dF0   = F0 jump across the join, semitones (median of last 150 ms voiced before vs first 150 ms voiced after)
dRMS  = loudness step, dB (last 250 ms of speech before vs first 250 ms after)
"""
import json, sys, wave, re
import numpy as np, parselmouth
w = wave.open(sys.argv[1]); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32768
plan = json.load(open(sys.argv[2])); ch = plan['chunks'] if isinstance(plan, dict) else plan
label = sys.argv[3] if len(sys.argv) > 3 else ''
sr = 24000
snd = parselmouth.Sound(x, sr)
pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=110, pitch_ceiling=550)
f0 = pitch.selected_array['frequency']; tt = pitch.xs()
h = 240; db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + h] ** 2)) + 1e-9 for i in range(0, len(x) - h, h)]))
thr = db.max() - 40
def gap_at(t):
    i = int(t / 0.01)
    if i >= len(db): return 0, t, t
    # nearest silent frame within 0.15 s
    cand = [j for j in range(max(0, i - 15), min(len(db), i + 15)) if db[j] < thr]
    if not cand: return 0.0, t, t
    j = min(cand, key=lambda j: abs(j - i)); a = j; b = j
    while a > 0 and db[a - 1] < thr: a -= 1
    while b < len(db) - 1 and db[b + 1] < thr: b += 1
    return (b - a + 1) * 0.01, a * 0.01, (b + 1) * 0.01
def f0med(a, b):
    m = (tt >= a) & (tt <= b) & (f0 > 0)
    return float(np.median(12 * np.log2(f0[m] / 100))) if m.sum() >= 3 else None
def voiced_edge(t, direction, span=0.15):
    # first/last 150 ms of voicing after/before t (search up to 1 s)
    m = (f0 > 0) & ((tt > t) & (tt < t + 1.0) if direction > 0 else (tt < t) & (tt > t - 1.0))
    v = tt[m]
    if len(v) < 3: return None
    return f0med(v[0], v[0] + span) if direction > 0 else f0med(v[-1] - span, v[-1])
def rms(a, b):
    # level of the loudest half of the 10 ms frames in the window (ignores decay tails and onsets)
    i, j = int(max(a, 0) / 0.01), int(b / 0.01); v = np.sort(db[i:j])[::-1]
    return float(np.mean(v[:max(1, len(v) // 2)])) if len(v) else 0.0
joins = []
for i, c in enumerate(ch):
    if c.get('joinsAt'):
        for j in c['joinsAt']: joins.append((c['start'] + j, c['text'][:38], 'onecall'))
    if i + 1 < len(ch):
        n = ch[i + 1]
        if re.match(r'^\W*[a-zß-ÿ]', n['text']) or re.search(r'[,:;]\W*$', c['text']):
            joins.append((c['start'] + c['dur'] + c.get('pause', 0) / 2, c['text'][:38], 'cut'))
rows = []
for t, txt, kind in sorted(joins):
    g, a, b = gap_at(t)
    pre, post = voiced_edge(a, -1), voiced_edge(b, +1)
    dF = None if pre is None or post is None else post - pre
    r1, r2 = rms(a - 0.4, a), rms(b, b + 0.4)
    rows.append((g, dF, r2 - r1))
    print(f"{label:10s} {t:6.2f}s gap {g:4.2f}  dF0 {'  n/a' if dF is None else f'{dF:+5.1f}'} st  dRMS {r2 - r1:+5.1f} dB  [{kind}] {txt}")
g = np.array([r[0] for r in rows]); d = np.array([abs(r[1]) for r in rows if r[1] is not None]); e = np.array([abs(r[2]) for r in rows])
print(f"{label:10s} JOINS {len(rows)}  gap mean {g.mean():.2f} max {g.max():.2f}  |dF0| mean {d.mean():.1f} st  |dRMS| mean {e.mean():.1f} dB")
