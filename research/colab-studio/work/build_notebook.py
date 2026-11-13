"""Wraps studio_cell.py into hearshot_studio.ipynb: one cell, code folded away behind a title,
with the two Kokoro-made voice samples (out/refs/*.wav) carried inside as text.
The notebook is generated (and git-ignored, it holds 1 MB of audio text): python3 build_notebook.py"""
import json, ast, base64, os
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(f"{HERE}/studio_cell.py").read()
refs = {v: base64.b64encode(open(f"{HERE}/out/refs/{v}.wav", "rb").read()).decode() for v in ("af_aoede", "am_fenrir")}
marker = "REFS = {}  # voice samples"
assert marker in src
line = next(l for l in src.splitlines() if l.startswith(marker))
src = src.replace(line, "REFS = " + json.dumps(refs))
src = "#@title Hearshot Studio: tap Run, approve Drive, then switch back to Hearshot\n" + src
ast.parse(src)
nb = dict(nbformat=4, nbformat_minor=0,
          metadata=dict(accelerator="GPU", colab=dict(name="Hearshot Studio", gpuType="T4", provenance=[]), kernelspec=dict(name="python3", display_name="Python 3")),
          cells=[dict(cell_type="code", execution_count=None, metadata=dict(cellView="form"), outputs=[], source=src.splitlines(keepends=True))])
json.dump(nb, open(f"{HERE}/hearshot_studio.ipynb", "w"), indent=1)
print("hearshot_studio.ipynb", round(os.path.getsize(f"{HERE}/hearshot_studio.ipynb") / 1e6, 2), "MB")
