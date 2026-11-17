"""Tests for POST /read in helper.py. Run: python3 test_read.py   (stdlib only, no network)

A web server on 127.0.0.1 stands in for the far sites. fetch_page() lets 127.0.0.1 through only when
a test passes allow_loopback=True; the HTTP door never passes it, and the last tests prove that the
door refuses the very same addresses. DNS answers are injected with `resolve`, so no lookup leaves
this machine either.
"""
import os, sys, json, time, socket, shutil, tempfile, threading, subprocess, unittest, http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TMP = tempfile.mkdtemp(prefix="hs-read-test-")
os.environ["HS_DIR"] = TMP; os.environ["HS_ORIGIN"] = "https://app.example"   # set before the import: no real key file is read
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helper as H
from helper import fetch_page, check_url, public_ip, read_request, ReadError

SEEN = []   # the requests the far site got: (method, path, headers)
class Far(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self, code, headers=(), body=b""):
        self.send_response(code)
        for k, v in headers: self.send_header(k, v)
        self.end_headers()
        if body: self.wfile.write(body)
    def do_POST(self): SEEN.append(("POST", self.path, dict(self.headers))); self._go(405)
    def do_GET(self):
        SEEN.append(("GET", self.path, dict(self.headers))); p = self.path; port = self.server.server_address[1]
        if p == "/ok": return self._go(200, [("Content-Type", "text/html; charset=utf-8")], "<html><body><p>héllo</p></body></html>".encode())
        if p == "/latin1": return self._go(200, [("Content-Type", "text/html; charset=iso-8859-1")], b"<p>caf\xe9</p>")
        if p == "/meta": return self._go(200, [("Content-Type", "text/html")], b'<html><head><meta charset="windows-1252"></head><body><p>na\xefve \x93quoted\x94</p></body></html>')
        if p == "/nocharset": return self._go(200, [("Content-Type", "text/html")], "<p>Straße</p>".encode() + b"\xff")
        if p == "/text": return self._go(200, [("Content-Type", "text/plain")], b"plain words")
        if p == "/redir-ok": return self._go(301, [("Location", "/ok"), ("Set-Cookie", "s=secret")])
        if p.startswith("/hops/"):
            n = int(p.split("/")[2]); return self._go(302, [("Location", f"/hops/{n - 1}" if n > 0 else "/ok")])
        if p == "/redir-metadata": return self._go(302, [("Location", "http://169.254.169.254/latest/meta-data/")])
        if p == "/redir-localhost": return self._go(302, [("Location", "http://localhost/ok")])
        if p == "/redir-tailnet": return self._go(302, [("Location", "http://100.101.102.103/status")])
        if p == "/redir-mapped": return self._go(302, [("Location", "http://[::ffff:7f00:1]/ok")])
        if p == "/redir-decimal": return self._go(302, [("Location", "http://2130706433/ok")])
        if p == "/redir-ftp": return self._go(302, [("Location", "ftp://example.com/file")])
        if p == "/redir-file": return self._go(302, [("Location", "file:///etc/passwd")])
        if p == "/redir-port": return self._go(302, [("Location", f"http://127.0.0.2:{port}/ok")])
        if p == "/redir-empty": return self._go(302)
        if p == "/loop": return self._go(302, [("Location", "/loop")])
        if p == "/big-cl": return self._go(200, [("Content-Type", "text/html"), ("Content-Length", str(3 * 1024 * 1024))], b"<p>")
        if p == "/big":
            self._go(200, [("Content-Type", "text/html")]); chunk = b"a" * 65536
            try:
                for _ in range(48): self.wfile.write(chunk)   # 3 MB, no Content-Length
            except OSError: pass
            return
        if p == "/slow":
            self._go(200, [("Content-Type", "text/html")])
            try:
                for _ in range(100): self.wfile.write(b"x"); self.wfile.flush(); time.sleep(0.1)
            except OSError: pass
            return
        if p == "/slow-head":
            try:
                self.wfile.write(b"HTTP/1.0 200 OK\r\n"); self.wfile.flush()
                for i in range(100): self.wfile.write(f"X-Drip-{i}: 1\r\n".encode()); self.wfile.flush(); time.sleep(0.1)
            except OSError: pass
            return
        if p.startswith("/chunked-"):
            self.protocol_version = "HTTP/1.1"; size = {"/chunked-big": 3 * 1024 * 1024, "/chunked-ok": 1536 * 1024}[p]
            self._go(200, [("Content-Type", "text/html; charset=utf-8"), ("Transfer-Encoding", "chunked")])
            try:
                sent = 0
                while sent < size:
                    piece = b"<p>" + b"a" * 65530 + b"</p>"; piece = piece[:size - sent]; sent += len(piece)
                    self.wfile.write(b"%x\r\n" % len(piece) + piece + b"\r\n")
                self.wfile.write(b"0\r\n\r\n")
            except OSError: pass
            return
        if p == "/punycode": return self._go(200, [("Content-Type", "text/html; charset=punycode")], b"<p>" + b"abcdefghij" * 100_000 + b"</p>")
        if p == "/meta-idna": return self._go(200, [("Content-Type", "text/html")], b'<meta charset="idna"><p>' + b"abcdefghij" * 100_000 + b"</p>")
        if p == "/pdf": return self._go(200, [("Content-Type", "application/pdf"), ("Content-Length", str(50 * 1024 * 1024))], b"%PDF")
        if p == "/bin": return self._go(200, [("Content-Type", "image/png")], b"\x89PNG")
        if p == "/notype": return self._go(200, [], b"<p>x</p>")
        if p == "/gzip": return self._go(200, [("Content-Type", "text/html"), ("Content-Encoding", "gzip")], b"\x1f\x8b")
        for code in (401, 402, 403, 404, 410, 429, 451, 500, 503):
            if p == f"/{code}": return self._go(code, [("Content-Type", "text/html")], b"no")
        self._go(404)

