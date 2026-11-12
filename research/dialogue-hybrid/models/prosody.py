"""prosody.py <log.json> <items_dir> : per-item loudness (active-frame RMS dB), F0 median (Hz), F0 range p10-p90 (semitones),
voiced fraction of active frames; then group by cue (shout / whisper / fear / neutral) and by kind (laugh/breath).
For non-speech items: active seconds (frames > -40 dB re scene peak frame) and level vs speech median."""
import sys, json
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/pylib")
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np, parselmouth
from scene import read_wav, frame_db
log = json.load(open(sys.argv[1]))["items"]; D = sys.argv[2]
rows = []; scene_peak = -120
for it in log:
    a, sr = read_wav(f"{D}/p{it['i']:03d}.wav"); db = frame_db(a, sr, 0.02); scene_peak = max(scene_peak, db.max())
    rows.append((it, a, sr, db))
out = []
for it, a, sr, db in rows:
    act = db > scene_peak - 40
    rms = 10 * np.log10(np.mean(10 ** (db[act] / 10))) if act.any() else -120
    snd = parselmouth.Sound(a.astype(np.float64), sr)
    p = snd.to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=600).selected_array["frequency"]
    v = p[p > 0]
    f0 = float(np.median(v)) if v.size else 0
    rng = float(12 * np.log2(np.percentile(v, 90) / np.percentile(v, 10))) if v.size > 5 else 0
    nact = act.sum() * 0.02
    vf = min(1.0, v.size * 0.01 / nact) if nact else 0
    cues = it.get("ctrl") or ""
    out.append(dict(i=it["i"], role=it["role"], kind=it["kind"], text=it["text"][:50], rms=round(float(rms), 1), f0=round(f0),
                    f0rng=round(rng, 1), voiced=round(vf, 2), active_s=round(float(nact), 2), dur=round(len(a) / sr, 2), ctrl=cues))
speech = [o for o in out if o["kind"] == "speech"]
med = np.median([o["rms"] for o in speech])
def grp(name, f):
    g = [o for o in speech if f(o)]
    if not g: return
    print(f"{name:10s} n={len(g):2d}  rms {np.mean([o['rms'] for o in g])-med:+5.1f} dB vs median  f0 {np.mean([o['f0'] for o in g]):5.0f} Hz  "
          f"f0range {np.mean([o['f0rng'] for o in g]):4.1f} st  voiced {np.mean([o['voiced'] for o in g]):.2f}")
for o in out:
    flag = "" if o["kind"] == "speech" else f"  <-- {o['kind']}: active {o['active_s']}s of {o['dur']}s, level {o['rms']-med:+.1f} dB vs speech median"
    print(f"{o['i']:3d} {o['role']:6s} rms {o['rms']:6.1f} f0 {o['f0']:4d} rng {o['f0rng']:4.1f} vcd {o['voiced']:.2f} | {o['text']}{flag}")
import re
grp("narration", lambda o: o["role"] == "narr")
grp("shout", lambda o: o["role"] != "narr" and "'shout'" in o["ctrl"])
grp("whisper", lambda o: o["role"] != "narr" and "'whisper'" in o["ctrl"] and "'shout'" not in o["ctrl"])
grp("fear-only", lambda o: o["role"] != "narr" and "'fear'" in o["ctrl"] and "'whisper'" not in o["ctrl"] and "'shout'" not in o["ctrl"])
grp("Daniel", lambda o: o["role"] == "Daniel"); grp("Sarah", lambda o: o["role"] == "Sarah")
json.dump(out, open(sys.argv[1].replace(".json", "_prosody.json"), "w"), indent=0)
