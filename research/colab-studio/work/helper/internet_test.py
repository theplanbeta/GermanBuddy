"""From any computer: one run against the helper's public address, as the app would do it.
start -> wait for ready -> three lines -> save the audio -> stop.
Usage: HS_KEY=... python3 internet_test.py https://<address> <output folder>"""
import json, os, sys, time, urllib.request, urllib.error
U, OUT, K = sys.argv[1].rstrip("/"), sys.argv[2], os.environ["HS_KEY"]
def call(path, body=None, method=None):
    req = urllib.request.Request(U + path, data=json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None),
                                 headers={"Authorization": f"Bearer {K}", "Content-Type": "application/json"}, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=150); return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e: return e.code, e.read(), e.headers
T0 = time.time(); t = lambda m: print(f"{time.time() - T0:5.0f} s  {m}", flush=True)
c, b, _ = call("/start", method="POST"); t(f"start asked ({c})")
while True:
    c, b, _ = call("/status"); s = json.loads(b)
    if s["state"] in ("ready", "idle"): break
    time.sleep(3)
t(f"state {s['state']} error {s['error']}")
if s["state"] == "ready":
    L = [dict(id="net-1", voice="af_aoede", text="[fear] Daniel... I'm serious. Someone is in the house.", expect="Daniel... I'm serious. Someone is in the house.", seed=11),
         dict(id="net-2", voice="am_fenrir", text="[angry] Run, Sarah!", expect="Run, Sarah!", seed=281),
         dict(id="net-3", voice="af_aoede", text="[laugh]", kind="laugh", seed=407)]
    for j in L:
        x = time.time(); c, b, h = call("/line", j)
        if c == 200: open(f"{OUT}/{j['id']}.wav", "wb").write(b)
        t(f"{j['id']} {c} {time.time() - x:.1f}s {len(b) // 1000} kB {h.get('X-Hearshot-Result') if c == 200 else b[:160]}")
    c, b, _ = call("/stop", method="POST"); t(f"stop asked ({c})")
    while json.loads(call("/status")[1])["state"] != "idle": time.sleep(3)
    t("stopped")
print(call("/status")[1].decode())