def serve(handler):
    s = ThreadingHTTPServer(("127.0.0.1", 0), handler); s.daemon_threads = True
    threading.Thread(target=s.serve_forever, daemon=True).start(); return s

FAR = serve(Far); PORT = FAR.server_address[1]; B = f"http://127.0.0.1:{PORT}"
def T(path, **kw): return fetch_page(B + path, allow_loopback=True, **kw)
def code_of(fn, *a, **kw):
    try: fn(*a, **kw)
    except ReadError as e: return e.code
    return None
def read_text(path):
    with open(path) as f: return f.read()
def read_json(path): return json.loads(read_text(path))
def write_json(path, d):
    with open(path, "w") as f: json.dump(d, f)
NO_DNS = lambda h, p: (_ for _ in ()).throw(AssertionError(f"a lookup happened for {h}"))

class Addresses(unittest.TestCase):
    def test_not_public(self):
        for ip in ["127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
                   "100.64.0.1", "100.100.100.100", "100.127.255.255", "0.0.0.0", "255.255.255.255", "224.0.0.1", "240.0.0.1",
                   "192.0.2.1", "198.18.0.1", "::", "::1", "fe80::1", "fe80::1%en0", "fd00::1", "fd7a:115c:a1e0::1", "ff02::1",
                   "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:100.64.0.1", "::ffff:6440:1",
                   "::127.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1",
                   "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "not-an-ip", "2130706433", "0x7f.0.0.1", ""]:
            self.assertFalse(public_ip(ip), ip)
    def test_public(self):
        for ip in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001::1",
                   "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]:
            self.assertTrue(public_ip(ip), ip)

class Urls(unittest.TestCase):
    def test_refused(self):
        table = {"bad_url": ["ftp://a.com/", "file:///etc/passwd", "javascript:alert(1)", "http://user:pw@example.com/", "http://@example.com/",
                             "http://example.com:8080/", "https://example.com:8443/", "http://exa mple.com/", "http://example.com\\@evil.com/",
                             "http://example.com/\r\nX: 1", "", "x" * 3000, None, 42, "//example.com/", "http://[::1/", "https://ex*ample.com/"],
                 "blocked_address": ["http://localhost/", "http://LOCALHOST./", "http://a.localhost/", "http://printer.local/", "http://foo.internal/",
                             "http://intranet/", "http://2130706433/", "http://0x7f000001/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/",
                             "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://100.64.0.1/", "http://100.100.100.100/",
                             "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/",
                             "http://[fe80::1%25en0]/", "http://[64:ff9b::7f00:1]/", "http://[2002:7f00:1::]/", "https://myhelper.tail1234.ts.net/status",
                             "http://10.0.0.1/", "http://192.168.0.1/"]}
        for code, urls in table.items():
            for u in urls: self.assertEqual(code_of(check_url, u), code, u)
    def test_accepted(self):
        t = check_url("https://Example.COM./a%20b/ü?q=1&x=é#frag")                    # the app percent-encodes spaces; raw spaces are refused
        self.assertEqual((t["host"], t["port"], t["scheme"]), ("example.com", 443, "https"))
        self.assertEqual(t["path"], "/a%20b/%C3%BC?q=1&x=%C3%A9"); self.assertEqual(t["url"], "https://example.com/a%20b/%C3%BC?q=1&x=%C3%A9")
        self.assertEqual(check_url("http://example.com:80/")["hosthdr"], "example.com")
        self.assertEqual(check_url("http://example.com:443/")["hosthdr"], "example.com:443")
        self.assertEqual(check_url("https://bücher.example/")["host"], "xn--bcher-kva.example")
        self.assertEqual(check_url("http://[2606:4700:4700::1111]/")["hosthdr"], "[2606:4700:4700::1111]")
        self.assertEqual(check_url("http://8.8.8.8/")["host"], "8.8.8.8")
    def test_test_switch_is_narrow(self):
        self.assertEqual(code_of(check_url, B + "/ok"), "bad_url")                         # without the switch: refused
        self.assertEqual(code_of(check_url, "http://127.0.0.1/ok"), "blocked_address")
        self.assertEqual(check_url(B + "/ok", loopback=True)["host"], "127.0.0.1")
        for u in (f"http://127.0.0.2:{PORT}/", f"http://localhost:{PORT}/", f"http://[::1]:{PORT}/", "http://169.254.169.254/"):
            self.assertIn(code_of(check_url, u, loopback=True), ("bad_url", "blocked_address"), u)
        self.assertEqual(code_of(check_url, B + "/ok", loopback="yes"), "bad_url")          # only the value True switches it

class Dns(unittest.TestCase):
    def test_rebinding_name_to_private(self):
        self.assertEqual(code_of(fetch_page, "http://rebind.example.com/", resolve=lambda h, p: ["10.0.0.5"]), "blocked_address")
    def test_mixed_public_and_private(self):
        for bad in ("127.0.0.1", "169.254.169.254", "100.100.100.100", "::ffff:7f00:1", "::1", "fd7a:115c:a1e0::5"):
            self.assertEqual(code_of(fetch_page, "http://mixed.example.com/", resolve=lambda h, p, b=bad: ["93.184.216.34", "2606:4700::1", b]), "blocked_address", bad)
    def test_name_to_loopback_refused_even_with_switch(self):
        self.assertEqual(code_of(fetch_page, f"http://pinned.example.com/ok", resolve=lambda h, p: ["127.0.0.1"], allow_loopback=True), "blocked_address")
    def test_no_answer(self):
        self.assertEqual(code_of(fetch_page, "http://nx.example.com/", resolve=lambda h, p: []), "unreachable")
        def boom(h, p): raise socket.gaierror("nx")
        self.assertEqual(code_of(fetch_page, "http://nx.example.com/", resolve=boom), "unreachable")
    def test_slow_lookup_counts_against_time(self):
        t0 = time.monotonic(); self.assertEqual(code_of(fetch_page, "http://slow.example.com/", resolve=lambda h, p: time.sleep(3) or ["8.8.8.8"], total_s=0.5), "timeout")
        self.assertLess(time.monotonic() - t0, 1.5)
    def test_ip_literal_needs_no_lookup(self):
        self.assertEqual(code_of(fetch_page, "http://[::ffff:a9fe:a9fe]/", resolve=NO_DNS), "blocked_address")
    def test_connects_to_checked_address_with_right_host(self):
        """The name is looked up once; the connection goes to that address (here sent on to the test server), Host stays the name."""
        real = socket.create_connection; asked = []
        def fake_connect(addr, timeout=None, *a, **kw): asked.append(addr); return real(("127.0.0.1", PORT), timeout)
        real_gai = socket.getaddrinfo
        def gai(host, *a, **kw):
            if host == "pin.example.com": raise AssertionError("second lookup by name")
            return real_gai(host, *a, **kw)
        socket.create_connection = fake_connect; socket.getaddrinfo = gai
        try: r = fetch_page("http://pin.example.com/ok", resolve=lambda h, p: ["93.184.216.34"])
        finally: socket.create_connection = real; socket.getaddrinfo = real_gai
        self.assertEqual(asked, [("93.184.216.34", 80)]); self.assertEqual(r["kind"], "html")
        self.assertEqual(SEEN[-1][2].get("Host"), "pin.example.com"); self.assertEqual(r["finalUrl"], "http://pin.example.com/ok")

class Fetch(unittest.TestCase):
    def test_html_utf8_and_headers_sent(self):
        r = T("/ok"); self.assertEqual((r["kind"], r["status"], r["redirects"]), ("html", 200, 0)); self.assertIn("héllo", r["html"])
        self.assertEqual(r["bytes"], len("<html><body><p>héllo</p></body></html>".encode()))
        m, path, h = SEEN[-1]
        self.assertEqual((m, path), ("GET", "/ok")); self.assertEqual(h["User-Agent"], H.READ_UA); self.assertNotIn("http", H.READ_UA.lower().replace("hearshotreader", ""))
        self.assertEqual(h["Accept-Encoding"], "identity"); self.assertNotIn("Cookie", h); self.assertNotIn("Authorization", h); self.assertNotIn("Content-Length", h)
    def test_charsets(self):
        self.assertIn("café", T("/latin1")["html"])
        self.assertIn("naïve “quoted”", T("/meta")["html"])
        h = T("/nocharset")["html"]; self.assertIn("Straße", h); self.assertIn("�", h)
        self.assertEqual((T("/text")["html"], T("/text")["type"]), ("plain words", "text/plain")); self.assertEqual(T("/ok")["type"], "text/html")
    def test_redirects(self):
        r = T("/redir-ok"); self.assertEqual((r["redirects"], r["finalUrl"]), (1, B + "/ok")); self.assertNotIn("Cookie", SEEN[-1][2])
        self.assertEqual(T("/hops/3")["redirects"], 4)                                   # 4 hops: fine
        self.assertEqual(code_of(T, "/hops/4"), "too_many_redirects")                    # 5: refused
        self.assertEqual(code_of(T, "/loop"), "too_many_redirects")
        self.assertEqual(code_of(T, "/redir-empty"), "site_error")
    def test_redirects_to_forbidden_places(self):
        for p, code in [("/redir-metadata", "blocked_address"), ("/redir-localhost", "blocked_address"), ("/redir-tailnet", "blocked_address"),
                        ("/redir-mapped", "blocked_address"), ("/redir-decimal", "blocked_address"), ("/redir-ftp", "bad_url"),
                        ("/redir-file", "bad_url"), ("/redir-port", "bad_url")]:
            n = len(SEEN); self.assertEqual(code_of(T, p), code, p); self.assertEqual(len(SEEN), n + 1, p + ": nothing after the refused hop")
    def test_size_cap(self):
        n = len(SEEN); self.assertEqual(code_of(T, "/big-cl"), "too_large")
        self.assertEqual(code_of(T, "/big"), "too_large")
        self.assertEqual(code_of(T, "/ok", max_bytes=10), "too_large")
    def test_chunked_bodies(self):
        self.assertEqual(code_of(T, "/chunked-big"), "too_large")                          # chunked, 3 MB: cut at 2 MB
        r = T("/chunked-ok"); self.assertEqual((r["kind"], r["bytes"]), ("html", 1536 * 1024)); self.assertEqual(len(r["html"]), 1536 * 1024)
        self.assertTrue(r["html"].startswith("<p>aaa")); self.assertNotIn("\r\n", r["html"])
    def test_hostile_charset_over_the_wire(self):
        for p in ("/punycode", "/meta-idna"):
            t0 = time.monotonic(); r = T(p); self.assertLess(time.monotonic() - t0, 1.0, p)
            letters = "<p>" + "abcdefghij" * 100_000 + "</p>"
            self.assertEqual(r["html"], ('<meta charset="idna">' if "meta" in p else "") + letters, p)   # read as UTF-8, unchanged
    def test_wall_clock(self):
        for p in ("/slow", "/slow-head"):
            t0 = time.monotonic(); self.assertEqual(code_of(T, p, total_s=1.0), "timeout", p); self.assertLess(time.monotonic() - t0, 1.6, p)
    def test_pdf_is_routed_not_downloaded(self):
        self.assertEqual(T("/pdf"), dict(kind="pdf", finalUrl=B + "/pdf"))
    def test_types_refused(self):
        for p in ("/bin", "/notype", "/gzip"): self.assertEqual(code_of(T, p), "unsupported_type", p)
    def test_site_statuses(self):
        for st, code in [(401, "blocked_by_site"), (403, "blocked_by_site"), (451, "blocked_by_site"), (402, "paywall"), (404, "not_found"),
                         (410, "not_found"), (429, "site_rate_limited"), (500, "site_error"), (503, "site_error")]:
            self.assertEqual(code_of(T, f"/{st}"), code, st)
    def test_nothing_listening(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        self.assertEqual(code_of(fetch_page, f"http://127.0.0.1:{port}/", allow_loopback=True), "unreachable")
    @unittest.skipUnless(shutil.which("openssl"), "openssl not installed")
    def test_certificate_is_checked(self):
        import ssl
        d = tempfile.mkdtemp(dir=TMP); crt, key = f"{d}/c.pem", f"{d}/k.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=pin.example.com",
                        "-keyout", key, "-out", crt], capture_output=True, check=True)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Far); ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(crt, key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True); threading.Thread(target=srv.serve_forever, daemon=True).start()
        real = socket.create_connection
        socket.create_connection = lambda addr, timeout=None, *a, **kw: real(("127.0.0.1", srv.server_address[1]), timeout)
        try: self.assertEqual(code_of(fetch_page, "https://pin.example.com/ok", resolve=lambda h, p: ["93.184.216.34"]), "bad_certificate")
        finally: socket.create_connection = real; srv.shutdown(); srv.server_close()

