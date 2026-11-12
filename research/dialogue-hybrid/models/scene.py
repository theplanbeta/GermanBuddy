"""Shared helpers: scene parsing into segments with rule-based direction, WAV IO, analysis.
Rules read only the text itself (no hand-tuning per line)."""
import re, wave, json, sys
import numpy as np

PRANK = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/dialogue/prank.txt"

QUOTE_RE = re.compile(r"“(.*?)”", re.S)

def paragraphs(path=PRANK):
    t = open(path, encoding="utf-8").read()
    return [p.strip() for p in re.split(r"\n\s*\n+", t) if p.strip()]

def ascii_text(s):
    return (s.replace("…", "...").replace("—", " - ").replace("’", "'")
             .replace("‘", "'").replace("“", '"').replace("”", '"'))

SPEECH_VERBS = r"(said|screamed|whispered|replied|murmured|asked|shouted|cried)"
CUE_WORDS = {
    "whisper": r"whisper|quietly|softly|barely|murmur|faint",
    "shout": r"scream|shout|yell|RUN",
    "fear": r"trembl|cracked|careful|someone in the house|outside my door|don't move",
    "laugh": r"laugh|giggl",
    "happy": r"sweetly|April Fools|love me",
    "breath": r"inhal|breathing|sigh",
    "pause": r"^(Silence\.|Then… nothing\.|Ten seconds passed\.|Twenty\.|A pause\.)$",
}

def who(s):
    s2 = s.lower()
    if re.search(r"\b(she|her|sarah)\b", s2) and not re.search(r"\b(he|his|him|daniel)\b", s2):
        return "Sarah"
    if re.search(r"\b(he|his|him|daniel)\b", s2) and not re.search(r"\b(she|her|sarah)\b", s2):
        return "Daniel"
    return None

def segments(path=PRANK):
    """Return list of dicts: {para, role:'narr'|'Daniel'|'Sarah', text, cues:set, laugh_before:bool}.
    Speaker rules: (1) narration in same paragraph names/pronouns a subject -> that speaker;
    (2) quote addresses a name ('Sarah', 'Daniel') -> the other person; (3) otherwise alternate.
    Cue rules: cue words in the same paragraph's narration (or the previous narration-only
    paragraph) set whisper/shout/fear/laugh/happy; ALL-CAPS words in a quote set shout."""
    paras = paragraphs(path)
    out = []
    last = "Sarah"  # line 1 is unattributed; alternation then starts with Daniel? see rule below
    prev_narr = ""
    first_quote = True
    for i, p in enumerate(paras):
        quotes = QUOTE_RE.findall(p)
        narr = QUOTE_RE.sub(" | ", p).strip(" |")
        narr_parts = [x.strip() for x in QUOTE_RE.split(p)]
        if not quotes:
            cues = {k for k, rx in CUE_WORDS.items() if re.search(rx, p, re.I)}
            out.append(dict(para=i, role="narr", text=p, cues=cues))
            prev_narr = p
            continue
        # speaker
        sp = who(narr) if narr else None
        if sp is None:
            q = " ".join(quotes)
            if re.search(r"\bSarah\b", q): sp = "Daniel"
            elif re.search(r"\bDaniel\b", q): sp = "Sarah"
            elif first_quote: sp = "Daniel"   # opening "Hello?" answered on the phone: unattributed -> alternate from nobody; pick the first-named male protagonist? (rule: first quote = Daniel, the POV character)
            else: sp = "Daniel" if last == "Sarah" else "Sarah"
        first_quote = False
        ctx = narr + " " + (prev_narr if prev_narr else "")
        cues = {k for k, rx in CUE_WORDS.items() if re.search(rx, ctx, re.I)}
        qall = " ".join(quotes)
        if re.search(r"\b[A-Z]{3,}\b", qall): cues.add("shout")
        if re.search(r"careful|someone in the house|outside my door|Don't move|please", qall, re.I): cues.add("fear")
        if re.search(r"April Fools|love me|You should have", qall, re.I): cues.add("happy")
        # interleave quotes and narration in order
        parts = QUOTE_RE.split(p)  # even idx narration, odd idx quote
        for j, part in enumerate(parts):
            part = part.strip()
            if not part: continue
            if j % 2 == 1:
                out.append(dict(para=i, role=sp, text=part, cues=set(cues)))
            else:
                c = {k for k, rx in CUE_WORDS.items() if re.search(rx, part, re.I)}
                out.append(dict(para=i, role="narr", text=part, cues=c))
        last = sp
        prev_narr = ""
    # laugh_before: if a narration segment says X laughed/giggled (no quote of X in same para
    # before it), the next quote of X gets a laugh tag; narration-only laugh paragraphs
    # ("A giggle.", "She laughed even harder.") also get a standalone laugh by the subject.
    for k, s in enumerate(out):
        s["laugh_before"] = False
        s["laugh_after"] = False
    for k, s in enumerate(out):
        if s["role"] == "narr" and "laugh" in s["cues"]:
            subj = who(s["text"]) or "Sarah"
            # next quote by subj within same or next paragraph
            for m in range(k + 1, min(k + 3, len(out))):
                if out[m]["role"] == subj and out[m]["para"] <= s["para"] + 1:
                    out[m]["laugh_before"] = True
                    break
            else:
                s["laugh_after"] = subj
    for s in out: s["breath_before"] = False
    for k, s in enumerate(out):
        if s["role"] == "narr" and "breath" in s["cues"]:
            subj = who(s["text"])
            if not subj: continue
            for m in range(k + 1, min(k + 3, len(out))):
                if out[m]["role"] == subj:
                    out[m]["breath_before"] = True; break
    return out

def read_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels(); sw = w.getsampwidth()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
    if ch > 1: a = a.reshape(-1, ch).mean(1)
    return a, sr

def write_wav(path, a, sr):
    a = np.asarray(a, dtype=np.float32)
    peak = float(np.abs(a).max()) if a.size else 0
    if peak > 0.98: a = a * (0.98 / peak)  # avoid clipping
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
    return peak

def frame_db(a, sr, hop=0.02):
    h = int(sr * hop); n = len(a) // h
    if n == 0: return np.array([-120.0])
    f = a[: n * h].reshape(n, h)
    return 20 * np.log10(np.sqrt((f ** 2).mean(1)) + 1e-9)

def stats(a, sr):
    db = frame_db(a, sr)
    return dict(dur=round(len(a) / sr, 3), peak=round(float(np.abs(a).max()), 3),
                clip=int((np.abs(a) >= 0.999).sum()), rms_db=round(float(20*np.log10(np.sqrt((a**2).mean())+1e-9)), 1),
                voiced_frac=round(float((db > db.max() - 35).mean()), 3))

if __name__ == "__main__":
    for s in segments():
        print(s["para"], s["role"], sorted(s["cues"]), "LB" if s["laugh_before"] else "", "BB" if s["breath_before"] else "", s["laugh_after"] or "", "|", s["text"])
