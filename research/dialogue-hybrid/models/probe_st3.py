import sys, time; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from st3 import ST3, maxrss_mb
m = ST3(); print("load", round(m.load_s,2), "s")
base = "Oh no. {} And then she left."
cands = "laugh breath sigh cough cry sob scream whisper gasp giggle chuckle sniff yawn hum groan clear_throat shout sneeze hmm um uh pause sniffle moan kiss happy sad angry fear surprise xyzzy".split()
d0 = m.duration(base.format(""), "F1")
print("no tag", round(d0,2))
for c in cands:
    for v in ("F1","M1"):
        pass
    d = m.duration(base.format(f"<{c}>"), "F1"); dm = m.duration(base.format(f"<{c}>"), "M1")
    dw = m.duration(base.format(c), "F1")  # word read as text
    print(f"{c:14s} tag+{d-d0:5.2f}s  (M1 {dm-m.duration(base.format(''),'M1'):5.2f})  as-word+{dw-d0:5.2f}")
