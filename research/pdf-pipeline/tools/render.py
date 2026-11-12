# render.py PDF PAGES(1-based, comma) OUTDIR [scale]  -> PNGs via pypdfium2
import sys, os, pypdfium2 as pdfium
pdf = pdfium.PdfDocument(sys.argv[1]); out = sys.argv[3]; os.makedirs(out, exist_ok=True)
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
pages = range(1, len(pdf)+1) if sys.argv[2] == 'all' else [int(x) for x in sys.argv[2].split(',')]
base = os.path.basename(sys.argv[1]).rsplit('.', 1)[0]
for p in pages:
    img = pdf[p-1].render(scale=scale).to_pil()
    img.save(os.path.join(out, f"{base}-p{p}.png"))
print('ok', len(pdf))
