"""Makes the no-Drive copy of the studio cell that the helper runs on the Colab machine.
It is studio_cell.py as built into hearshot_studio.ipynb (voice samples included), with a plain
folder on the machine instead of Drive, no self-test, and no self-release (the helper stops the
machine). Run `python3 build_notebook.py` first, then `python3 helper/make_helper_cell.py`.
Writes helper/studio_helper.py (git-ignored: it carries the voice samples as text)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
src = "".join(json.load(open(f"{HERE}/../hearshot_studio.ipynb"))["cells"][0]["source"])
for a, b in [('drive.mount("/content/drive")', 'pass  # helper run: a plain folder on the machine, no Drive'),
             ('D = "/content/drive/MyDrive/Hearshot Studio"', 'D = "/content/studio"'),
             ('SELF_TEST = True', 'SELF_TEST = False'),
             ('drive.flush_and_unmount()\n        from google.colab import runtime; runtime.unassign()', 'print("IDLE END"); break'),
             ('    time.sleep(2)\n', '    time.sleep(0.15)\n')]:  # look for new lines more often than the Drive version
    assert a in src, a
    src = src.replace(a, b)
open(f"{HERE}/studio_helper.py", "w").write(src)
print("helper/studio_helper.py", len(src))
