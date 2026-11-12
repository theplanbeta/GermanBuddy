# montage.py OUT.png W file1.pdf:page file2.pdf:page ...  (renders and tiles pages, each scaled to width W)
import sys, pypdfium2 as pdfium
from PIL import Image
out, W = sys.argv[1], int(sys.argv[2]); ims = []
for spec in sys.argv[3:]:
    f, p = spec.rsplit(':', 1); d = pdfium.PdfDocument(f); pg = d[int(p)-1]
    im = pg.render(scale=W / pg.get_width()).to_pil(); ims.append(im)
cols = min(4, len(ims)); rows = (len(ims)+cols-1)//cols; H = max(i.height for i in ims)
sheet = Image.new('RGB', (cols*W + (cols-1)*6, rows*H + (rows-1)*6), 'gray')
for k, im in enumerate(ims): sheet.paste(im, ((k%cols)*(W+6), (k//cols)*(H+6)))
sheet.save(out); print(sheet.size)
