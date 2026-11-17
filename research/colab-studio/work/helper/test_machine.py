"""Tests for starting and stopping the machine in helper.py. Run: python3 test_machine.py   (stdlib only)

The real `colab` tool is never run: `colab`, `on_machine` and the kept-open connection are replaced by stand-ins
that write down every call and can be held at a step until the test lets them go. The tests then check the exact
list of calls, so "one machine at a time" and "a stop during a start leaves nothing running" are checked as calls.
"""
import os, sys, json, time, shutil, tempfile, threading, unittest

TMP = tempfile.mkdtemp(prefix="hs-machine-test-")
os.environ["HS_DIR"] = TMP; os.environ["HS_COLAB"] = "/nonexistent/colab"   # set before the import; never run anyway
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helper as H

def until(cond, s=3.0):
    end = time.time() + s
    while time.time() < end:
        if cond(): return True
        time.sleep(0.005)
    raise AssertionError("condition not met in time")

class Tool:
    """Stands in for Google's tool. calls: the list of steps, in order. hold[name]: an Event the step waits for."""
    def __init__(self):
        self.calls = []; self.hold = {}; self.lock = threading.Lock(); self.running_new = 0; self.most_new_at_once = 0
        self.answers = dict(new=(True, "made"), upload=(True, "ok"), stop=(True, "stopped"), cell=(True, "STARTED"))
        self.waits = []     # answers for the wait loop, in order; then HSREADY
    def _do(self, name):
        with self.lock: self.calls.append(name)
        ev = self.hold.get(name)
        if ev: assert ev.wait(5), f"{name} was held too long"
    def colab(self, *args, code=None, timeout=120):
        name = args[0]
        if name == "new":
            with self.lock: self.running_new += 1; self.most_new_at_once = max(self.most_new_at_once, self.running_new)
            try: self._do("new")
            finally:
                with self.lock: self.running_new -= 1
        else: self._do(name)
        return self.answers.get(name, (True, ""))
    def on_machine(self, code, timeout=90):
        if "STARTED" in code: self._do("cell"); return self.answers["cell"]
        self._do("wait"); return (True, self.waits.pop(0) if self.waits else "HSREADY")
    def conn_open(self): self._do("open"); return True
    def conn_close(self):
        with self.lock: self.calls.append("close")

class Base(unittest.TestCase):
    def setUp(self):
        self.t = Tool(); H.colab = self.t.colab; H.on_machine = self.t.on_machine
        for f in (H.LEDGER, H.LOG):
            if os.path.exists(f): os.remove(f)
        self.m = H.Machine(); self.m.conn.open = self.t.conn_open; self.m.conn.close = self.t.conn_close
    def tearDown(self):
        for ev in self.t.hold.values(): ev.set()
        until(lambda: self.m.state in ("idle", "ready"))
    def held(self, name): ev = self.t.hold[name] = threading.Event(); return ev
    def calls(self): return [c for c in self.t.calls if c != "close"]        # the tool's own calls (closing the connection is local)
    def logged(self):
        with open(H.LOG) as f: return f.read()
    def ledger(self):
        with open(H.LEDGER) as f: return json.load(f)

class NormalStarts(Base):
    def test_start_to_ready_then_stop(self):
        self.t.waits = ["HSWAIT"]
        self.assertEqual(self.m.start(), "starting"); until(lambda: self.m.state == "ready")
        self.assertEqual(self.calls(), ["new", "upload", "cell", "wait", "wait", "open"])
        self.assertEqual(self.ledger()["starts"], 1); self.assertIn("ready after", self.logged())
        self.m.started = time.time() - 120                                   # it ran two minutes
        self.m.stop(); self.assertEqual(self.m.state, "idle")
        self.assertEqual(self.calls(), ["new", "upload", "cell", "wait", "wait", "open", "stop"])
        self.assertAlmostEqual(self.ledger()["minutes"], 2.0, delta=0.05); self.assertIn("stopped (asked), 2.0 min", self.logged())
    def test_failed_new(self):
        self.t.answers["new"] = (False, "no GPU quota")
        self.m.start(); until(lambda: self.m.state == "idle" and "stop" in self.t.calls)
        self.assertEqual(self.calls(), ["new", "stop"])                       # a failed `new` may still have made one: stopped anyway
        self.assertEqual(self.m.error, "new: no GPU quota"); self.assertIn("start failed: new: no GPU quota", self.logged())
        self.assertIn("stopped (start failed)", self.logged())
    def test_stop_retried_once_when_the_tool_fails(self):
        self.m.start(); until(lambda: self.m.state == "ready")
        self.t.answers["stop"] = (False, "timeout"); self.m.stop()
        self.assertEqual(self.calls()[-2:], ["stop", "stop"])
        self.t.answers["stop"] = (False, "[colab] Session 'hearshot' not found."); self.m.start(); until(lambda: self.m.state == "ready"); self.m.stop()
        self.assertEqual(self.calls()[-2:], ["open", "stop"])                   # "not found": once is enough

