import sys, time, os, json; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from st3 import maxrss_mb
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
which = sys.argv[1]; la0 = os.getloadavg()[0]; t0 = time.time()
if which == "st3":
    from st3 import ST3; m = ST3(); f = lambda t, s: m.synth(t, "F1", seed=s)[0]
else:
    from cbt import CBT
    m = CBT(f"{W}/dl/nano1", dict(speech_encoder="q4f16", embed_tokens="fp16", language_model="q4f16", conditional_decoder="q4")) if which == "nano" else CBT(f"{W}/dl/cbt")
    m.voice(f"{W}/refs/af_bella.wav"); f = lambda t, s: m.synth(t, f"{W}/refs/af_bella.wav", seed=s)
load = time.time() - t0
t1 = time.time(); a = f("Hello? Can you hear me?", 1); first = time.time() - t1
R = []
for s in range(3):
    t1 = time.time(); a2 = f("Something about the way she said it made him stop smiling, and the line went quiet.", s); dt = time.time() - t1
    R.append(round(dt / (len(a2) / m.sr), 2))
print(json.dumps(dict(model=which, load_s=round(load, 2), first_sentence_s=round(first, 2), first_audio_s=round(len(a) / m.sr, 2), ttfa_s=round(load + first, 2),
                      rtf_runs=R, maxrss_mb=round(maxrss_mb()), loadavg_start=round(la0, 2), loadavg_end=round(os.getloadavg()[0], 2))))
