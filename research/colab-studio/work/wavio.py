"""WAV reading and writing and the frame-level meter, copied unchanged from
research/dialogue-hybrid/models/scene.py (read_wav, write_wav, frame_db) so the workbench
scripts do not need that file's cloud-session paths."""
import wave
import numpy as np


def read_wav(path):
    with wave.open(path) as w:
        sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels()
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
