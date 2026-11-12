import sys, time; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from st3 import ST3
from scene import segments
from render import run, plain_plan
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
VOICE = {"narr": "F3", "Sarah": "F1", "Daniel": "M1"}
def speed_for(c):
    if "shout" in c: return 1.05  # 1.12 tried first: garbled short caps lines
    if "whisper" in c: return 0.90
    if "fear" in c: return 0.96
    return 1.05
def directed():
    items = []
    for s in segments():
        if s["role"] == "narr":
            items.append(dict(s, kind="speech", voice=VOICE["narr"], speed=1.0, expect=s["text"], ctrl="narr 1.0"))
            if s["laugh_after"]:
                items.append(dict(para=s["para"], role=s["laugh_after"], text="<laugh> <laugh>", cues=set(), kind="laugh",
                                  voice=VOICE[s["laugh_after"]], speed=1.0, ctrl="standalone <laugh> <laugh>"))
            continue
        if s["laugh_before"]:
            items.append(dict(para=s["para"], role=s["role"], text="<laugh> <laugh>", cues=set(), kind="laugh",
                              voice=VOICE[s["role"]], speed=1.0, ctrl="standalone <laugh> <laugh>"))
        if s["breath_before"]:
            items.append(dict(para=s["para"], role=s["role"], text="<breath>", cues=set(), kind="breath",
                              voice=VOICE[s["role"]], speed=1.0, ctrl="standalone <breath>"))
        sp = speed_for(s["cues"])
        items.append(dict(s, kind="speech", voice=VOICE[s["role"]], speed=sp, expect=s["text"], ctrl=f"{VOICE[s['role']]} speed {sp} cues {sorted(s['cues'])}"))
    return items
import re
def decap(t):  # rule: ALL-CAPS words -> capitalised (caps already used as the 'shout' cue)
    return re.sub(r"\b([A-Z])([A-Z']{1,})\b", lambda m: m.group(1) + m.group(2).lower(), t)
class Eng:
    def __init__(self):
        t0 = time.time(); self.m = ST3(); self.sr = self.m.sr; self.load = time.time() - t0
    def say(self, it):
        t = decap(it["text"]) if (MODE == "directed" and it.get("kind") == "speech") else it["text"]
        w, bad = self.m.synth(t, it.get("voice", VOICE["narr"]), speed=it.get("speed", 1.05), seed=it["para"] * 7 + 1)
        if bad: print("UNSUPPORTED CHARS", bad)
        return w
mode = MODE = sys.argv[1]
e = Eng(); print("load", round(e.load, 2))
items = plain_plan() if mode == "plain" else directed()
run(e, items, f"{W}/prank_supertonic3_{mode}.wav", f"{W}/out/st3_{mode}_paras", f"{W}/out/st3_{mode}.json")
