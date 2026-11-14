"""Hearshot helper: the small program on the owner's server that the app calls instead of anyone
tapping Run in Colab. It holds no logic about voices; it only drives Google's `colab` tool.

    POST /start    start a Colab machine and the studio cell (returns at once; poll /status)
    GET  /status   idle | starting | ready | stopping, and today's use
    POST /line     {"id","voice","text","kind","expect","seed"} -> the audio (audio/wav),
                   or 422 with the check result when the line failed its check twice
    POST /stop     release the machine now

Every request must carry "Authorization: Bearer <key>" (the key is in KEY_FILE, made on first
start, owner-only). Limits, so that a leaked key cannot drain the compute units: one machine at
a time, released after IDLE_MIN quiet minutes or MAX_SESSION_MIN, at most DAILY_MIN machine
minutes a day, short texts, known voices only, a ceiling on requests per minute.

It listens on 127.0.0.1 only. Whatever makes it reachable from outside sits in front of it.
Run:  python3 helper.py     (settings through the environment, see below)
"""
import os, re, sys, json, time, hmac, base64, select, secrets, threading, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
DIR = os.environ.get("HS_DIR", f"{HOME}/hearshot-helper")
COLAB = os.environ.get("HS_COLAB", f"{HOME}/.local/bin/colab")
CELL = os.environ.get("HS_CELL", f"{DIR}/studio_helper.py")
TOOL_PY = os.environ.get("HS_TOOL_PY", f"{HOME}/.local/share/uv/tools/google-colab-cli/bin/python")
CONN = os.environ.get("HS_CONN", f"{DIR}/conn.py")
PORT = int(os.environ.get("HS_PORT", "8787"))
GPU = os.environ.get("HS_GPU", "T4")
SESSION = "hearshot"
IDLE_MIN = float(os.environ.get("HS_IDLE_MIN", "10"))
MAX_SESSION_MIN = float(os.environ.get("HS_MAX_SESSION_MIN", "90"))
DAILY_MIN = float(os.environ.get("HS_DAILY_MIN", "180"))
MAX_TEXT = 400
VOICES = {"af_aoede", "am_fenrir"}          # the voice samples the cell carries
RATE_PER_MIN = 120
ORIGINS = {o.strip() for o in os.environ.get("HS_ORIGIN", "").split(",") if o.strip()}   # the app's web address(es), for the browser's cross-site rule
KEY_FILE = f"{DIR}/key"; LEDGER = f"{DIR}/usage.json"; LOG = f"{DIR}/helper.log"
os.makedirs(DIR, exist_ok=True); os.chmod(DIR, 0o700)

def log(msg):
    with open(LOG, "a") as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")

if not os.path.exists(KEY_FILE):
    fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.write(fd, secrets.token_urlsafe(32).encode()); os.close(fd)
KEY = open(KEY_FILE).read().strip()

# ---------- Google's tool ----------
def colab(*args, code=None, timeout=120):
    """Runs one `colab` command. Returns (ok, output)."""
    try:
        r = subprocess.run([COLAB, *args], input=code if code is not None else "", capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout + r.stderr)
    except subprocess.TimeoutExpired:
        return False, "timeout"
def on_machine(code, timeout=90):
    return colab("exec", "-s", SESSION, "--timeout", str(timeout), code=code, timeout=timeout + 30)

