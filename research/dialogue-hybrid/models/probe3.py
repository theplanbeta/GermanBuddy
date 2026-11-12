import sys; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from st3 import ST3; from scene import write_wav, frame_db
O = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/out/st3probe3"
m = ST3()
for t in sys.argv[1].split(","):
    for v in ["F1", "M1"]:
        w, _ = m.synth(f"<{t}>", v, seed=1)
        db = frame_db(w, m.sr, 0.05)
        write_wav(f"{O}/{v}_{t}.wav", w, m.sr)
        print(f"{v} {t:12s} {len(w)/m.sr:4.2f}s  ", ''.join(' ' if d<-50 else '.' if d<-40 else ':' if d<-30 else '+' if d<-22 else '#' for d in db))
