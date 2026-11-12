import sys, time, re; sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
from cbt import CBT
from scene import segments
from render import run, plain_plan
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
VOICE = {"narr": "af_heart", "Sarah": "af_bella", "Daniel": "am_michael"}
def decap(t): return re.sub(r"\b([A-Z])([A-Z']{1,})\b", lambda m: m.group(1) + m.group(2).lower(), t)
def style_tag(c):
    if "whisper" in c: return "[whispering] "
    if "shout" in c: return "[angry] "
    if "fear" in c: return "[fear] "
    if "happy" in c: return "[happy] "
    return ""
def directed():
    items = []
    for s in segments():
        if s["role"] == "narr":
            items.append(dict(s, kind="speech", voice=VOICE["narr"], expect=s["text"], ctrl="narr"))
            if s["laugh_after"]:
                items.append(dict(para=s["para"], role=s["laugh_after"], text="[laugh] [laugh]", cues=set(), kind="laugh", voice=VOICE[s["laugh_after"]], ctrl="standalone [laugh] [laugh]"))
            continue
        pre = ("[laugh] " if s["laugh_before"] else "") + ("[sigh] " if s["breath_before"] else "") + style_tag(s["cues"])
        items.append(dict(s, kind="speech", text=pre + decap(s["text"]), voice=VOICE[s["role"]], expect=s["text"], ctrl=f"{VOICE[s['role']]} '{pre.strip()}' cues {sorted(s['cues'])}"))
    return items
class Eng:
    def __init__(self):
        t0 = time.time(); self.m = CBT(f"{W}/dl/cbt"); self.sr = self.m.sr; self.load = time.time() - t0
        for v in VOICE.values(): self.m.voice(f"{W}/refs/{v}.wav")  # speaker conditioning precomputed (one-off per voice)
        self.cond = time.time() - t0 - self.load
    def say(self, it):
        w = self.m.synth(it["text"], f"{W}/refs/{it.get('voice', VOICE['narr'])}.wav", seed=it["para"] * 7 + 1)
        it["ctrl"] = (it.get("ctrl") or "") + f" {self.m.last}"
        return w
mode = sys.argv[1]
e = Eng(); print("load", round(e.load, 2), "voice-cond", round(e.cond, 2))
items = plain_plan() if mode == "plain" else directed()
if mode == "directed":
    for it in items: print(it["role"], "|", it["text"])
run(e, items, f"{W}/prank_chatterbox_{mode}.wav", f"{W}/out/cbt_{mode}_paras", f"{W}/out/cbt_{mode}.json")
