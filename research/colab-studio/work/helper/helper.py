"""Hearshot helper: the small program on the owner's server that the app calls instead of anyone
tapping Run in Colab. It holds no logic about voices; it only drives Google's `colab` tool.

    POST /start    start a Colab machine and the studio cell (returns at once; poll /status)
    GET  /status   idle | starting | ready | stopping, the quiet limit in force, and today's use
    POST /line     {"id","voice","text","kind","expect","seed"} -> the audio (audio/wav),
                   or 422 with the check result when the line failed its check twice
    POST /stop     release the machine now
    POST /read     {"url"} -> {"kind":"html","type","finalUrl","status","bytes","redirects","html"} or
                   {"kind":"pdf","finalUrl"}: one public web page, fetched for the app to read
                   aloud (the browser cannot fetch other sites). Errors: {"error","message"}.

Every request must carry "Authorization: Bearer <key>" (the key is in KEY_FILE, made on first
start, owner-only). Limits, so that a leaked key cannot drain the compute units: one machine at
a time, released after IDLE_MIN quiet minutes after the last line served (default 45), or
WARM_MIN minutes after ready while no line was served at all (default 12: the app starts the
studio when it is opened, and an app that was only opened must not hold a machine for long), or
after MAX_SESSION_MIN; at most DAILY_MIN machine minutes a day (default 360), short texts, known
voices only, a ceiling on requests per minute.

It listens on 127.0.0.1 only. Whatever makes it reachable from outside sits in front of it.
Run:  python3 helper.py     (settings through the environment, see below)
"""
import os, re, ssl, sys, json, time, hmac, base64, codecs, select, socket, secrets, ipaddress, threading, subprocess
import http.client
from urllib.parse import urlsplit, urljoin, quote
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
IDLE_MIN = float(os.environ.get("HS_IDLE_MIN", "45"))      # quiet minutes after the last line served
WARM_MIN = float(os.environ.get("HS_WARM_MIN", "12"))      # quiet minutes after ready while no line was served yet
MAX_SESSION_MIN = float(os.environ.get("HS_MAX_SESSION_MIN", "90"))
DAILY_MIN = float(os.environ.get("HS_DAILY_MIN", "360"))
MAX_TEXT = 400
VOICES = {"af_aoede", "am_fenrir"}          # the voice samples the cell carries
RATE_PER_MIN = 240
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
    and the next call opens a new one. open() and run() take turns (one lock): a request that
    arrives while the connection is still being opened waits for it instead of reading its greeting.
    close() does not wait, so stopping the machine is never held up by a request in flight."""
    def __init__(self): self.p = None; self.turn = threading.RLock()
    @staticmethod
    def _read(p, deadline):
        buf = b""
        while time.time() < deadline:
            if p.poll() is not None: return None
            if select.select([p.stdout], [], [], 0.5)[0]:
                chunk = os.read(p.stdout.fileno(), 1 << 20)
                if not chunk: return None
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.startswith(b"HSCONN "): return json.loads(line[7:])
        return None
    def open(self):
        """True when the connection is open. Never raises: without it, lines go the slow way."""
        with self.turn:
            self.close(); p = None
            try:
                p = self.p = subprocess.Popen([TOOL_PY, CONN, SESSION], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                r = self._read(p, time.time() + 60)
            except Exception:
                r = None
            if not (r and r.get("ok")):
                if p: self._drop(p)
                return False
            return True
    def _drop(self, p):
        """Ends this one connection; leaves a newer one alone."""
        try: p.kill(); p.wait(timeout=5)
        except Exception: pass
        if self.p is p: self.p = None
    def close(self):
        p = self.p
        if p: self._drop(p)
    def run(self, code, timeout=90):
        with self.turn:
            if (self.p is None or self.p.poll() is not None) and not self.open(): return False, "no connection"
            p = self.p
            if p is None: return False, "connection lost"   # closed meanwhile (the machine is being stopped)
            try:
                p.stdin.write((json.dumps(dict(code=code, timeout=timeout)) + "\n").encode()); p.stdin.flush()
            except Exception:
                self._drop(p); return False, "connection lost"
            try: r = self._read(p, time.time() + timeout + 15)
            except Exception: r = None   # an answer that cannot be read counts as none
            if r is None: self._drop(p); return False, "timeout"
            return bool(r.get("ok")), str(r.get("out", ""))

# ---------- today's use ----------
def ledger():
    try: d = json.load(open(LEDGER))
    except Exception: d = {}
    return d if d.get("day") == time.strftime("%Y-%m-%d") else {"day": time.strftime("%Y-%m-%d"), "minutes": 0.0, "lines": 0, "starts": 0}
_ledger_lock = threading.Lock()
def ledger_add(**kw):
    with _ledger_lock:
        d = ledger()
        for k, v in kw.items(): d[k] = round(d.get(k, 0) + v, 2)
        with open(LEDGER, "w") as f: json.dump(d, f)
        return d

# ---------- the machine ----------
# One rule keeps it to one machine: while a start is under way, only its own thread touches the session. A stop asked
# meanwhile is noted (state "stopping"), and that thread stops the machine itself the moment its current step returns
# (a `colab new` still running cannot be stopped from outside: the tool does not know the session yet). The state goes
# back to "idle" only once the machine is gone, and a start is only possible from "idle": so never two `colab new` at once,
# and an old start can never stop a newer machine.
class _NotWanted(Exception): pass
class Machine:
    def __init__(self):
        self.state = "idle"; self.lock = threading.RLock(); self.line_lock = threading.Lock()
        self.started = self.last_work = self.ready_at = 0.0; self.error = None; self.lines = 0; self.stamps = {}
        self.conn = Conn(); self.slow_path = 0; self.run_no = 0
        self.bringing = False; self.cancel = None; self.stage = ""   # a start under way; why it is no longer wanted; what it is doing
    def status(self):
        d = ledger(); now = time.time()
        return dict(state=self.state, error=self.error, lines=self.lines, slow_path=self.slow_path,
                    up_s=round(now - self.started) if self.started else 0,
                    ready_after_s=round(self.ready_at - self.started) if self.ready_at else None,
                    quiet_s=round(now - self.last_work) if self.state == "ready" else None, quiet_limit_min=self.quiet_limit() if self.state in ("starting", "ready") else None,
                    today=dict(minutes=round(d["minutes"] + self._running_min(), 1), limit=DAILY_MIN, lines=d["lines"], starts=d["starts"]))
    def quiet_limit(self):
        """The quiet minutes allowed now: short while no line was served in this session (the app was only opened)."""
        return IDLE_MIN if self.lines else WARM_MIN
    def _running_min(self): return (time.time() - self.started) / 60 if self.started else 0.0
    def start(self):
        with self.lock:
            if self.state != "idle": return self.state   # "stopping" lasts until an earlier start has really ended
            if ledger()["minutes"] >= DAILY_MIN: self.error = "daily limit reached"; return "refused"
            self.state = "starting"; self.error = None; self.started = time.time(); self.ready_at = 0.0; self.lines = 0
            self.run_no += 1; self.bringing = True; self.cancel = None; self.stage = "making the machine"
            threading.Thread(target=self._bring_up, args=(self.run_no,), daemon=True).start(); return "starting"
    def _step(self, stage):
        """Between two steps of a start: on to `stage`, or out (the start is no longer wanted)."""
        with self.lock:
            if self.cancel: raise _NotWanted()
            self.stage = stage
    def _bring_up(self, run_no):
        """One start, from `colab new` to "ready". Ends in "ready", or with the machine stopped by this thread."""
        try:
            ok, out = colab("new", "-s", SESSION, "--gpu", GPU, timeout=180)   # from here on a machine may exist
            self._step("uploading the cell")
            if not ok: raise RuntimeError("new: " + out[-300:])
            ok, out = colab("upload", "-s", SESSION, CELL, "/content/studio_helper.py", timeout=180)
            self._step("starting the cell")
            if not ok: raise RuntimeError("upload: " + out[-300:])
            ok, out = on_machine("import subprocess\nsubprocess.Popen('nohup python /content/studio_helper.py > /content/run.log 2>&1 &', shell=True)\nprint('STARTED')")
            self._step("waiting for the cell")
            if not ok or "STARTED" not in out: raise RuntimeError("cell: " + out[-300:])
            wait = ("import os,time\nfor _ in range(40):\n    if os.path.exists('/content/studio/status/ready.json'): break\n    time.sleep(0.5)\n"
                    "print('HSREADY' if os.path.exists('/content/studio/status/ready.json') else 'HSWAIT')\n"
                    "import subprocess; print(subprocess.run('tail -c 300 /content/run.log', shell=True, capture_output=True, text=True).stdout[-300:])")
            t0 = time.time()
            while time.time() - t0 < 420:
                ok, out = on_machine(wait, timeout=60)
                self._step("waiting for the cell")
                if ok and "HSREADY" in out: break
                if ok and "Traceback" in out: raise RuntimeError("cell failed: " + out[-300:])
            else: raise RuntimeError("cell not ready after 420 s")
            # The connection first, "ready" after: the app asks for its first line the moment it
            # sees "ready", and that line must not meet a connection that is still being opened.
            self._step("opening the connection")
            opened = self.conn.open()
            with self.lock:
                if self.cancel: raise _NotWanted()
                self.state = "ready"; self.ready_at = self.last_work = time.time(); self.bringing = False
            ledger_add(starts=1); log(f"ready after {self.ready_at - self.started:.0f} s; kept-open connection: {opened}")
        except _NotWanted:
            self._release(f"{self.cancel} during the start, while {self.stage}")
        except Exception as e:
            self.error = None if self.cancel else str(e)[:300]
            if self.error: log(f"start failed: {self.error}")
            self._release(f"{self.cancel} during the start, while {self.stage}" if self.cancel else "start failed")
    def stop(self, why="asked"):
        with self.lock:
            if self.state in ("idle", "stopping"): return
            self.state = "stopping"
            if self.bringing: self.cancel = why; return   # the start under way stops the machine itself (see the top of the class)
        self._release(why)
    def _release(self, why):
        """Stops the machine; "idle" only after the tool was told to. Asked once more if the tool failed for another reason than "not found"."""
        with self.lock: self.state = "stopping"
        self.conn.close()
        ok, out = colab("stop", "-s", SESSION, timeout=120)
        if not ok and "not found" not in out.lower(): ok, out = colab("stop", "-s", SESSION, timeout=120)
        mins = self._running_min()
        with self.lock: self.state = "idle"; self.started = 0.0; self.ready_at = 0.0; self.bringing = False; self.cancel = None
        ledger_add(minutes=mins); log(f"stopped ({why}), {mins:.1f} min, tool said: {out.strip()[-80:]}")
    def line(self, j):
        """Hands one request to the cell and waits for its answer. One at a time."""
        code = ("import json,os,time,base64\nD='/content/studio'\nj=json.loads(" + repr(json.dumps(j)) + ")\n"
                "p=f\"{D}/jobs/{j['id']}.json\"; r=f\"{D}/audio/{j['id']}.json\"\n"
                "if not os.path.exists(r) and not os.path.exists(p): open(p+'.tmp','w').write(json.dumps(j)); os.replace(p+'.tmp',p)\n"
                "for _ in range(350):\n    if os.path.exists(r): break\n    time.sleep(0.1)\n"
                "out={'rec':None,'wav':None}\n"
                "if os.path.exists(r):\n    time.sleep(0.05); out['rec']=json.load(open(r)); w=f\"{D}/audio/{j['id']}.wav\"\n"
                "    if os.path.exists(w): out['wav']=base64.b64encode(open(w,'rb').read()).decode()\n"
                "print('HSRESULT'+json.dumps(out))")
        with self.line_lock:
            if self.state != "ready": return None, dict(error=f"not ready ({self.state})")
            t = time.time(); m = None
            # Twice over the kept-open connection; the slow way only when that connection cannot
            # be opened at all. Kept under the app's own patience (90 s), so requests do not pile up.
            for attempt in (1, 2):
                if self.state != "ready": out = "the machine is being stopped"; break
                ok, out = self.conn.run(code, timeout=38)
                if out == "no connection":
                    self.slow_path += 1; ok, out = on_machine(code, timeout=45)
                m = re.search(r"HSRESULT(\{.*\})", out or "")
                if m: break
                log(f"line {j['id']}: attempt {attempt} got no answer ({str(out)[-80:]})")
        if m and json.loads(m.group(1))["rec"]: self.last_work = time.time()   # only real work keeps the machine
        if not m: return None, dict(error="no answer from the machine", detail=out[-200:])
        res = json.loads(m.group(1)); rec = res["rec"] or dict(error="no result in 35 s")
        rec["helper_s"] = round(time.time() - t, 2); self.lines += 1; ledger_add(lines=1)
        return (base64.b64decode(res["wav"]) if res["wav"] else None), rec
    def watch(self):
        while True: time.sleep(20); self.check()
    def check(self):
        """The limits for a ready machine (one look; watch() looks every 20 s)."""
        if self.state == "ready":
            now = time.time()
            # No line served yet: the short warm limit, counted from ready; after one: the long one, from the last line.
            limit = self.quiet_limit(); since = self.last_work if self.lines else self.ready_at
            if now - since > limit * 60: self.stop(f"quiet for {limit:g} min ({'after the last line' if self.lines else 'no line served since ready'})")
            elif now - self.started > MAX_SESSION_MIN * 60: self.stop(f"session limit {MAX_SESSION_MIN:g} min")
            elif ledger()["minutes"] + self._running_min() >= DAILY_MIN: self.stop("daily limit")
M = Machine()

# ---------- reading one web page (POST /read) ----------
# The most dangerous thing in this file: the server fetches an address someone typed, from inside
# the owner's network. So: http(s) on ports 80/443 only, no local names, every address the name
# resolves to must be on the open internet, the connection goes to that checked address itself
# (a second DNS answer cannot swap it), every redirect is checked the same way, one GET without
# cookies or body, 9 s for the whole chain, 2 MB. Nothing is stored; the log gets the host only.
READ_PER_MIN = int(os.environ.get("HS_READ_PER_MIN", "12")); READ_DAILY = int(os.environ.get("HS_READ_DAILY", "300"))
READ_MAX_BYTES = 2 * 1024 * 1024; READ_TOTAL_S = 9.0; READ_CONNECT_S = 3.0; READ_HOPS = 4; READ_MAX_URL = 2048; READ_AT_ONCE = 2
READ_UA = "HearshotReader/1 (fetches one page for its owner to listen to)"
READ_TYPES = {"text/html", "application/xhtml+xml", "text/plain"}
READ_STATUS = dict(bad_request=400, bad_url=400, blocked_address=400, too_many_redirects=422, too_large=422, unsupported_type=422,
                   blocked_by_site=422, paywall=422, not_found=422, site_rate_limited=502, site_error=502, unreachable=502,
                   bad_certificate=502, timeout=504, busy=429, read_limit=429, daily_limit=429)
READ_SAY = dict(
    bad_request="The request did not carry a web address.", bad_url="That is not a web address this helper can open.",
    blocked_address="That address points inside a private network, so it is not opened.",
    too_many_redirects="The page sent the helper on too many hops.", too_large="The page is larger than 2 MB.",
    unsupported_type="That link is not a web page (it is a file of another kind).", blocked_by_site="The site refused the helper.",
    paywall="The site asks for payment.", not_found="The site says the page does not exist.",
    site_rate_limited="The site says it is getting too many requests.", site_error="The site answered with an error.",
    unreachable="The site could not be reached.", bad_certificate="The site's security certificate did not check out.",
    timeout="The site took longer than 9 seconds.", busy="The helper is already reading two pages.",
    read_limit="Too many pages in the last minute.", daily_limit="The daily number of pages is used up.")
class ReadError(Exception):
    def __init__(self, code, detail=""): super().__init__(code); self.code = code; self.detail = detail

_V4_NO = [ipaddress.ip_network(n) for n in ("0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
          "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/3")]
_V6_OK = ipaddress.ip_network("2000::/3"); _NAT64 = ipaddress.ip_network("64:ff9b::/96")
_V6_NO = [ipaddress.ip_network(n) for n in ("2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20")]
def public_ip(a):
    """True only for an address on the open internet. IPv4 inside IPv6 (mapped, 6to4, NAT64) is judged by the IPv4."""
    try: ip = ipaddress.ip_address(a)
    except ValueError: return False
    if ip.version == 6:
        if ip.scope_id: return False
        inner = ip.ipv4_mapped or ip.sixtofour or (ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF) if ip in _NAT64 else None)
        if inner is not None: return public_ip(str(inner))
        if ip.teredo: return False
        return ip in _V6_OK and ip.is_global and not ip.is_multicast and not any(ip in n for n in _V6_NO)
    return ip.is_global and not (ip.is_multicast or ip.is_reserved or ip.is_loopback or ip.is_link_local or ip.is_private) and not any(ip in n for n in _V4_NO)

_LOCAL_ENDS = (".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".arpa", ".ts.net")
def check_url(raw, loopback=False):
    """The address, taken apart and checked, or ReadError. `loopback` is for test_read.py only (nothing else passes it):
    it lets exactly the host 127.0.0.1 through, on any port; every other host is checked as always."""
    if not isinstance(raw, str) or not raw or len(raw) > READ_MAX_URL or re.search(r"[\x00-\x20\x7f\\]", raw): raise ReadError("bad_url")
    try: u = urlsplit(raw); port = u.port; host = (u.hostname or "").rstrip(".")
    except ValueError: raise ReadError("bad_url")
    if u.scheme not in ("http", "https") or "@" in u.netloc or not host: raise ReadError("bad_url")
    test = loopback is True and host == "127.0.0.1"
    if port not in (None, 80, 443) and not test: raise ReadError("bad_url")
    try: literal = str(ipaddress.ip_address(host))
    except ValueError: literal = None
    if literal is None:
        try: host = host.encode("idna").decode("ascii").lower()
        except UnicodeError: raise ReadError("bad_url")
        labels = host.split(".")
        if not all(re.fullmatch(r"[a-z0-9_-]{1,63}", l) for l in labels): raise ReadError("bad_url")
        if len(labels) < 2 or host == "localhost" or host.endswith(_LOCAL_ENDS): raise ReadError("blocked_address")
        if re.fullmatch(r"0x[0-9a-f]*|[0-9]+", labels[-1]): raise ReadError("blocked_address")   # 127.1, 0x7f.0.0.1, 0177.0.0.1: an address in disguise
    elif not (test or public_ip(literal)): raise ReadError("blocked_address")
    else: host = literal
    port = port or (443 if u.scheme == "https" else 80)
    path = quote(u.path or "/", safe="/%:@!$&'()*+,;=-._~") + ("?" + quote(u.query, safe="/%:@!$&'()*+,;=-._~?") if u.query else "")
    hosthdr = (f"[{host}]" if ":" in host else host) + ("" if port == (443 if u.scheme == "https" else 80) else f":{port}")
    return dict(scheme=u.scheme, host=host, port=port, path=path, literal=literal is not None, hosthdr=hosthdr, url=f"{u.scheme}://{hosthdr}{path}")

def dns_lookup(host, port): return [ai[4][0] for ai in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]
def _addresses(t, resolve, left):
    """The addresses to connect to: all of them public, or ReadError. The lookup counts against the time too."""
    if t["literal"]: return [t["host"]]          # checked by check_url already
    box = {}
    def run():
        try: box["ips"] = list(dict.fromkeys(str(a) for a in resolve(t["host"], t["port"])))
        except Exception as e: box["err"] = e
    th = threading.Thread(target=run, daemon=True); th.start(); th.join(max(0.01, left()))
    if th.is_alive(): raise ReadError("timeout", "lookup")
    if not box.get("ips"): raise ReadError("unreachable", "no address")
    if not all(public_ip(a) for a in box["ips"]): raise ReadError("blocked_address", "resolves to a private address")
    return box["ips"]

def _status_code(st):
    return ("blocked_by_site" if st in (401, 403, 451) else "paywall" if st == 402 else "not_found" if st in (404, 410)
            else "site_rate_limited" if st == 429 else "site_error")
# Text encodings used on the web, by Python's own name for them (codecs.lookup(...).name). Anything else (punycode
# and idna decode in quadratic time; rot13, hex, zlib are not text at all; utf-7) is never handed to .decode().
WEB_CODECS = {"utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "ascii", "cp1252", "cp1250", "cp1251", "cp1253", "cp1254",
              "cp1255", "cp1256", "cp1257", "cp1258", "cp874", "iso8859-1", "iso8859-2", "iso8859-3", "iso8859-4", "iso8859-5",
              "iso8859-6", "iso8859-7", "iso8859-8", "iso8859-9", "iso8859-10", "iso8859-13", "iso8859-14", "iso8859-15",
              "iso8859-16", "koi8-r", "koi8-u", "mac-roman", "shift_jis", "cp932", "euc_jp", "iso2022_jp", "euc_kr", "cp949",
              "gb2312", "gbk", "gb18030", "big5", "big5hkscs"}
def decode_page(body, ctype):
    """Text from the bytes: the header's charset, else a <meta charset> in the first 2 kB, else UTF-8 (bad bytes replaced).
    A name that is not a known web encoding counts as no name."""
    m = re.search(r"charset\s*=\s*[\"']?([\w.:-]{1,40})", ctype or "", re.I); cs = m and m.group(1)
    if not cs:
        m = re.search(rb"<meta[^>]+charset\s*=\s*[\"']?([\w.:-]{1,40})", bytes(body[:2048]), re.I); cs = m and m.group(1).decode("ascii", "replace")
    try: cs = codecs.lookup(cs).name if cs else "utf-8"
    except (LookupError, ValueError, TypeError): cs = "utf-8"
    if cs not in WEB_CODECS: cs = "utf-8"
    if cs in ("iso8859-1", "ascii"): cs = "cp1252"   # as browsers do
    if cs == "utf-8": cs = "utf-8-sig"               # a byte-order mark is dropped
    return bytes(body).decode(cs, errors="replace")

def fetch_page(raw, resolve=dns_lookup, allow_loopback=False, total_s=READ_TOTAL_S, max_bytes=READ_MAX_BYTES):
    """One public page, or ReadError(code). `resolve` and `allow_loopback` exist for test_read.py; the door passes neither."""
    end = time.monotonic() + total_s; left = lambda: end - time.monotonic(); live = {}; expired = threading.Event()
    def kill():                                   # the 9 s are for the whole chain: at the end, the open socket is cut
        expired.set(); s = live.get("sock")
        if s:
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
    timer = threading.Timer(total_s, kill); timer.daemon = True; timer.start()
    hops = 0
    def drop():                                   # closes this hop's sockets (both handles)
        for k in ("conn", "cur", "sock"):
            x = live.pop(k, None)
            try: x and x.close()
            except OSError: pass
    try:
        t = check_url(raw, allow_loopback)
        while True:
            last = None; ips = sorted(_addresses(t, resolve, left), key=lambda a: ":" in a)   # IPv4 first
            for k, ip in enumerate(ips):                # a dead address gets READ_CONNECT_S at most; the last one, all the time left
                if left() <= 0: raise ReadError("timeout")
                wait = left() if k == len(ips) - 1 else min(READ_CONNECT_S, left())
                try: live["cur"] = socket.create_connection((ip, t["port"]), timeout=max(0.01, wait)); break
                except OSError as e: last = e
            else: raise ReadError("timeout" if left() <= 0 else "unreachable", type(last).__name__)
            live["sock"] = live["cur"].dup()      # a second handle for kill(): still valid after the TLS wrap takes the first
            if expired.is_set(): raise ReadError("timeout")
            if t["scheme"] == "https":
                live["cur"].settimeout(max(0.01, left())); live["cur"] = ssl.create_default_context().wrap_socket(live["cur"], server_hostname=t["host"])
            sock = live["cur"]; conn = live["conn"] = http.client.HTTPConnection(t["host"], t["port"]); conn.sock = sock   # already connected to the checked address
            sock.settimeout(max(0.01, left()))
            conn.request("GET", t["path"], headers={"Host": t["hosthdr"], "User-Agent": READ_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
                         "Accept-Language": "en;q=0.9,de;q=0.8,es;q=0.7,*;q=0.3", "Accept-Encoding": "identity", "Connection": "close"})
            resp = conn.getresponse(); st = resp.status; hdr = lambda k: (resp.getheader(k) or "").strip()
            if expired.is_set() or left() <= 0: raise ReadError("timeout")   # headers cut short by kill() look complete
            if st in (301, 302, 303, 307, 308):
                loc = hdr("Location").replace(" ", "%20"); drop()
                if not loc: raise ReadError("site_error", str(st))
                hops += 1
                if hops > READ_HOPS: raise ReadError("too_many_redirects")
                t = check_url(urljoin(t["url"], loc), allow_loopback); continue   # every hop checked like the first
            if not 200 <= st < 300: raise ReadError(_status_code(st), str(st))
            ctype = hdr("Content-Type"); mime = ctype.split(";")[0].strip().lower()
            if mime == "application/pdf": return dict(kind="pdf", finalUrl=t["url"])   # the body is not downloaded
            if mime not in READ_TYPES or hdr("Content-Encoding").lower() not in ("", "identity"): raise ReadError("unsupported_type", mime)
            if hdr("Content-Length").isdigit() and int(hdr("Content-Length")) > max_bytes: raise ReadError("too_large")
            body = bytearray()
            # With "Connection: close" in the answer, the response owns the socket and closes it (fd -1) the moment the
            # declared Content-Length has been read: so stop there, before the socket is touched again.
            while not resp.isclosed():
                if left() <= 0 or expired.is_set(): raise ReadError("timeout")
                sock.settimeout(max(0.01, left())); chunk = resp.read1(65536)
                if not chunk: break
                body += chunk
                if len(body) > max_bytes: raise ReadError("too_large")
            if expired.is_set(): raise ReadError("timeout")
            return dict(kind="html", type=mime, finalUrl=t["url"], status=st, bytes=len(body), redirects=hops, html=decode_page(body, ctype))
    except ReadError: raise
    except ssl.SSLCertVerificationError as e: raise ReadError("timeout" if expired.is_set() else "bad_certificate", type(e).__name__)
    except (OSError, http.client.HTTPException, ValueError) as e: raise ReadError("timeout" if expired.is_set() or left() <= 0 else "unreachable", type(e).__name__)
    finally: timer.cancel(); drop()

read_hits = []; _read_lock = threading.Lock(); _read_slots = threading.BoundedSemaphore(READ_AT_ONCE)
def read_budget():
    """None when one more page may be read now (and counts it), else the limit's code."""
    with _read_lock:
        now = time.time(); read_hits[:] = [t for t in read_hits if now - t < 60]
        if len(read_hits) >= READ_PER_MIN: return "read_limit"
        if ledger().get("reads", 0) >= READ_DAILY: return "daily_limit"
        read_hits.append(now); ledger_add(reads=1); return None
