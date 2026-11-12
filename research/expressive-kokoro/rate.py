"""Per-chunk speaking rate from a render log + wav.
python3 -I rate.py out.wav plan.json  -> phones/s (phoneme symbols excl. stress/space/punct) over voiced-speech time
"""
import json, sys, wave, re
import numpy as np
sys.path.insert(0, '.')
from analyze import frames_rms, pauses_of
w = wave.open(sys.argv[1]); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32768
plan = json.load(open(sys.argv[2])); chunks = plan['chunks'] if isinstance(plan, dict) else plan
rows = []
for c in chunks:
    seg = x[int(c['start'] * 24000):int((c['start'] + c['dur']) * 24000)]
    db, hop = frames_rms(seg, 24000)
    p, lead, trail, sil, thr = pauses_of(db, hop, len(seg) / 24000)
    speech = len(seg) / 24000 - lead - trail - sum(b for a, b in p)
    ph = c.get('phonemes') or ''
    n = len(re.sub(r"[ˈˌː\s;:,.!?¡¿—…\"“”«»()-]", "", ph))
    sp = c.get('perf', {}).get('speed', 1) if 'perf' in c else 1
    rows.append((n / max(speech, 1e-3), n, round(speech, 2), sp, c['text'][:45]))
for r in rows: print(f"{r[0]:5.1f} ph/s  n={r[1]:3d}  speech={r[2]:5.2f}  speed={r[3]:.2f}  {r[4]}")
neutral = [r for r in rows if abs(r[3] - 1) < 1e-6]
v = np.array([r[0] for r in neutral]); short = np.array([r[0] for r in neutral if r[1] < 40]); long_ = np.array([r[0] for r in neutral if r[1] >= 40])
print(f"NEUTRAL chunks: n={len(v)} mean {v.mean():.1f} sd {v.std():.2f} cv {v.std()/v.mean()*100:.1f}% | short(<40ph) {short.mean():.1f} (n={len(short)}) long {long_.mean():.1f} (n={len(long_)})")