class Decode(unittest.TestCase):
    BODY = b"<p>" + b"abcdefghij" * 100_000 + b"</p>"                                       # about 1 MB of letters
    def test_dangerous_or_unknown_names_decode_as_utf8_fast(self):
        for cs in ("punycode", "idna", "rot13", "rot_13", "hex", "hex_codec", "zlib", "base64", "bz2", "uu", "quopri", "utf-7", "unicode_escape",
                   "raw_unicode_escape", "mbcs", "no-such-charset", "x" * 200, "", "utf-8:evil", "../utf-8"):
            for ctype, body in ((f"text/html; charset={cs}", self.BODY), ("text/html", b'<meta charset="' + cs.encode() + b'">' + self.BODY)):
                t0 = time.monotonic(); text = H.decode_page(bytearray(body), ctype); took = time.monotonic() - t0
                self.assertLess(took, 0.3, (cs, took)); self.assertEqual(text, body.decode("utf-8"), cs)
    def test_web_encodings_still_decode(self):
        jp = "日本語のテキストです。"; ru = "Привет, мир"; de = "Grüße aus Köln"
        cases = [("shift_jis", jp.encode("shift_jis"), jp), ("Shift_JIS", jp.encode("shift_jis"), jp), ("sjis", jp.encode("shift_jis"), jp),
                 ("euc-jp", jp.encode("euc_jp"), jp), ("iso-2022-jp", jp.encode("iso2022_jp"), jp), ("windows-1251", ru.encode("cp1251"), ru),
                 ("cp1251", ru.encode("cp1251"), ru), ("koi8-r", ru.encode("koi8_r"), ru), ("utf-16", de.encode("utf-16"), de),
                 ("utf-16le", de.encode("utf-16-le"), de), ("iso-8859-15", de.encode("iso8859-15"), de), ("gb18030", "中文".encode("gb18030"), "中文"),
                 ("big5", "中文".encode("big5"), "中文"), ("euc-kr", "한국어".encode("euc_kr"), "한국어"), ("macintosh", de.encode("mac_roman"), de)]
        for cs, raw, want in cases: self.assertEqual(H.decode_page(bytearray(raw), f"text/html; charset={cs}"), want, cs)
        self.assertEqual(H.decode_page(bytearray(b"\x93hi\x94"), "text/html; charset=ISO-8859-1"), "\u201chi\u201d")   # latin-1 read as cp1252
        self.assertEqual(H.decode_page(bytearray(b"\x93hi\x94"), "text/html; charset=us-ascii"), "\u201chi\u201d")
        self.assertEqual(H.decode_page(bytearray(b"\xef\xbb\xbfhi"), "text/html; charset=utf-8"), "hi")                  # BOM dropped
        self.assertEqual(H.decode_page(bytearray(b"\xef\xbb\xbfhi"), "text/html"), "hi")
        self.assertEqual(H.decode_page(bytearray(ru.encode("cp1251")), "text/html; charset=\"windows-1251\""), ru)
    def test_every_allowed_name_is_a_text_codec(self):
        import codecs
        for name in H.WEB_CODECS:
            self.assertEqual(codecs.lookup(name).name, name, name); self.assertTrue(codecs.lookup(name)._is_text_encoding, name)
            t0 = time.monotonic(); b"abcdefghij".__mul__(100_000).decode(name, errors="replace"); self.assertLess(time.monotonic() - t0, 0.5, name)

