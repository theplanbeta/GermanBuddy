"""Supertonic 3 CPU engine (logic re-implemented from supertone-inc/supertonic py/helper.py)."""
import json, os, re, time, resource
from unicodedata import normalize
import numpy as np
import onnxruntime as ort

D = "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/dl/st3"

class ST3:
    def __init__(self, threads=4):
        t0 = time.time()
        o = ort.SessionOptions(); o.intra_op_num_threads = threads
        P = ["CPUExecutionProvider"]
        self.cfg = json.load(open(f"{D}/onnx/tts.json"))
        self.idx = json.load(open(f"{D}/onnx/unicode_indexer.json"))
        self.dp = ort.InferenceSession(f"{D}/onnx/duration_predictor.onnx", o, providers=P)
        self.te = ort.InferenceSession(f"{D}/onnx/text_encoder.onnx", o, providers=P)
        self.ve = ort.InferenceSession(f"{D}/onnx/vector_estimator.onnx", o, providers=P)
        self.vo = ort.InferenceSession(f"{D}/onnx/vocoder.onnx", o, providers=P)
        self.sr = self.cfg["ae"]["sample_rate"]; self.bcs = self.cfg["ae"]["base_chunk_size"]
        self.ccf = self.cfg["ttl"]["chunk_compress_factor"]; self.ldim = self.cfg["ttl"]["latent_dim"]
        self.styles = {}
        self.load_s = time.time() - t0

    def style(self, name):
        if name not in self.styles:
            v = json.load(open(f"{D}/voice_styles/{name}.json"))
            ttl = np.array(v["style_ttl"]["data"], np.float32).reshape(v["style_ttl"]["dims"])
            dp = np.array(v["style_dp"]["data"], np.float32).reshape(v["style_dp"]["dims"])
            self.styles[name] = (ttl, dp)
        return self.styles[name]

    def prep(self, text, lang="en"):
        text = normalize("NFKD", text)
        for k, v in {"–": "-", "‑": "-", "—": "-", "_": " ", "“": '"', "”": '"',
                     "‘": "'", "’": "'", "[": " ", "]": " ", "|": " ", "/": " ", "#": " "}.items():
            text = text.replace(k, v)
        text = re.sub(r"\s+", " ", text).strip()
        if not re.search(r"[.!?;:,'\"')\]}…>]$", text): text += "."
        return f"<{lang}>" + text + f"</{lang}>"

    def ids(self, text, lang="en"):
        t = self.prep(text, lang)
        ids = np.array([[self.idx[ord(c)] for c in t]], np.int64)
        bad = [c for c in t if self.idx[ord(c)] == -1]
        mask = np.ones((1, 1, ids.shape[1]), np.float32)
        return ids, mask, t, bad

    def duration(self, text, voice, lang="en"):
        ids, mask, _, _ = self.ids(text, lang); ttl, dp = self.style(voice)
        return float(self.dp.run(None, {"text_ids": ids, "style_dp": dp, "text_mask": mask})[0][0])

    def synth(self, text, voice="F1", speed=1.05, steps=8, lang="en", seed=None):
        rng = np.random.default_rng(seed)
        ids, mask, t, bad = self.ids(text, lang); ttl, dp = self.style(voice)
        dur = self.dp.run(None, {"text_ids": ids, "style_dp": dp, "text_mask": mask})[0] / speed
        emb = self.te.run(None, {"text_ids": ids, "style_ttl": ttl, "text_mask": mask})[0]
        wl = (dur * self.sr).astype(np.int64); cs = self.bcs * self.ccf
        ll = int((wl.max() + cs - 1) // cs)
        xt = rng.standard_normal((1, self.ldim * self.ccf, ll)).astype(np.float32)
        lm = np.ones((1, 1, ll), np.float32); xt *= lm
        ts = np.array([steps], np.float32)
        for s in range(steps):
            xt = self.ve.run(None, {"noisy_latent": xt, "text_emb": emb, "style_ttl": ttl, "text_mask": mask,
                                    "latent_mask": lm, "current_step": np.array([s], np.float32), "total_step": ts})[0]
        wav = self.vo.run(None, {"latent": xt})[0][0]
        return wav[: int(self.sr * float(dur[0]))], bad

def maxrss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
