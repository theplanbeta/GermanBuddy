"""Compare tagged vs untagged render: extra total time, extra 'active' time (frames above -40 dB re peak),
and the segment between two words found as the longest low-energy-bounded region. Usage: tagmeasure.py ref.wav a.wav ..."""
import sys; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from scene import read_wav, frame_db
def prof(f):
    a, sr = read_wav(f); db = frame_db(a, sr, 0.01); thr = db.max() - 40
    act = db > thr
    # spectral flatness of active frames (noise-like breath ~ high)
    return a, sr, db, act
ref = sys.argv[1]; a0, sr, db0, act0 = prof(ref)
print(f"{'file':16s} dur  +dur  active +active  silent+")
for f in [ref] + sys.argv[2:]:
    a, sr, db, act = prof(f)
    d = len(a)/sr; ac = act.sum()*0.01; si = (~act).sum()*0.01
    print(f"{f.split('/')[-1]:16s} {d:4.2f} {d-len(a0)/sr:+5.2f} {ac:5.2f} {ac-act0.sum()*0.01:+5.2f}  {si-(~act0).sum()*0.01:+5.2f}")
