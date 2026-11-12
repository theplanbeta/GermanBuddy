# apply the same guard (copied source of guard/words from cb_render.py) to earlier known-bad Chatterbox outputs
import sys, re, json, os, subprocess
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np, difflib
from scene import frame_db
src = open(os.path.join(os.path.dirname(__file__), "cb_render.py")).read()
exec(src[src.index("def words"):src.index("def run_asr")])
exec(src[src.index("def run_asr"):src.index("t0 = time.time(); m = CBT")])
W = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger"
cases = [("out/cbt_directed_paras/items/p012.wav", "[whispering] There's someone in the house.", "There's someone in the house."),
         ("out/cbt_plain_paras/p18.wav", "RUN, SARAH! RUN!", "RUN, SARAH! RUN!"),
         ("out/cbt_plain_paras/p28.wav", "OH, DANIEL! You should have HEARD yourself!", "OH, DANIEL! You should have HEARD yourself!"),
         ("out/cbt_plain_paras/p42.wav", "A pause.", "A pause."),
         ("out/cbt_directed_paras/items/p004.wav", "[laugh] Oh, come on, Sarah! What is it this time? Another one of your ridiculous conspiracy theories?", "Oh, come on, Sarah! What is it this time? Another one of your ridiculous conspiracy theories?")]
asr = run_asr([f"{W}/{c[0]}" for c in cases])
for f, text, exp in cases:
    r = guard(dict(kind="speech", text=text, expect=exp), f"{W}/{f}", asr[os.path.basename(f)])
    print(f, "OK" if r["ok"] else "FAIL", r["why"], "| core", r["core"], "gap", r["max_gap"], "| asr:", r["asr"])
