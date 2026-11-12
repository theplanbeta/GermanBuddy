import sys; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np
from st3 import ST3; from scene import write_wav, frame_db
O = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/out/st3probe2"
m = ST3()
def raw(t, v, seed=1, steps=8):
    # bypass prep: t is the full string incl lang tags
    ids = np.array([[m.idx[ord(c)] for c in t]], np.int64); mask = np.ones((1,1,ids.shape[1]), np.float32)
    ttl, dp = m.style(v); rng = np.random.default_rng(seed)
    dur = m.dp.run(None, {"text_ids": ids, "style_dp": dp, "text_mask": mask})[0] / 1.05
    emb = m.te.run(None, {"text_ids": ids, "style_ttl": ttl, "text_mask": mask})[0]
    cs = m.bcs*m.ccf; ll = int((int(dur[0]*m.sr)+cs-1)//cs)
    xt = rng.standard_normal((1, m.ldim*m.ccf, ll)).astype(np.float32); lm = np.ones((1,1,ll), np.float32)
    for s in range(steps):
        xt = m.ve.run(None, {"noisy_latent": xt, "text_emb": emb, "style_ttl": ttl, "text_mask": mask, "latent_mask": lm,
            "current_step": np.array([s], np.float32), "total_step": np.array([steps], np.float32)})[0]
    return m.vo.run(None, {"latent": xt})[0][0][: int(m.sr*float(dur[0]))]
V = {"nospace": "<en>I told you so.<laugh></en>", "outside": "<en>I told you so.</en><laugh>", "before": "<laugh><en>I told you so.</en>",
     "sentence_laugh": "<en>I told you so. <laugh> Seriously.</en>", "na": "<na>I told you so. <laugh></na>", "steps16": "<en>I told you so. <laugh></en>",
     "two": "<en><laugh> <laugh></en>", "ha_tag": "<en>Ha ha <laugh> I told you so.</en>"}
for k, t in V.items():
    w = raw(t, "F1", steps=16 if k == "steps16" else 8)
    write_wav(f"{O}/F1_x_{k}.wav", w, m.sr)
    db = frame_db(w, m.sr, 0.05)
    print(f"{k:15s} {len(w)/m.sr:4.2f} ", ''.join(' ' if d<-50 else '.' if d<-40 else ':' if d<-30 else '+' if d<-22 else '#' for d in db))
