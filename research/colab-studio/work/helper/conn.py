"""One kept-open connection to the Colab machine, for the helper.

`colab exec` opens a new connection for every call (about 4 s, and now and then it times out).
This small program opens the connection once and then runs whatever code the helper sends,
one JSON line in, one line out. It must run with the Colab tool's own Python:
    ~/.local/share/uv/tools/google-colab-cli/bin/python conn.py <session name>
in:  {"code": "...", "timeout": 90}
out: HSCONN {"ok": true, "out": "<what the code printed>"}
"""
import sys, json

from colab_cli.common import state
from colab_cli.runtime import ColabRuntime

def say(d): print("HSCONN " + json.dumps(d), flush=True)

s = state.get_session(sys.argv[1])
def kernel_started(kid): s.kernel_id = kid; state.store.add(s)
def session_started(sid): s.session_id = sid; state.store.add(s)
rt = ColabRuntime(s.url, s.token, kernel_id=s.kernel_id, session_id=s.session_id,
                  on_kernel_started=kernel_started, on_session_started=session_started)

def text_of(outputs):
    parts = []
    for o in outputs:
        if o.get("output_type") == "stream":
            t = o.get("text", ""); parts.append("".join(t) if isinstance(t, list) else t)
        elif o.get("output_type") == "error":
            parts.append(f"HSERROR {o.get('ename')}: {o.get('evalue')}")
    return "".join(parts)

try:
    rt.execute_code("import os; os.makedirs('/content', exist_ok=True); os.chdir('/content')", timeout=60)
    say({"ok": True, "out": "connected"})
except Exception as e:
    say({"ok": False, "out": repr(e)[:300]}); sys.exit(1)

for line in sys.stdin:
    try:
        req = json.loads(line)
        say({"ok": True, "out": text_of(rt.execute_code(req["code"], timeout=req.get("timeout", 90)))})
    except Exception as e:
        say({"ok": False, "out": repr(e)[:300]})
