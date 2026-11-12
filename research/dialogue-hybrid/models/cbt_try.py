import sys, time, json; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from cbt import CBT; from scene import write_wav
from st3 import maxrss_mb
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
import os
NANO = os.environ.get("NANO")
m = CBT(f"{W}/dl/nano1", dict(speech_encoder="q4f16", embed_tokens="fp16", language_model="q4f16", conditional_decoder="q4")) if NANO else CBT(f"{W}/dl/cbt"); print("load", round(m.load_s, 2), "rss", round(maxrss_mb()))
for name, text, ref, kw in json.load(open(sys.argv[1])):
    t0 = time.time(); w = m.synth(text, f"{W}/refs/{ref}.wav", **kw); dt = time.time() - t0
    write_wav(f"{sys.argv[2]}/{name}.wav", w, m.sr)
    print(f"{name:14s} {dt:6.2f}s -> {len(w)/m.sr:5.2f}s audio  rtf {dt/(len(w)/m.sr):.2f}  {m.last}  rss {maxrss_mb():.0f}", flush=True)
