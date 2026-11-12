"""asr_check.py <para_dir> : ASR each pNN.wav (whisper-base.en), compare with expect.json; print problems + WER."""
import sys, json, subprocess, re, difflib, os
d = sys.argv[1]; S = os.path.dirname(os.path.abspath(__file__))
exp = json.load(open(f"{d}/expect.json"))
files = sorted(f"{d}/{f}" for f in os.listdir(d) if f.endswith(".wav"))
env = dict(os.environ, NODE_USE_ENV_PROXY="1", NODE_EXTRA_CA_CERTS="/root/.ccr/ca-bundle.crt")
out = subprocess.run(["node", f"{S}/asr.mjs"] + files, capture_output=True, text=True, env=env).stdout
got = {int(re.search(r"p(\d+)", j["file"]).group(1)): j["text"] for j in map(json.loads, out.strip().splitlines())}
num = {"ten": "10", "twenty": "20"}
def norm(s):
    s = s.lower().replace("’", "'").replace("…", " ").replace("—", " ")
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", s)  # whisper non-speech labels
    w = re.findall(r"[a-z0-9']+", s)
    return [num.get(x, x) for x in w]
E = N = 0; rows = []
for p in sorted(got):
    ref = norm(exp.get(str(p), "")); hyp = norm(got[p])
    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False); errs = []
    e = 0
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal": continue
        e += max(a1 - a0, b1 - b0); errs.append(f"{op}:{' '.join(ref[a0:a1])}->{' '.join(hyp[b0:b1])}")
    E += e; N += len(ref)
    labels = re.findall(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", got[p])
    if errs or labels: rows.append(f"p{p:02d} err={e} {errs} labels={labels} | ASR: {got[p]}")
print("\n".join(rows)); print(f"WER {E}/{N} = {E/max(N,1):.3f}")
