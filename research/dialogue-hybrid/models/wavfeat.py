"""wavfeat.py files... : dur, active-frame RMS dB, F0 median, F0 p10-p90 range (st), voiced fraction of active frames, envelope"""
import sys
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/pylib")
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np, parselmouth
from scene import read_wav, frame_db
def feat(f, ref_db=None):
    a, sr = read_wav(f); db = frame_db(a, sr, 0.01); top = ref_db if ref_db is not None else db.max()
    act = db > top - 40
    rms = 10 * np.log10(np.mean(10 ** (db[act] / 10)))
    p = parselmouth.Sound(a.astype(np.float64), sr).to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=600).selected_array["frequency"]
    v = p[p > 0]
    return dict(dur=len(a)/sr, rms=rms, f0=np.median(v) if v.size else 0, rng=12*np.log2(np.percentile(v,90)/np.percentile(v,10)) if v.size>5 else 0,
                vf=min(1, v.size / max(act.sum(), 1)), act=act.sum()*0.01,
                env=''.join(' ' if d<-50 else '.' if d<-40 else ':' if d<-30 else '+' if d<-22 else '#' for d in frame_db(a, sr, 0.05)))
if __name__ == "__main__":
    for f in sys.argv[1:]:
        r = feat(f)
        print(f"{f.split('/')[-1][:-4]:18s} {r['dur']:4.2f}s act {r['act']:4.2f} rms {r['rms']:5.1f} f0 {r['f0']:4.0f} rng {r['rng']:4.1f} vcd {r['vf']:.2f} {r['env']}")