def _host_of(url):
    try: return re.sub(r"[^a-z0-9.:\[\]-]", "", (urlsplit(url).hostname or "?").lower())[:80] or "?"
    except Exception: return "?"
def read_request(raw, fetch=fetch_page):
    """POST /read: (HTTP status, JSON) for the body the app sent. `fetch` is for test_read.py only."""
    say = lambda code: (READ_STATUS.get(code, 502), dict(error=code, message=READ_SAY.get(code, "The page could not be read.")))
    try:
        url = json.loads(raw)["url"]
        if not isinstance(url, str) or not url.strip(): raise ValueError
    except Exception: return say("bad_request")
    if not _read_slots.acquire(blocking=False): return say("busy")
    try:
        limit = read_budget()
        if limit: return say(limit)
        t0 = time.monotonic(); r = None
        try: r = fetch(url.strip()); code = "ok"
        except ReadError as e: code = e.code
        except Exception as e: code = "site_error"; log(f"read: unexpected {type(e).__name__}")
        log(f"read {_host_of(r['finalUrl'] if r else url.strip())} {code} {r.get('bytes', 0) if r else 0} B {(time.monotonic() - t0) * 1000:.0f} ms")
        return (200, r) if r else say(code)
    finally: _read_slots.release()

# ---------- the door ----------
MAX_BODY = 4000   # bytes in a request body
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
        got = self.headers.get("Authorization", "")
        if not hmac.compare_digest(got.encode(), f"Bearer {KEY}".encode()):
            time.sleep(0.5); self._send(401, dict(error="key missing or wrong")); return False
        # Only requests with the key count, so strangers knocking cannot lock the owner out.
        if too_fast(): self._send(429, dict(error="too many requests")); return False
        return True
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.send_header("Content-Length", "0"); self.end_headers()
    def do_GET(self):
        if not self._allowed(): return
        if self.path == "/status": return self._send(200, M.status())
        self._send(404, dict(error="unknown"))
    def do_POST(self):
        if not self._allowed(): return
        # No Content-Length: no body. One that is not a plain number or is over the limit, or any Transfer-Encoding
        # (its body would never be read): refused before anything is read.
        cl = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding") is not None or cl is not None and (not re.fullmatch(r"[0-9]{1,6}", cl.strip()) or int(cl) > MAX_BODY):
            return self._send(400, dict(error="bad request"))
        n = int(cl or 0); raw = self.rfile.read(n) if n else b""
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
        if self.path == "/read":
            code, body = read_request(raw); return self._send(code, body)
        self._send(404, dict(error="unknown"))

if __name__ == "__main__":
    colab("stop", "-s", SESSION, timeout=120)   # a machine left over from a crash would keep costing
    threading.Thread(target=M.watch, daemon=True).start()
    log(f"listening on 127.0.0.1:{PORT}; quiet {IDLE_MIN:g} min after the last line ({WARM_MIN:g} min after ready while none was served), session {MAX_SESSION_MIN:g} min, day {DAILY_MIN:g} min")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
