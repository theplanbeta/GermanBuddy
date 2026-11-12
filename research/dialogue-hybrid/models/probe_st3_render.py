import sys, time; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from st3 import ST3; from scene import write_wav
O = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/out/st3probe"
m = ST3()
tags = sys.argv[1].split(",")
for t in tags:
    txt = "Oh no. And then she left." if t == "none" else f"Oh no. <{t}> And then she left."
    w, bad = m.synth(txt, "F1", seed=1)
    write_wav(f"{O}/{t}.wav", w, m.sr); print(t, round(len(w)/m.sr,2), bad)