class Conn:
    """The kept-open connection (conn.py). run() returns (ok, output); any trouble closes it,
    and the next call opens a new one."""
    def __init__(self): self.p = None
    def _read(self, deadline):
        buf = b""
        while time.time() < deadline:
            if self.p.poll() is not None: return None
            if select.select([self.p.stdout], [], [], 0.5)[0]:
                chunk = os.read(self.p.stdout.fileno(), 1 << 20)
                if not chunk: return None
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.startswith(b"HSCONN "): return json.loads(line[7:])
        return None
    def open(self):
        self.close()
        self.p = subprocess.Popen([TOOL_PY, CONN, SESSION], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        r = self._read(time.time() + 60)
        if not (r and r["ok"]): self.close(); return False
        return True
    def close(self):
        if self.p:
            try: self.p.kill(); self.p.wait(timeout=5)
            except Exception: pass
        self.p = None
    def run(self, code, timeout=90):
        if (self.p is None or self.p.poll() is not None) and not self.open(): return False, "no connection"
        try:
            self.p.stdin.write((json.dumps(dict(code=code, timeout=timeout)) + "\n").encode()); self.p.stdin.flush()
        except Exception:
            self.close(); return False, "connection lost"
        r = self._read(time.time() + timeout + 15)
        if r is None: self.close(); return False, "timeout"
        return r["ok"], r["out"]

# ---------- today's use ----------
def ledger():
    try: d = json.load(open(LEDGER))
    except Exception: d = {}
    return d if d.get("day") == time.strftime("%Y-%m-%d") else {"day": time.strftime("%Y-%m-%d"), "minutes": 0.0, "lines": 0, "starts": 0}
def ledger_add(**kw):
    d = ledger()
    for k, v in kw.items(): d[k] = round(d.get(k, 0) + v, 2)
    json.dump(d, open(LEDGER, "w")); return d

# ---------- the machine ----------
class Machine:
    def __init__(self):
        self.state = "idle"; self.lock = threading.RLock(); self.line_lock = threading.Lock()
        self.started = self.last_work = self.ready_at = 0.0; self.error = None; self.lines = 0; self.stamps = {}
        self.conn = Conn(); self.slow_path = 0
    def status(self):
        d = ledger(); now = time.time()
        return dict(state=self.state, error=self.error, lines=self.lines, slow_path=self.slow_path,
                    up_s=round(now - self.started) if self.started else 0,
                    ready_after_s=round(self.ready_at - self.started) if self.ready_at else None,
                    quiet_s=round(now - self.last_work) if self.state == "ready" else None,
                    today=dict(minutes=round(d["minutes"] + self._running_min(), 1), limit=DAILY_MIN, lines=d["lines"], starts=d["starts"]))
    def _running_min(self): return (time.time() - self.started) / 60 if self.started else 0.0
    def start(self):
        with self.lock:
            if self.state != "idle": return self.state
            if ledger()["minutes"] >= DAILY_MIN: self.error = "daily limit reached"; return "refused"
            self.state = "starting"; self.error = None; self.started = time.time(); self.ready_at = 0.0; self.lines = 0
            threading.Thread(target=self._bring_up, daemon=True).start(); return "starting"
    def _bring_up(self):
        try:
            ok, out = colab("new", "-s", SESSION, "--gpu", GPU, timeout=180)
            if not ok: raise RuntimeError("new: " + out[-300:])
            ok, out = colab("upload", "-s", SESSION, CELL, "/content/studio_helper.py", timeout=180)
            if not ok: raise RuntimeError("upload: " + out[-300:])
            ok, out = on_machine("import subprocess\nsubprocess.Popen('nohup python /content/studio_helper.py > /content/run.log 2>&1 &', shell=True)\nprint('STARTED')")
            if not ok or "STARTED" not in out: raise RuntimeError("cell: " + out[-300:])
            wait = ("import os,time\nfor _ in range(40):\n    if os.path.exists('/content/studio/status/ready.json'): break\n    time.sleep(0.5)\n"
                    "print('HSREADY' if os.path.exists('/content/studio/status/ready.json') else 'HSWAIT')\n"
                    "import subprocess; print(subprocess.run('tail -c 300 /content/run.log', shell=True, capture_output=True, text=True).stdout[-300:])")
            t0 = time.time()
            while time.time() - t0 < 420:
                if self.state != "starting": return
                ok, out = on_machine(wait, timeout=60)
                if ok and "HSREADY" in out: break
                if ok and "Traceback" in out: raise RuntimeError("cell failed: " + out[-300:])
            else: raise RuntimeError("cell not ready after 420 s")
            with self.lock:
                if self.state == "starting": self.state = "ready"; self.ready_at = self.last_work = time.time()
            ledger_add(starts=1); log(f"ready after {self.ready_at - self.started:.0f} s; kept-open connection: {self.conn.open()}")
        except Exception as e:
            self.error = str(e)[:300]; log(f"start failed: {self.error}"); self.stop("start failed")
    def stop(self, why="asked"):
        with self.lock:
            if self.state in ("idle", "stopping"): return
            self.state = "stopping"
        self.conn.close()
        ok, out = colab("stop", "-s", SESSION, timeout=120)
        mins = self._running_min()
        with self.lock: self.state = "idle"; self.started = 0.0; self.ready_at = 0.0
        ledger_add(minutes=mins); log(f"stopped ({why}), {mins:.1f} min, tool said: {out.strip()[-80:]}")
    def line(self, j):
        """Hands one request to the cell and waits for its answer. One at a time."""
        code = ("import json,os,time,base64\nD='/content/studio'\nj=json.loads(" + repr(json.dumps(j)) + ")\n"
                "p=f\"{D}/jobs/{j['id']}.json\"; r=f\"{D}/audio/{j['id']}.json\"\n"
                "if not os.path.exists(r) and not os.path.exists(p): open(p+'.tmp','w').write(json.dumps(j)); os.replace(p+'.tmp',p)\n"
                "for _ in range(600):\n    if os.path.exists(r): break\n    time.sleep(0.1)\n"
                "out={'rec':None,'wav':None}\n"
                "if os.path.exists(r):\n    time.sleep(0.05); out['rec']=json.load(open(r)); w=f\"{D}/audio/{j['id']}.wav\"\n"
                "    if os.path.exists(w): out['wav']=base64.b64encode(open(w,'rb').read()).decode()\n"
                "print('HSRESULT'+json.dumps(out))")
        with self.line_lock:
            if self.state != "ready": return None, dict(error=f"not ready ({self.state})")
            t = time.time(); m = None
            for attempt in (1, 2, 3):   # twice over the kept-open connection, then the slow way
                ok, out = self.conn.run(code, timeout=75) if attempt < 3 else on_machine(code, timeout=90)
                m = re.search(r"HSRESULT(\{.*\})", out or "")
                if m: break
                log(f"line {j['id']}: attempt {attempt} got no answer ({str(out)[-80:]})")
            if m and attempt == 3: self.slow_path += 1
            self.last_work = time.time()
        if not m: return None, dict(error="no answer from the machine", detail=out[-200:])
        res = json.loads(m.group(1)); rec = res["rec"] or dict(error="no result in 60 s")
        rec["helper_s"] = round(time.time() - t, 2); self.lines += 1; ledger_add(lines=1)
        return (base64.b64decode(res["wav"]) if res["wav"] else None), rec
    def watch(self):
        while True:
            time.sleep(20)
            if self.state == "ready":
                now = time.time()
                if now - self.last_work > IDLE_MIN * 60: self.stop(f"quiet for {IDLE_MIN:g} min")
                elif now - self.started > MAX_SESSION_MIN * 60: self.stop(f"session limit {MAX_SESSION_MIN:g} min")
                elif ledger()["minutes"] + self._running_min() >= DAILY_MIN: self.stop("daily limit")
M = Machine()

# ---------- the door ----------
hits = []
def too_fast():
    now = time.time(); hits[:] = [t for t in hits if now - t < 60]; hits.append(now); return len(hits) > RATE_PER_MIN
class H(BaseHTTPRequestHandler):
    server_version = "hearshot-helper"; sys_version = ""
    def log_message(self, *a): pass
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin); self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Expose-Headers", "X-Hearshot-Result")
    def _send(self, code, body, ctype="application/json", extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store"); self._cors()
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)
    def _allowed(self):
        if too_fast(): self._send(429, dict(error="too many requests")); return False
        got = self.headers.get("Authorization", "")
        if not hmac.compare_digest(got.encode(), f"Bearer {KEY}".encode()):
            time.sleep(0.5); self._send(401, dict(error="key missing or wrong")); return False
        return True
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header("Content-Length", "0"); self.end_headers()
    def do_GET(self):
        if not self._allowed(): return
        if self.path == "/status": return self._send(200, M.status())
        self._send(404, dict(error="unknown"))
    def do_POST(self):
        if not self._allowed(): return
        n = int(self.headers.get("Content-Length") or 0)
        if n > 4000: return self._send(413, dict(error="too large"))
        raw = self.rfile.read(n) if n else b""
        if self.path == "/start":
            r = M.start(); return self._send(200 if r != "refused" else 429, dict(M.status(), start=r))
        if self.path == "/stop":
            threading.Thread(target=M.stop, daemon=True).start(); return self._send(200, dict(stop="asked"))
        if self.path == "/line":
            try:
                j = json.loads(raw); text = str(j["text"]); voice = str(j["voice"])
                jid = re.sub(r"[^A-Za-z0-9_-]", "", str(j.get("id") or f"l{int(time.time() * 1000)}"))[:60]
                assert jid and voice in VOICES and 0 < len(text) <= MAX_TEXT
                job = dict(id=jid, voice=voice, text=text, kind="laugh" if j.get("kind") == "laugh" else "speech",
                           expect=str(j.get("expect") or "")[:MAX_TEXT], seed=int(j.get("seed") or 1))
            except Exception:
                return self._send(400, dict(error="bad request"))
            wav, rec = M.line(job)
            if "error" in rec and wav is None and "result" not in rec: return self._send(503, rec)
            if wav is None: return self._send(422, rec)
            return self._send(200, wav, "audio/wav", {"X-Hearshot-Result": json.dumps(dict(result=rec.get("result"), helper_s=rec.get("helper_s")))})
        self._send(404, dict(error="unknown"))

if __name__ == "__main__":
    colab("stop", "-s", SESSION, timeout=120)   # a machine left over from a crash would keep costing
    threading.Thread(target=M.watch, daemon=True).start()
    log(f"listening on 127.0.0.1:{PORT}; quiet {IDLE_MIN:g} min, session {MAX_SESSION_MIN:g} min, day {DAILY_MIN:g} min")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
