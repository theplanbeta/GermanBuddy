# Per styled sentence of B: what moved against the same sentence in A (plain, today).
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('F0_FLOOR', '70')
from analyze import analyze
import numpy as np
A = json.load(open('prank_A_today.json')); B = json.load(open('prank_B_director.json')); C = json.load(open('prank_C_voices.json'))
def key(d): return ' | '.join(f"{p.get('voice','')}{json.dumps(p['style'],sort_keys=True)}" for p in d['parts'])
print(f"{'#':>3} {'B delivery':40s} {'F0 st':>6} {'level dB':>8} {'tilt dB':>7} {'HNR dB':>7} {'speech %':>8}  text")
rows = []
for i, (a, b) in enumerate(zip(A['deliveries'], B['deliveries'])):
    if key(a) == key(b): continue
    ra, rb = analyze(f'seg/A_{i}.wav'), analyze(f'seg/B_{i}.wav')
    d = (12*np.log2(rb['f0']/ra['f0']), rb['rms']-ra['rms'], rb['tilt']-ra['tilt'], rb['hnr']-ra['hnr'], 100*(rb['speech']/ra['speech']-1))
    desc = ' + '.join(p['style'] and (' '.join(f"{k}{v}" for k, v in p['style'].items() if v and not (k=='speed' and v==1)) or 'plain') or 'plain' for p in b['parts'])
    print(f"{i:3d} {desc[:40]:40s} {d[0]:+6.1f} {d[1]:+8.1f} {d[2]:+7.1f} {d[3]:+7.1f} {d[4]:+8.0f}  {B['sentences'][i]['text'][:50]}")
print()
print('C: median F0 of each voice on its quoted lines (Hz):')
by = {}
for i, d in enumerate(C['deliveries']):
    if d['spliced']: continue
    v = d['parts'][0].get('voice', 'af_heart'); r = analyze(f'seg/C_{i}.wav')
    if r['f0']: by.setdefault(v, []).append(r['f0'])
for v, f in by.items(): print(f"  {v}: {np.median(f):.0f} Hz over {len(f)} sentences")
