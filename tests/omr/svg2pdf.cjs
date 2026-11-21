// Step 3 of the sheet-reading tests (see README.md): prints out/*.verovio.svg to vector PDFs.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('path').join(__dirname, 'out');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.verovio.svg'))) {
    const svg = fs.readFileSync(OUT + '/' + f, 'utf8');
    await p.setContent(`<html><body style="margin:0;background:#fff"><div style="width:8.5in">${svg.replace('<svg', '<svg style="width:100%;height:auto"')}</div></body></html>`);
    await p.pdf({ path: OUT + '/' + f.replace('.svg', '.pdf'), format: 'Letter', printBackground: true });
  }
  await b.close();
})();
