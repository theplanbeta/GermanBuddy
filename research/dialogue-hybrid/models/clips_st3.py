import sys; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from st3 import ST3; from scene import write_wav
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
m = ST3(); z = lambda s: np.zeros(int(s * m.sr), np.float32)
a, _ = m.synth("Oh my God!", "F1", speed=1.05, seed=120)
write_wav(f"{W}/clip_supertonic3_scream.wav", np.concatenate([z(.2), a, z(.3)]), m.sr)
l, _ = m.synth("<laugh> <laugh>", "F1", seed=267); s, _ = m.synth("Oh, Daniel! You should have heard yourself!", "F1", seed=281)
l2, _ = m.synth("<laugh>", "F1", seed=5)
write_wav(f"{W}/clip_supertonic3_laugh.wav", np.concatenate([z(.2), l, s, l2, z(.3)]), m.sr)
