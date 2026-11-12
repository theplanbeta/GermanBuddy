# Per preset: change against the plain render, averaged over the test lines, next to the
# natural variation (plain at other voice rows). Units: f0 semitones, rms/tilt/hnr dB, speech %.
import json, sys, glob, re, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import analyze
d = sys.argv[1] if len(sys.argv) > 1 else 'abl'
res = {}
for f in sorted(glob.glob(f'{d}/L*_*.wav')):
    m = re.match(r'.*/L(\d+)_(.+)\.wav', f)
    res.setdefault(m.group(2), {})[int(m.group(1))] = analyze(f)
plain = res['plain']
def delta(r, p):
    return dict(f0=12*np.log2(r['f0']/p['f0']), rng=r['rng']-p['rng'], rms=r['rms']-p['rms'], tilt=r['tilt']-p['tilt'], hnr=r['hnr']-p['hnr'], speech=100*(r['speech']/p['speech']-1), vf=r['vf']-p['vf'])
print(f"{'variant':10s} " + ' '.join(f"{k:>14s}" for k in ['f0 st','range st','level dB','tilt dB','hnr dB','speech %','voiced']))
for name, rows in res.items():
    if name == 'plain': continue
    ds = [delta(rows[i], plain[i]) for i in rows]
    keys = ['f0','rng','rms','tilt','hnr','speech','vf']
    print(f"{name:10s} " + ' '.join(f"{np.mean([x[k] for x in ds]):+6.2f}±{np.std([x[k] for x in ds]):4.2f}  " for k in keys))
