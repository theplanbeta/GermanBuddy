# Per voice over the audition lines: median F0, level, HNR, and timbre distance to af_heart
# (RMS difference of level-normalised 1/3-octave long-term spectra, 100 Hz-8 kHz, dB).
import sys, glob, os, re
import numpy as np, parselmouth
d = sys.argv[1]
def ltas(x, sr):
    h, w = 240, 1024; win = np.hanning(w); acc = None
    fr = [x[i:i+w] for i in range(0, len(x)-w, h)]
    e = np.array([np.sum(f**2) for f in fr]); keep = e > e.max() * 10**(-4)
    for f, k in zip(fr, keep):
        if not k: continue
        S = np.abs(np.fft.rfft(f*win))**2
        acc = S if acc is None else acc + S
    fq = np.fft.rfftfreq(w, 1/sr)
    edges = 100 * 2 ** (np.arange(0, 6.4, 1/3))
    b = np.array([acc[(fq >= lo) & (fq < lo*2**(1/3))].sum() for lo in edges if lo*2**(1/3) <= 8000])
    b = 10*np.log10(b + 1e-12); return b - b.mean()
def stats(f):
    s = parselmouth.Sound(f); x = s.values[0]; sr = s.sampling_frequency
    p = s.to_pitch_ac(time_step=0.01, pitch_floor=65, pitch_ceiling=500).selected_array['frequency']; p = p[p > 0]
    hn = s.to_harmonicity_cc(time_step=0.01).values[0]; hn = hn[hn > -100]
    fr = x[: len(x)//240*240].reshape(-1, 240); e = (fr**2).mean(1); sp = e > e.max()*1e-4
    rms = 10*np.log10(e[sp].mean())
    return np.median(p), rms, hn.mean(), ltas(x, sr), np.percentile(12*np.log2(p),95)-np.percentile(12*np.log2(p),5)
voices = sorted({os.path.basename(f).split('__')[0] for f in glob.glob(f'{d}/*__L*.wav')})
ref = {}
for f in glob.glob(f'{d}/af_heart__L*.wav'): ref[f.split('__')[1]] = stats(f)
print(f"{'voice':34s} {'F0 Hz':>6s} {'range st':>8s} {'level dB':>8s} {'HNR dB':>7s} {'timbre dist dB':>14s}")
for v in voices:
    rows = [(stats(f), ref[f.split('__')[1]]) for f in sorted(glob.glob(f'{d}/{v}__L*.wav'))]
    f0 = np.median([r[0][0] for r in rows]); lv = np.mean([r[0][1] for r in rows]); hn = np.mean([r[0][2] for r in rows]); rg = np.mean([r[0][4] for r in rows])
    dist = np.mean([np.sqrt(np.mean((r[0][3]-r[1][3])**2)) for r in rows])
    print(f"{v:34s} {f0:6.0f} {rg:8.1f} {lv:8.1f} {hn:7.1f} {dist:14.2f}")