class Budget(unittest.TestCase):
    def setUp(self):
        H.read_hits.clear(); H.READ_PER_MIN, H.READ_DAILY = 12, 300
        if os.path.exists(H.LEDGER): os.remove(H.LEDGER)
    def tearDown(self): self.setUp()
    def test_per_minute(self):
        H.READ_PER_MIN = 3; ok = lambda u: dict(kind="pdf", finalUrl=u)
        self.assertEqual([read_request(b'{"url":"https://example.com/"}', fetch=ok)[0] for _ in range(4)], [200, 200, 200, 429])
        self.assertEqual(read_request(b'{"url":"https://example.com/"}', fetch=ok)[1]["error"], "read_limit")
        H.read_hits[:] = [t - 61 for t in H.read_hits]                                  # a minute later
        self.assertEqual(read_request(b'{"url":"https://example.com/"}', fetch=ok)[0], 200)
    def test_daily_in_ledger(self):
        H.READ_DAILY = 2; ok = lambda u: dict(kind="pdf", finalUrl=u)
        self.assertEqual([read_request(b'{"url":"https://example.com/"}', fetch=ok)[0] for _ in range(3)], [200, 200, 429])
        self.assertEqual(read_json(H.LEDGER)["reads"], 2)
        H.read_hits.clear(); code, body = read_request(b'{"url":"https://example.com/"}', fetch=ok)
        self.assertEqual((code, body["error"]), (429, "daily_limit")); self.assertTrue(body["message"])
        write_json(H.LEDGER, dict(day="2000-01-01", reads=99))                # a new day starts from 0
        self.assertEqual(read_request(b'{"url":"https://example.com/"}', fetch=ok)[0], 200)
    def test_failed_reads_count_too(self):
        H.READ_PER_MIN = 2
        self.assertEqual([read_request(b'{"url":"http://localhost/"}')[0] for _ in range(3)], [400, 400, 429])
    def test_at_most_two_at_once(self):
        go = threading.Event(); inside = threading.Semaphore(0)
        def slow(u): inside.release(); go.wait(5); return dict(kind="pdf", finalUrl=u)
        out = []; ths = [threading.Thread(target=lambda: out.append(read_request(b'{"url":"https://example.com/"}', fetch=slow))) for _ in range(2)]
        for t in ths: t.start()
        inside.acquire(timeout=2); inside.acquire(timeout=2)
        code, body = read_request(b'{"url":"https://example.com/"}', fetch=slow); self.assertEqual((code, body["error"]), (429, "busy"))
        go.set()
        for t in ths: t.join(5)
        self.assertEqual([c for c, _ in out], [200, 200])
        self.assertEqual(read_request(b'{"url":"https://example.com/"}', fetch=slow)[0], 200)   # slots freed
    def test_error_shape_and_log(self):
        code, body = read_request(json.dumps(dict(url=B + "/ok?secret=1")).encode())
        self.assertEqual((code, body["error"]), (400, "bad_url")); self.assertIsInstance(body["message"], str)
        read_request(json.dumps(dict(url="http://169.254.169.254/latest/meta-data/iam?token=abc")).encode())
        logged = read_text(H.LOG); self.assertIn("read 169.254.169.254 blocked_address", logged)
        self.assertNotIn("meta-data", logged); self.assertNotIn("token", logged); self.assertNotIn("secret", logged)