class StopDuringStart(Base):
    def test_stop_while_new_runs(self):
        go = self.held("new"); self.m.start(); until(lambda: "new" in self.t.calls)
        self.m.started = time.time() - 60
        self.m.stop()
        self.assertEqual(self.m.state, "stopping"); self.assertEqual(self.calls(), ["new"])   # nothing to stop yet: the tool does not know it
        self.assertEqual(self.m.status()["state"], "stopping")
        go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "stop"])                       # stopped right after `new`, no upload
        self.assertIn("stopped (asked during the start, while making the machine), 1.0 min", self.logged())
        self.assertIsNone(self.m.error); self.assertAlmostEqual(self.ledger()["minutes"], 1.0, delta=0.05)
        self.assertNotIn("starts", {k for k, v in self.ledger().items() if v})
    def test_stop_while_uploading(self):
        go = self.held("upload"); self.m.start(); until(lambda: "upload" in self.t.calls)
        self.m.stop(); go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "upload", "stop"])
        self.assertIn("while uploading the cell", self.logged())
    def test_stop_while_starting_the_cell(self):
        go = self.held("cell"); self.m.start(); until(lambda: "cell" in self.t.calls)
        self.m.stop(); go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "upload", "cell", "stop"])
    def test_stop_in_the_wait_loop(self):
        self.t.waits = ["HSWAIT", "HSWAIT", "HSWAIT"]; go = self.held("wait")
        self.m.start(); until(lambda: "wait" in self.t.calls)
        self.m.stop(); self.assertEqual(self.m.state, "stopping"); go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "upload", "cell", "wait", "stop"])   # no second wait, no connection
        self.assertIn("while waiting for the cell", self.logged())
    def test_stop_while_the_connection_opens(self):
        go = self.held("open"); self.m.start(); until(lambda: "open" in self.t.calls)
        self.m.stop(); go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "upload", "cell", "wait", "open", "stop"])
        self.assertIn("close", self.t.calls[self.t.calls.index("open"):]); self.assertEqual(self.m.ready_at, 0.0)
        self.assertIn("while opening the connection", self.logged())
    def test_stop_and_a_failing_step_together(self):
        self.t.answers["upload"] = (False, "upload broke"); go = self.held("upload")
        self.m.start(); until(lambda: "upload" in self.t.calls); self.m.stop(); go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "upload", "stop"]); self.assertIsNone(self.m.error)   # it was stopped, not a failure

class StopThenStart(Base):
    def test_start_while_an_old_start_is_still_in_new(self):
        go = self.held("new"); self.assertEqual(self.m.start(), "starting"); until(lambda: "new" in self.t.calls)
        self.m.stop()
        for _ in range(3): self.assertEqual(self.m.start(), "stopping")      # refused while the old one winds down
        self.m.stop()                                                          # a second stop changes nothing
        self.assertEqual(self.calls(), ["new"])
        del self.t.hold["new"]; go.set(); until(lambda: self.m.state == "idle")
        self.assertEqual(self.calls(), ["new", "stop"])
        self.assertEqual(self.m.start(), "starting"); until(lambda: self.m.state == "ready")   # now a fresh one
        self.assertEqual(self.calls(), ["new", "stop", "new", "upload", "cell", "wait", "open"])
        self.assertEqual(self.t.most_new_at_once, 1)
        time.sleep(0.05); self.assertEqual(self.m.state, "ready"); self.assertEqual(self.calls()[-1], "open")   # the old run left the new machine alone
    def test_the_old_start_cannot_stop_the_new_machine(self):
        """The old run ends completely (machine stopped, "idle") before a new start is accepted, so no stop of its can come later."""
        go = self.held("wait"); self.t.waits = ["HSWAIT"]
        self.m.start(); until(lambda: "wait" in self.t.calls); self.m.stop()
        self.assertEqual(self.m.start(), "stopping"); del self.t.hold["wait"]; go.set(); until(lambda: self.m.state == "idle")
        n = len(self.calls()); self.m.start(); until(lambda: self.m.state == "ready")
        self.assertNotIn("stop", self.calls()[n:]); self.assertEqual(self.calls().count("new"), 2); self.assertEqual(self.t.most_new_at_once, 1)

class Watch(Base):
    def ready(self):
        self.m.start(); until(lambda: self.m.state == "ready"); return len(self.calls())
    def test_quiet_after_ready(self):
        n = self.ready(); self.m.ready_at = time.time() - (H.WARM_MIN * 60 + 1); self.m.check()
        self.assertEqual(self.calls()[n:], ["stop"]); self.assertEqual(self.m.state, "idle")
        self.assertIn(f"stopped (quiet for {H.WARM_MIN:g} min (no line served since ready))", self.logged())
    def test_quiet_after_a_line(self):
        n = self.ready(); self.m.lines = 1; self.m.last_work = time.time() - (H.IDLE_MIN * 60 - 30); self.m.check()
        self.assertEqual(self.calls()[n:], []); self.m.last_work = time.time() - (H.IDLE_MIN * 60 + 1); self.m.check()
        self.assertEqual(self.calls()[n:], ["stop"]); self.assertIn("after the last line", self.logged())
    def test_session_limit(self):
        n = self.ready(); self.m.started = time.time() - (H.MAX_SESSION_MIN * 60 + 1); self.m.last_work = time.time(); self.m.check()
        self.assertEqual(self.calls()[n:], ["stop"]); self.assertIn("session limit", self.logged())
    def test_daily_limit(self):
        n = self.ready(); self.m.last_work = time.time(); H.ledger_add(minutes=H.DAILY_MIN); self.m.check()
        self.assertEqual(self.calls()[n:], ["stop"]); self.assertIn("stopped (daily limit)", self.logged())
        self.assertEqual(self.m.start(), "refused")
    def test_check_leaves_a_start_alone(self):
        go = self.held("new"); self.m.start(); until(lambda: "new" in self.t.calls)
        self.m.started = time.time() - (H.MAX_SESSION_MIN * 60 + 1); self.m.check(); self.assertEqual(self.calls(), ["new"])
        del self.t.hold["new"]; go.set(); until(lambda: self.m.state == "ready")

if __name__ == "__main__":
    try: unittest.main(verbosity=1)
    finally: shutil.rmtree(TMP, ignore_errors=True)
