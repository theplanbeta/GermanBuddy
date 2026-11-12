"""Chatterbox Turbo ONNX CPU engine, following the ResembleAI/chatterbox-turbo-ONNX model-card example
(greedy + repetition penalty 1.2 by default; optional sampling). No watermark applied (card example default)."""
import sys, time
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/pylib")
sys.path.insert(0, "/tmp/claude-0/-home-user-GermanBuddy/8b38b8f8-6ee7-5354-9f59-cae11fab3d16/scratchpad/bigger/scripts")
import numpy as np, onnxruntime as ort
from tokenizers import Tokenizer
from scene import read_wav

START, STOP, SIL = 6561, 6562, 4299

class CBT:
    def __init__(self, d, dtypes=None, threads=4):
        dtypes = dtypes or dict(speech_encoder="q4", embed_tokens="q4", language_model="q4", conditional_decoder="q4")
        o = ort.SessionOptions(); o.intra_op_num_threads = threads; P = ["CPUExecutionProvider"]
        t0 = time.time()
        S = {}
        for n, dt in dtypes.items():
            suf = "" if dt == "fp32" else "_quantized" if dt == "q8" else f"_{dt}"
            S[n] = ort.InferenceSession(f"{d}/onnx/{n}{suf}.onnx", o, providers=P)
        self.se, self.et, self.lm, self.cd = S["speech_encoder"], S["embed_tokens"], S["language_model"], S["conditional_decoder"]
        self.tok = Tokenizer.from_file(f"{d}/tokenizer.json")
        self.kv = [(i.name, np.float16 if i.type == "tensor(float16)" else np.float32, i.shape[1], i.shape[3]) for i in self.lm.get_inputs() if "past_key_values" in i.name]
        self.xdt = np.float16 if self.lm.get_inputs()[0].type == "tensor(float16)" else np.float32
        self.sr = 24000; self.voices = {}; self.load_s = time.time() - t0

    def voice(self, wav_path):
        if wav_path not in self.voices:
            a, sr = read_wav(wav_path); assert sr == 24000 and len(a) / sr > 5.0
            # loudness norm to ~-27 dB (official package: -27 LUFS via pyloudnorm; RMS approximation here)
            act = a[np.abs(a) > 1e-3]; a = a * (10 ** (-27 / 20) / (np.sqrt((act ** 2).mean()) + 1e-9))
            self.voices[wav_path] = self.se.run(None, {"audio_values": a[None, :].astype(np.float32)})
        return self.voices[wav_path]

    @staticmethod
    def punc_norm(text):  # from chatterbox tts_turbo.punc_norm
        if text and text[0].islower(): text = text[0].upper() + text[1:]
        text = " ".join(text.split())
        for a, b in [("\u2026", ", "), (":", ","), ("\u2014", "-"), ("\u2013", "-"), (" ,", ","), ("\u201c", '"'), ("\u201d", '"'), ("\u2018", "'"), ("\u2019", "'")]:
            text = text.replace(a, b)
        text = text.rstrip(" ")
        if not any(text.endswith(p) for p in ".!?-,"): text += "."
        return text

    def synth(self, text, ref, max_new=None, rep=1.2, sample=True, temp=0.8, top_p=0.95, seed=0):
        rng = np.random.default_rng(seed)
        cond, prompt_tok, spk_emb, spk_feat = self.voice(ref)
        text = self.punc_norm(text)
        ids = np.array([self.tok.encode(text).ids], np.int64)
        max_new = max_new or int(25 * (2.5 + 0.12 * len(text)))  # runaway guard (~0.12 s/char + 2.5 s)
        gen = [START]; past = None; T = []
        x = np.concatenate([cond.astype(self.xdt), self.et.run(None, {"input_ids": ids})[0].astype(self.xdt)], 1)
        L = x.shape[1]; am = np.ones((1, L), np.int64); pos = np.arange(L, dtype=np.int64)[None]
        past = {n: np.zeros([1, h, 0, hd], dt) for n, dt, h, hd in self.kv}
        stopped = False
        for i in range(max_new):
            t0 = time.time()
            out = self.lm.run(None, dict(inputs_embeds=x, attention_mask=am, position_ids=pos, **past))
            logits = out[0][:, -1, :].astype(np.float32)
            g = np.array(gen)[None]
            sc = np.take_along_axis(logits, g, 1); sc = np.where(sc < 0, sc * rep, sc / rep)
            np.put_along_axis(logits, g, sc, 1)
            if sample:
                l = logits[0] / temp; p = np.exp(l - l.max()); p /= p.sum()
                o_ = np.argsort(-p); c = np.cumsum(p[o_]); keep = o_[: max(1, int((c < top_p).sum()) + 1)]
                q = p[keep] / p[keep].sum(); nxt = int(rng.choice(keep, p=q))
            else:
                nxt = int(np.argmax(logits[0]))
            gen.append(nxt); T.append(time.time() - t0)
            if nxt == STOP: stopped = True; break
            x = self.et.run(None, {"input_ids": np.array([[nxt]], np.int64)})[0].astype(self.xdt)
            am = np.concatenate([am, np.ones((1, 1), np.int64)], 1); pos = pos[:, -1:] + 1
            for j, kv in enumerate(self.kv): past[kv[0]] = out[1 + j]
        sp = np.array([t for t in (gen[1:-1] if stopped else gen[1:]) if t < 6561], np.int64)[None]
        toks = np.concatenate([prompt_tok, sp, np.full((1, 3), SIL, np.int64)], 1)
        t0 = time.time()
        wav = self.cd.run(None, dict(speech_tokens=toks, speaker_embeddings=spk_emb.astype(np.float32), speaker_features=spk_feat.astype(np.float32)))[0][0]
        dec = time.time() - t0
        # the decoder output includes the prompt part? trim by token ratio if longer than generated tokens
        n_prompt = prompt_tok.shape[1]; tot = toks.shape[1]
        if len(wav) > (tot - n_prompt) * 960 * 1.2:
            wav = wav[int(len(wav) * n_prompt / tot):]
        self.last = dict(tokens=len(gen) - 1, stopped=stopped, lm_s=round(sum(T), 2), dec_s=round(dec, 2), first_tok_s=round(T[0], 3) if T else None)
        return wav.astype(np.float32)