class Door(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.srv = serve(H.H); cls.port = cls.srv.server_address[1]
    @classmethod
    def tearDownClass(cls): cls.srv.shutdown(); cls.srv.server_close()
    def setUp(self): H.read_hits.clear()
    def ask(self, method, path, body=None, key=True, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10); h = dict(headers or {})
        if key: h["Authorization"] = f"Bearer {H.KEY}"
        if body is not None: h["Content-Type"] = "application/json"
        c.request(method, path, body=body, headers=h); r = c.getresponse(); data = r.read(); c.close()
        return r.status, dict(r.getheaders()), (json.loads(data) if data else None)
    def test_key_needed(self):
        st, _, body = self.ask("POST", "/read", b'{"url":"https://example.com/"}', key=False); self.assertEqual(st, 401)
        st, _, _ = self.ask("POST", "/read", b'{"url":"https://example.com/"}', key=False, headers={"Authorization": "Bearer nope"}); self.assertEqual(st, 401)
    def test_preflight(self):
        st, h, _ = self.ask("OPTIONS", "/read", key=False, headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST",
                                                                 "Access-Control-Request-Headers": "authorization, content-type"})
        self.assertEqual(st, 204); self.assertEqual(h.get("Access-Control-Allow-Origin"), "https://app.example")
        self.assertIn("POST", h.get("Access-Control-Allow-Methods", "")); self.assertIn("authorization", h.get("Access-Control-Allow-Headers", ""))
        st, h, _ = self.ask("OPTIONS", "/read", key=False, headers={"Origin": "https://evil.example"}); self.assertNotIn("Access-Control-Allow-Origin", h)
    def test_bad_bodies(self):
        for b in (b"not json", b"{}", b'{"url": 5}', b'{"url": ["https://example.com/"]}', b'{"url": ""}', b"[]"):
            st, h, body = self.ask("POST", "/read", b); self.assertEqual((st, body["error"]), (400, "bad_request"), b); self.assertEqual(h["Cache-Control"], "no-store")
    def test_door_cannot_reach_loopback_or_tailnet(self):
        for u, code in [(B + "/ok", "bad_url"), ("http://127.0.0.1/ok", "blocked_address"), (f"http://localhost:{self.port}/status", "bad_url"),
                        ("http://localhost/status", "blocked_address"), ("http://100.100.100.100/", "blocked_address"), ("http://[::ffff:7f00:1]/", "blocked_address")]:
            n = len(SEEN); st, h, body = self.ask("POST", "/read", json.dumps(dict(url=u)).encode(), headers={"Origin": "https://app.example"})
            self.assertEqual((st, body["error"]), (400, code), u); self.assertEqual(len(SEEN), n, u)
            self.assertEqual(h.get("Access-Control-Allow-Origin"), "https://app.example")
    def raw_ask(self, head, body=b""):
        """Sends a hand-made request without ending the connection; returns (status line, JSON body), or (None, None) after 2 s."""
        c = socket.create_connection(("127.0.0.1", self.port), timeout=2)
        try:
            c.sendall(head.encode() + body); data = b""
            while True:                                   # the helper answers HTTP/1.0 and closes
                chunk = c.recv(65536)
                if not chunk: break
                data += chunk
            top, _, rest = data.partition(b"\r\n\r\n")
            return top.split(b"\r\n")[0].decode(), (json.loads(rest) if rest else None)
        except socket.timeout: return None, None
        finally: c.close()
    def test_content_length_checked_before_reading(self):
        auth = f"Authorization: Bearer {H.KEY}\r\n"; bad = ("HTTP/1.0 400 Bad Request", dict(error="bad request"))
        for cl in ("-1", "-100", "abc", "1e3", "0x10", " ", "4001", "99999999", "²"):
            t0 = time.monotonic(); self.assertEqual(self.raw_ask(f"POST /read HTTP/1.1\r\nHost: x\r\n{auth}Content-Length: {cl}\r\n\r\n"), bad, cl)
            self.assertLess(time.monotonic() - t0, 1.5, cl)
        for te in ("chunked", "gzip, chunked", "identity", ""):                       # any Transfer-Encoding: its body is never read
            t0 = time.monotonic(); head = f"POST /read HTTP/1.1\r\nHost: x\r\n{auth}Transfer-Encoding: {te}\r\n\r\n"
            self.assertEqual(self.raw_ask(head, b"1a\r\n" + b'{"url":"https://a.example/"}'[:26] + b"\r\n"), bad, te); self.assertLess(time.monotonic() - t0, 1.5, te)
        self.assertEqual(self.raw_ask(f"POST /read HTTP/1.1\r\nHost: x\r\n{auth}Content-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n"), bad)
        self.assertEqual(self.raw_ask(f"POST /start HTTP/1.1\r\nHost: x\r\n{auth}Content-Length: -1\r\n\r\n"), bad)
        self.assertEqual(self.raw_ask(f"POST /read HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n")[0], "HTTP/1.0 401 Unauthorized")   # the key first
        # no Content-Length at all: an empty body. /read then fails its JSON check; /start and /stop answer as always.
        st, body = self.raw_ask(f"POST /read HTTP/1.1\r\nHost: x\r\n{auth}\r\n"); self.assertEqual((st, body["error"]), ("HTTP/1.0 400 Bad Request", "bad_request"))
        class FakeMachine:
            calls = []
            def start(self): self.calls.append("start"); return "starting"
            def stop(self, why="asked"): self.calls.append("stop")
            def status(self): return dict(state="starting")
        real, H.M = H.M, FakeMachine()
        try:
            st, body = self.raw_ask(f"POST /start HTTP/1.1\r\nHost: x\r\n{auth}\r\n"); self.assertEqual((st, body), ("HTTP/1.0 200 OK", dict(state="starting", start="starting")))
            st, body = self.raw_ask(f"POST /stop HTTP/1.1\r\nHost: x\r\n{auth}\r\n"); self.assertEqual((st, body), ("HTTP/1.0 200 OK", dict(stop="asked")))
            st, body = self.raw_ask(f"POST /start HTTP/1.1\r\nHost: x\r\n{auth}Content-Length: 0\r\n\r\n"); self.assertEqual(st, "HTTP/1.0 200 OK")
            time.sleep(0.1); self.assertEqual(FakeMachine.calls, ["start", "stop", "start"])
        finally: H.M = real
        st, _, body = self.ask("POST", "/read", b'{"url":"http://localhost/"}'); self.assertEqual((st, body["error"]), (400, "blocked_address"))   # still answering
        st, _, body = self.ask("POST", "/read", b"x" * 4000); self.assertEqual((st, body["error"]), (400, "bad_request"))                       # at the limit: read
    def test_other_endpoints_unchanged(self):
        st, _, body = self.ask("GET", "/read"); self.assertEqual((st, body), (404, dict(error="unknown")))
        st, _, body = self.ask("POST", "/nope", b"{}"); self.assertEqual((st, body), (404, dict(error="unknown")))

if __name__ == "__main__":
    try: unittest.main(verbosity=1)
    finally: FAR.shutdown(); FAR.server_close(); shutil.rmtree(TMP, ignore_errors=True)
