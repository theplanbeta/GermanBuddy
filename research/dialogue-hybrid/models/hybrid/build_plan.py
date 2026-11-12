"""Build the hybrid plan from prank_C_voices.json (the C director's speakers, styles and pauses).
Each C part is classified from its style, which is the director's own cue table (styles.js / director_fiction.js):
  shout   firm>=0.6           excited  firm 0.3 (lone '!' etc.)   laugh  pitch .35 speed 1.04 gain +1
  tremble whisper .6 speed .95 gain -1        softsay whisper .6 gain -3 speed 1
  soft    whisper .6 gain -3 speed .93 (via carry)   whisper whisper>=1.1      sweet pitch .35 whisper .25 gain -1
H1 rule ("Kokoro cannot act"): quoted part that is shout, or has an ALL-CAPS word in the source text, or laugh, or tremble.
H2: every quoted part. Laugh inserts after narration sentences with laugh|giggl|chuckl (+ a following 'Then another.')."""
import json, re, sys
D = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/dialogue"
OUT = sys.argv[1]
C = json.load(open(f"{D}/prank_C_voices.json"))
SR = 24000
def cat(st):
    w, f, p, sp, g = st.get("whisper", 0), st.get("firm", 0), st.get("pitch", 0), st.get("speed", 1), st.get("gainDb", 0)
    if f >= 0.6: return "shout"
    if f >= 0.3: return "excited"
    if w >= 1.1: return "whisper"
    if abs(w - 0.6) < 1e-6 and abs(sp - 0.95) < 1e-6: return "tremble"
    if abs(w - 0.6) < 1e-6 and g <= -3: return "softsay" if abs(sp - 1) < 1e-6 else "soft"
    if abs(p - 0.35) < 1e-6 and w >= 0.2: return "sweet"
    if abs(p - 0.35) < 1e-6 and abs(sp - 1.04) < 1e-6: return "laugh"
    return "neutral"
NAMES = {"sarah": "Sarah", "daniel": "Daniel"}
def decap(t):  # ALL-CAPS words -> lower case (names keep their capital), then first letter upper
    t = re.sub(r"\b[A-Z]{2,}\b", lambda m: NAMES.get(m.group(0).lower(), m.group(0).lower()), t)
    return t[:1].upper() + t[1:]
def clean(t): return t.replace("“", "").replace("”", "").strip()
TAG = {"shout": "[angry] ", "tremble": "[fear] ", "excited": "[happy] ", "sweet": "[happy] "}
sents = C["sentences"]; dels = C["deliveries"]; starts = C["starts"]; pauses = C["pauses"]
total = None
plan = []
for i, (s, d) in enumerate(zip(sents, dels)):
    src = s["text"]
    nxt = starts[i + 1] if i + 1 < len(starts) else None
    end = (nxt - round(pauses[i] * SR)) if nxt is not None else None
    parts = []
    # merge consecutive parts of the same voice into one quote ("Wait… || what?")
    merged = []
    for p in d["parts"]:
        if merged and merged[-1].get("voice") == p.get("voice") and p.get("voice"):
            m = merged[-1]; m["text"] = m["text"] + " " + p["text"]; m["styles"].append(p["style"])
        else: merged.append(dict(p, styles=[p["style"]]))
    for p in merged:
        voice = p.get("voice")
        cats = [cat(x) for x in p["styles"]]
        c = "shout" if "shout" in cats else cats[0]
        quote = voice is not None
        # source text of this part with original capitals (C lower-cases ALL-CAPS runs)
        srcpart = None
        if quote:
            qs = re.findall(r"“(.*?)(?:”|$)", src) or [clean(src)]
            # pick the quoted span that matches this part's words
            key = re.sub(r"\W", "", p["text"].lower())
            srcpart = next((q for q in qs if re.sub(r"\W", "", q.lower()).startswith(key[:6]) or key.startswith(re.sub(r'\W', '', q.lower())[:6])), qs[0])
            if len(merged) == 1: srcpart = clean(src)
        caps = bool(srcpart and re.search(r"\b[A-Z]{2,}\b", srcpart))
        h1 = quote and (c in ("shout", "laugh", "tremble") or caps)
        tag = TAG.get("shout" if (caps and c not in TAG) else c, "")
        parts.append(dict(text=p["text"], src=srcpart or p["text"], voice=voice or "af_heart", style=p["style"] if len(p["styles"]) == 1 else p["styles"][-1],
                          styles=p["styles"], cat=c, caps=caps, quote=quote, h1=h1, h2=quote,
                          cb_text=(tag + decap(clean(srcpart))) if quote else None, tag=tag.strip()))
    plan.append(dict(i=i, para=s["para"], text=src, start=starts[i], end=end, pause=pauses[i], parts=parts))
# laugh inserts
last_ins = None
for k, e in enumerate(plan):
    narr = all(not p["quote"] for p in e["parts"])
    t = e["text"]
    e["insert"] = None
    if narr and re.search(r"\blaugh|\bgiggl|\bchuckl", t, re.I):
        low = t.lower()
        if re.search(r"\b(she|her|sarah)\b", low): who = "af_aoede"
        elif re.search(r"\b(he|his|him|daniel)\b", low): who = "am_fenrir"
        else:  # no subject: the speaker of the next quote
            who = next(p["voice"] for f in plan[k + 1:] for p in f["parts"] if p["quote"])
        dbl = bool(re.search(r"burst|harder|uncontrollabl|hysteric", t, re.I))
        e["insert"] = dict(voice=who, text="[laugh] [laugh]" if dbl else "[laugh]")
        last_ins = e["insert"]
    elif narr and re.match(r"^Then another\.?$", t.strip()) and last_ins:
        e["insert"] = dict(last_ins)
    elif not narr: last_ins = None
json.dump(dict(total_samples=None, plan=plan), open(OUT, "w"), indent=1, ensure_ascii=False)
for e in plan:
    for p in e["parts"]:
        print(f"{e['i']:2d} {'Q' if p['quote'] else ' '} {p['voice']:9s} {p['cat']:8s} {'CAPS' if p['caps'] else '    '} H1={'CB' if p['h1'] else 'K '} | {p['text'][:45]:45s} | {p['cb_text'] or ''}")
    if e["insert"]: print(f"   + laugh insert {e['insert']}")
