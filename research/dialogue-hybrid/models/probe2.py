import sys; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from st3 import ST3; from scene import write_wav, frame_db
O = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/out/st3probe2"
m = ST3()
def act(w):
    db = frame_db(w, m.sr, 0.01); return (db > db.max()-40).sum()*0.01
variants = {"none": "I told you so.", "laugh_end": "I told you so. <laugh>", "laugh_start": "<laugh> I told you so.",
            "laugh3": "I told you so. <laugh> <laugh> <laugh>", "laughmid": "I told you <laugh> so.",
            "breath_start": "<breath> I told you so.", "sigh_start": "<sigh> I told you so.", "laughonly": "<laugh>",
            "haha": "Ha ha ha! I told you so."}
for v in ["F1", "F3", "M1", "M3"]:
    for seed in [1, 2]:
        row = []
        for k, t in variants.items():
            w, _ = m.synth(t, v, seed=seed)
            if seed == 1: write_wav(f"{O}/{v}_{k}.wav", w, m.sr)
            row.append(f"{k}:{len(w)/m.sr:.2f}/{act(w):.2f}")
        print(v, seed, "  ".join(row))
