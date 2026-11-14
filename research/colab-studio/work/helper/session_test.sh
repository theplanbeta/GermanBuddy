#!/bin/bash
# On the server: one listening session against the helper on 127.0.0.1. Start, wait for ready,
# send every line of test_lines.json one after another, then leave it alone and watch the
# helper release the machine by itself.
cd ~/hearshot-helper; K=$(cat key); U=http://127.0.0.1:8787; A="Authorization: Bearer $K"
mkdir -p out; rm -f out/*; T0=$(date +%s); t() { echo "$(( $(date +%s) - T0 )) s  $1"; }
echo "no key  -> $(curl -s -o /dev/null -w '%{http_code}' $U/status)"
echo "bad key -> $(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' $U/status)"
curl -s -X POST -H "$A" $U/start | cut -c1-200; echo; t "start asked"
until curl -s -H "$A" $U/status | grep -q '"state": "ready"\|"state": "idle"'; do sleep 3; done
curl -s -H "$A" $U/status; echo; t "ready"
python3 - "$K" <<'PY'
import json, sys, time, urllib.request
K=sys.argv[1]; L=json.load(open("test_lines.json")); ts=[]
for j in L:
    t=time.time(); req=urllib.request.Request("http://127.0.0.1:8787/line", data=json.dumps(j).encode(), headers={"Authorization":f"Bearer {K}","Content-Type":"application/json"})
    try:
        r=urllib.request.urlopen(req, timeout=150); wav=r.read(); open(f"out/{j['id']}.wav","wb").write(wav); res=r.headers.get("X-Hearshot-Result"); code=r.status
    except urllib.error.HTTPError as e: code=e.code; res=e.read().decode()[:160]; wav=b""
    dt=time.time()-t; ts.append(dt); print(f"{j['id']:10s} {code} {dt:5.1f}s {len(wav)//1000:4d} kB {res}", flush=True)
ts.sort(); print(f"LINES {len(ts)}  median {ts[len(ts)//2]:.1f}s  max {ts[-1]:.1f}s  total {sum(ts):.0f}s")
PY
t "lines done"
until curl -s -H "$A" $U/status | grep -q '"state": "idle"'; do sleep 10; done
t "helper released the machine by itself"; curl -s -H "$A" $U/status; echo
~/.local/bin/colab sessions < /dev/null; ~/.local/bin/colab usage < /dev/null; tail -n 4 helper.log; free -m | sed -n 2p
