# objective proxy (NOT a listening test): log-spectral distance on 80-band mel-ish spectra + best-lag alignment, vs the original 24 kHz WAV
import numpy as np,scipy.io.wavfile as w,glob,os,scipy.signal as ss
sr,ref=w.read('../assets/speech6min.wav');ref=ref.astype(np.float32)/32768
def mel(x):
    f,t,S=ss.stft(x,sr,nperseg=512,noverlap=256);P=np.abs(S)**2
    fb=np.linspace(0,1,81)**1.6*(sr/2);idx=np.searchsorted(f,fb);E=np.array([P[idx[i]:max(idx[i+1],idx[i]+1)].sum(0) for i in range(80)])
    return 10*np.log10(E+1e-10)
R=mel(ref);act=R.max(0)>-60
rows=[]
for fn in sorted(glob.glob('dec/*.wav')):
    s,d=w.read(fn);d=d.astype(np.float32)/32768
    # alignment: cross-correlate first 5 s
    n=sr*5;c=ss.correlate(d[:n+4000],ref[:n],mode='valid',method='fft');lag=int(np.argmax(c))
    d2=d[lag:lag+len(ref)];m=min(len(d2),len(ref))
    D=mel(d2[:m]);Rm=R[:,:D.shape[1]]
    lsd=np.sqrt(((D-Rm)**2).mean(0))[act[:D.shape[1]]].mean()
    hi=np.sqrt(((D[60:]-Rm[60:])**2).mean(0))[act[:D.shape[1]]].mean()
    snr=10*np.log10((ref[:m]**2).sum()/(((d2[:m]-ref[:m])**2).sum()+1e-9))
    rows.append((os.path.basename(fn).replace('.wav',''),lag,round(float(lsd),2),round(float(hi),2),round(float(snr),1)))
print('%-26s %5s %8s %10s %7s'%('file','lag','LSD dB','LSD>top20','SNR dB'))
for r in rows:print('%-26s %5d %8.2f %10.2f %7.1f'%r)
