# Step 2 of the sheet-reading tests (see README.md): pip install verovio
# Renders every out/<id>.musicxml with Verovio (MuseScore-like engraving) to out/<id>.verovio.svg
import glob, os, verovio

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
tk = verovio.toolkit()
tk.setOptions({'pageWidth': 2159, 'pageHeight': 2794, 'scale': 40, 'adjustPageHeight': False, 'breaks': 'auto'})
for f in sorted(glob.glob(os.path.join(here, '*.musicxml'))):
    tk.loadFile(f)
    svg = tk.renderToSVG(1)
    out = f.replace('.musicxml', '.verovio.svg')
    open(out, 'w').write(svg)
    print(os.path.basename(out), tk.getPageCount(), 'page(s)')
