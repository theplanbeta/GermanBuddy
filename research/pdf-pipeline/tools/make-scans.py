# make-scans.py: rasterise text PDF pages into image-only "scanned" PDFs (grey, noise, skew, JPEG),
# keeping the source text layer as the OCR reference. Also extracts OmniDocBench scanned pages.
import sys, os, json, random, io, pypdfium2 as pdfium
from PIL import Image, ImageFilter
random.seed(5)
OUT = sys.argv[1]
def scan(src, page, name, dpi=200, skew=0.6, noise=10, jpeg=60):
    pdf = pdfium.PdfDocument(src); pg = pdf[page-1]
    im = pg.render(scale=dpi/72).to_pil().convert('L')
    if skew: im = im.rotate(skew, resample=Image.BICUBIC, expand=False, fillcolor=255)
    px = im.load(); w, h = im.size
    for _ in range(int(w*h*0.002)):
        x, y = random.randrange(w), random.randrange(h); px[x, y] = random.choice([0, 90, 255])
    im = im.filter(ImageFilter.GaussianBlur(0.5)).point(lambda v: max(0, min(255, v + random.randint(-noise, noise))))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=jpeg); im = Image.open(buf)
    im.save(os.path.join(OUT, name + '.pdf'), 'PDF', resolution=dpi)
    im.save(os.path.join(OUT, name + '.png'))
    return {'src': src, 'page': page, 'dpi': dpi, 'skew': skew}
meta = {}
C = 'corpus/synth/'
meta['scan-book-p4'] = scan(C + 'syn-book.pdf', 4, 'scan-book-p4')
meta['scan-report-p1'] = scan(C + 'syn-report-word.pdf', 1, 'scan-report-p1', dpi=150, skew=1.2, noise=18, jpeg=45)
meta['scan-paper2col-p1'] = scan(C + 'syn-paper-2col.pdf', 1, 'scan-paper2col-p1', dpi=200, skew=0.4)
meta['scan-legal-p2'] = scan(C + 'syn-legal.pdf', 2, 'scan-legal-p2', dpi=300, skew=0.0, noise=6, jpeg=80)
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print('ok', list(meta))
