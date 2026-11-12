"""Flow metrics of a render: python3 -I flow.py out.wav plan.json label
 decay   ms from (chunk speech level - 20 dB) to (-50 dB) at each chunk end  (abruptness of releases)
 attack  ms from -50 dB to -20 dB at each chunk start
 floor   level of the pauses between chunks (dBFS; digital zero = -inf)
 F0start sd of sentence-initial F0 (first 300 ms voiced), and mean |start(k+1) - end(k)| step in st
 pauses  silent stretches >= 120 ms in the whole file: count, share of time, percentiles
"""
import json, sys, wave
import numpy as np, parselmouth
w = wave.open(sys.argv[1]); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32768
ch = json.load(open(sys.argv[2]))['chunks']; label = sys.argv[3]; sr = 24000
h = 120; db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i + h] ** 2)) + 1e-12 for i in range(0, len(x) - h, h)]))  # 5 ms frames
fr = lambda t: int(t * sr / h)
dec, att, floor = [], [], []
for c in ch:
    a, b = fr(c['start']), fr(c['start'] + c['dur'])
    if b - a < 10: continue
    lvl = np.percentile(db[a:b], 90)
    # end: last frame above lvl-20, then first frame after below lvl-50
    above = np.nonzero(db[a:b] > lvl - 20)[0]
    if len(above):
        e1 = a + above[-1]; e2 = e1
        while e2 < len(db) - 1 and db[e2] > lvl - 50: e2 += 1
        dec.append((e2 - e1) * 5)
        s1 = a + above[0]; s0 = s1
        while s0 > 0 and db[s0] > lvl - 50: s0 -= 1
        att.append((s1 - s0) * 5)
    p0, p1 = b + 4, fr(c['start'] + c['dur'] + c.get('pause', 0)) - 4
    if p1 - p0 > 4: floor.append(np.median(db[p0:p1]))
snd = parselmouth.Sound(x, sr); P = snd.to_pitch_ac(time_step=0.01, pitch_floor=110, pitch_ceiling=550)
f0 = P.selected_array['frequency']; tt = P.xs()
def edge(a, b, first=True):
    m = (tt >= a) & (tt <= b) & (f0 > 0); v = tt[m]
    if len(v) < 5: return None
    sel = (tt >= v[0]) & (tt <= v[0] + 0.3) if first else (tt >= v[-1] - 0.3) & (tt <= v[-1])
    sel &= f0 > 0
    return float(np.median(12 * np.log2(f0[sel] / 100)))
starts, steps = [], []
prev_end = None
for i, c in enumerate(ch):
    sentence_start = i == 0 or not (ch[i - 1]['text'][-1:] in ',:;' or c['text'][:1].islower())
    s = edge(c['start'], c['start'] + c['dur'], True); e = edge(c['start'], c['start'] + c['dur'], False)
    if sentence_start and s is not None:
        starts.append(s)
        if prev_end is not None: steps.append(abs(s - prev_end))
    if e is not None: prev_end = e
thr = db.max() - 40; sil = db < thr; ps = []; i = 0
first = np.argmax(~sil); last = len(sil) - np.argmax((~sil)[::-1])
i = first
while i < last:
    if sil[i]:
        j = i
        while j < last and sil[j]: j += 1
        if (j - i) * 0.005 >= 0.12: ps.append((j - i) * 0.005)
        i = j
    else: i += 1
ps = np.array(ps); dur = len(x) / sr
fl = np.array(floor); fl = fl[np.isfinite(fl)] if len(fl) else fl
print(f"{label:4s} decay {np.mean(dec):5.0f} ms  attack {np.mean(att):4.0f} ms  pause floor {('%.0f dBFS' % np.median(floor)) if len(floor) else 'n/a'}  "
      f"F0start sd {np.std(starts):.2f} st, step {np.mean(steps):.2f} st | pauses {len(ps)}, {ps.sum()/dur*100:.0f}% of time, p25/50/75/90 {np.percentile(ps,25):.2f}/{np.median(ps):.2f}/{np.percentile(ps,75):.2f}/{np.percentile(ps,90):.2f} s  total {dur:.1f} s")
