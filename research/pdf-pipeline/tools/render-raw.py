# render-raw.py OUTDIR SIZE id:pdf:pages ...  -> OUTDIR/<id>-p<page>-<SIZE>.rgb (uint8 RGB, SIZExSIZE, stretched) + meta json
import sys, os, json, pypdfium2 as pdfium
out, size = sys.argv[1], int(sys.argv[2]); os.makedirs(out, exist_ok=True); meta = {}
for spec in sys.argv[3:]:
    did, f, pages = spec.split('|')
    pdf = pdfium.PdfDocument(f)
    for p in [int(x) for x in pages.split(',')]:
        pg = pdf[p-1]; w, h = pg.get_width(), pg.get_height()
        im = pg.render(scale=max(size/w, size/h) * 1.0).to_pil().convert('RGB').resize((size, size))
        open(os.path.join(out, f'{did}-p{p}-{size}.rgb'), 'wb').write(im.tobytes())
        meta[f'{did}-p{p}'] = {'w': w, 'h': h}
json.dump(meta, open(os.path.join(out, f'meta-{size}.json'), 'w'))
print('rendered', len(meta))
