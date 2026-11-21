// Reads printed sheet music (a PDF page or a photo) into notes, without AI or a server.
//
// It looks at the page the way a person does:
//   1. find the staffs (groups of five long, evenly spaced lines) and how far apart the lines are
//   2. rub out the staff lines, so notes, stems and rests stand on their own
//   3. noteheads are the solid ovals (hollow ones are filled in first and remembered as hollow);
//      the height of each on the staff gives its pitch
//   4. the length comes from the head (hollow or solid), the stem, beams or flags at the stem's
//      end, and a dot after the head
//   5. bar lines, rests, the key signature and sharps/flats/naturals in front of notes are
//      recognised from their size and shape
//
// Works best on clean music made by notation software (PDF exports, or good straight scans).
// Handwriting, tilted photos, chords, ties, slurs and repeats are not understood.
// All sizes are measured in staff spaces (`d` = distance between two staff lines).

import { buildSong } from './import.js';
import { loadPdfJs, PDF_FONTS_URL } from './pictures.js';

const TARGET_SPACE = 20; // pixels between staff lines when reading
const LETTERS = 'CDEFGAB';
const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = 'FCGDAEB';
const FLAT_ORDER = 'BEADGCF';

/* ---------------- Getting pixels ---------------- */

function grayOf(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    // Transparent counts as white paper.
    const a = px[j + 3] / 255;
    gray[i] = Math.round((0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) * a + 255 * (1 - a));
  }
  return { w, h, gray };
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// Pages of a PDF or a picture, each as a function that draws it at a given scale.
async function pageSources(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: PDF_FONTS_URL }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const text = await page.getTextContent().catch(() => ({ items: [] }));
      pages.push({
        width: base.width,
        async draw(scale) {
          const vp = page.getViewport({ scale });
          const c = newCanvas(vp.width, vp.height);
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'white' }).promise;
          return c;
        },
        // Text on the page (title, tempo) in page units with y going down.
        text: text.items
          .filter((t) => t.str && t.str.trim())
          .map((t) => {
            const [x, y] = base.convertToViewportPoint(t.transform[4], t.transform[5]);
            return { str: t.str.trim(), x, y, size: Math.hypot(t.transform[2], t.transform[3]) };
          }),
      });
    }
    return { pages, close: () => pdf.destroy() };
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("This picture can't be opened in this browser. Try a JPG or PNG photo.");
  const angle = skewAngle(bitmap);
  return {
    pages: [
      {
        width: bitmap.width,
        async draw(scale) {
          const c = newCanvas(bitmap.width * scale, bitmap.height * scale);
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          // Turn a slightly tilted photo straight, so the staff lines are level.
          ctx.translate(c.width / 2, c.height / 2);
          ctx.rotate(-angle);
          ctx.translate(-c.width / 2, -c.height / 2);
          ctx.drawImage(bitmap, 0, 0, c.width, c.height);
          return c;
        },
        text: [],
      },
    ],
    close: () => bitmap.close?.(),
  };
}

// How much a picture is tilted (radians, up to ±5°): the angle at which its dark pixels line up
// into the sharpest rows, which is when the staff lines are level.
function skewAngle(bitmap) {
  const scale = Math.min(1, 900 / bitmap.width);
  const c = newCanvas(bitmap.width * scale, bitmap.height * scale);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  const pix = grayOf(c);
  const dark = binarize(pix);
  const { w, h } = pix;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark[y * w + x]) pts.push(x, y);
  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const rows = new Float64Array(h + w);
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.round(pts[i + 1] - pts[i] * t + w * 0.1);
      if (r >= 0 && r < rows.length) rows[r]++;
    }
    let s = 0;
    for (let i = 0; i < rows.length; i++) s += rows[i] * rows[i];
    return s;
  };
  let best = 0;
  let bestScore = score(0);
  for (let deg = -5; deg <= 5; deg += 0.25) {
    const s = score(deg);
    if (s > bestScore) (bestScore = s), (best = deg);
  }
  for (let deg = best - 0.25; deg <= best + 0.25; deg += 0.05) {
    const s = score(deg);
    if (s > bestScore) (bestScore = s), (best = deg);
  }
  return Math.abs(best) < 0.05 ? 0 : (best * Math.PI) / 180;
}

/* ---------------- Image helpers ---------------- */

function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return Math.max(90, Math.min(200, t));
}

function binarize({ w, h, gray }) {
  const t = otsu(gray);
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = gray[i] < t ? 1 : 0;
  return dark;
}

// Labels 8-connected dark regions. Returns { labels, comps: [{ x0, y0, x1, y1, n }] } (label = index + 1).
function components(img, w, h) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < img.length; start++) {
    if (!img[start] || labels[start]) continue;
    const id = comps.length + 1;
    const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0, id };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (img[q] && !labels[q]) {
            labels[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/* ---------------- 1. Staffs ---------------- */

function findStaves(dark, w, h) {
  const longest = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    // Longest stretch of ink, jumping gaps of up to 3 pixels (scans and photos break lines up).
    let run = 0;
    let gap = 0;
    let best = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (dark[row + x]) {
        run += 1 + gap;
        gap = 0;
        if (run > best) best = run;
      } else if (++gap > 3) {
        run = 0;
        gap = 0;
      }
    }
    longest[y] = best;
  }
  let maxRun = 0;
  for (let y = 0; y < h; y++) maxRun = Math.max(maxRun, longest[y]);
  // Short staffs (the last line of a piece) count too; five evenly spaced lines are needed anyway.
  const minRun = Math.max(w * 0.06, 40);

  const lines = [];
  for (let y = 0; y < h; y++) {
    if (longest[y] < minRun) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.y1 <= 1) last.y1 = y;
    else lines.push({ y0: y, y1: y });
  }
  lines.forEach((l) => (l.y = (l.y0 + l.y1) / 2));

  const staves = [];
  for (let i = 0; i + 4 < lines.length; ) {
    const group = lines.slice(i, i + 5);
    const gaps = group.slice(1).map((l, k) => l.y - group[k].y);
    const thick = Math.max(...group.map((l) => l.y1 - l.y0 + 1));
    const ok = Math.max(...gaps) <= Math.min(...gaps) * 1.3 && Math.min(...gaps) >= thick * 2.5 && Math.min(...gaps) >= 4;
    if (!ok) {
      i++;
      continue;
    }
    const d = (group[4].y - group[0].y) / 4;
    // Left and right ends of the staff, from the middle line.
    const mid = group[2];
    const yRow = Math.round(mid.y) * w;
    let best = [0, 0];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark[yRow + x]) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start > best[1] - best[0]) best = [start, x - 1];
        start = -1;
      }
    }
    staves.push({ lines: group, d, x0: best[0], x1: best[1], top: group[0].y, bottom: group[4].y });
    i += 5;
  }
  return staves;
}

// Widens each line's band to include grey edge rows, then rubs the lines out where nothing crosses them.
function removeStaffLines(dark, w, staves) {
  const sym = dark.slice();
  for (const s of staves) {
    const span = s.x1 - s.x0 + 1;
    const rowShare = (y) => {
      let n = 0;
      for (let x = s.x0; x <= s.x1; x++) n += dark[y * w + x];
      return n / span;
    };
    for (const l of s.lines) {
      while (rowShare(l.y0 - 1) > 0.5) l.y0--;
      while (rowShare(l.y1 + 1) > 0.5) l.y1++;
      for (let x = Math.max(0, s.x0 - 2); x <= Math.min(w - 1, s.x1 + 2); x++) {
        const above = dark[(l.y0 - 1) * w + x];
        const below = dark[(l.y1 + 1) * w + x];
        if (!above && !below) for (let y = l.y0; y <= l.y1; y++) sym[y * w + x] = 0;
      }
    }
    s.thick = Math.max(...s.lines.map((l) => l.y1 - l.y0 + 1));
  }
  return sym;
}

// Fills small enclosed white areas (the inside of hollow noteheads). Returns { filled, hole }.
// Holes are found before the staff lines are rubbed out: a hollow note between two lines has its
// thin top and bottom edges on the lines, and would otherwise leak.
function fillHoles(dark, sym, w, h, maxArea, staves) {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p) => {
    if (!dark[p] && !outside[p]) {
      outside[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  const holeImg = new Uint8Array(w * h);
  for (let i = 0; i < holeImg.length; i++) holeImg[i] = !dark[i] && !outside[i] ? 1 : 0;
  // Only small holes count (big enclosed areas are left alone).
  const { labels, comps } = components(holeImg, w, h);
  const hole = new Uint8Array(w * h);
  const filled = sym.slice();
  // A rectangular gap boxed in by two staff lines (e.g. between a bar line and a stem) is not a
  // hollow note: the inside of a note is oval.
  const lines = staves.flatMap((s) => s.lines);
  const onLine = (y) => lines.some((l) => y >= l.y0 - 1 && y <= l.y1 + 1);
  comps.forEach((c) => (c.pocket = onLine(c.y0 - 1) && onLine(c.y1 + 1) && c.n / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) > 0.85));
  for (let i = 0; i < holeImg.length; i++) {
    if (!holeImg[i]) continue;
    const c = comps[labels[i] - 1];
    if (c.n <= maxArea && !c.pocket) {
      hole[i] = 1;
      filled[i] = 1;
    }
  }
  // A staff line through a hollow note splits its hole in two: fill the rubbed-out line there too.
  for (let i = w * 4; i < sym.length - w * 4; i++) {
    if (!dark[i] || sym[i]) continue;
    let above = false;
    let below = false;
    for (let k = 1; k <= 4; k++) {
      above ||= !!hole[i - k * w];
      below ||= !!hole[i + k * w];
    }
    if (above && below) filled[i] = hole[i] = 1;
  }
  return { filled, hole };
}

/* ---------------- 2. Noteheads ---------------- */

// Pixels where a solid box of size (2rx+1) x (2ry+1) fits inside dark ink.
function erode(img, w, h, rx, ry) {
  const W = w + 1;
  const sum = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += img[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  const area = Math.floor((2 * rx + 1) * (2 * ry + 1) * 0.9); // nearly full: tolerates grey edges and specks
  for (let y = ry; y < h - ry; y++) {
    for (let x = rx; x < w - rx; x++) {
      const x0 = x - rx;
      const y0 = y - ry;
      const x1 = x + rx + 1;
      const y1 = y + ry + 1;
      if (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0] >= area) out[y * w + x] = 1;
    }
  }
  return out;
}

// Longest dark vertical run through (x, y), allowing 1-pixel gaps. Returns { up, down } in pixels.
function verticalRun(img, w, h, x, y) {
  const walk = (step) => {
    let len = 0;
    let gap = 0;
    for (let yy = y + step; yy >= 0 && yy < h; yy += step) {
      if (img[yy * w + x]) {
        len += 1 + gap;
        gap = 0;
      } else if (++gap > 1) break;
    }
    return len;
  };
  return { up: walk(-1), down: walk(1) };
}

// Number of separate dark runs (beams or flags) in column x between rows ya and yb. Gaps shorter
// than minGap don't split a run (a blurry beam can have a thin pale streak through it).
// A run lying on a staff line (a bit of line left behind) doesn't count.
// With `labels` and `label`, only ink belonging to that shape counts.
function runsInColumn(img, w, x, ya, yb, minLen, minGap, lines = [], labels = null, label = 0) {
  let runs = 0;
  let len = 0;
  let gap = 0;
  let start = 0;
  const onLine = (y0, y1) => lines.some((l) => y0 >= l.y0 - 2 && y1 <= l.y1 + 2);
  const finish = (end) => {
    if (len >= minLen && !onLine(start, end)) runs++;
    len = 0;
    gap = 0;
  };
  for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) {
    const p = y * w + x;
    if (img[p] && (!labels || labels[p] === label)) {
      if (!len) start = y;
      if (len && gap) len += gap;
      len++;
      gap = 0;
    } else if (len && ++gap >= minGap) finish(y - gap);
  }
  if (len) finish(Math.max(ya, yb));
  return runs;
}

/* ---------------- Shapes ---------------- */

// Sharp, flat or natural from a component's vertical strokes. Returns 1, -1, 0 or null.
function accidentalShape(sym, w, c, d) {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  if (ch < 1.7 * d || ch > 3.9 * d || cw < 0.3 * d || cw > 1.35 * d) return null;
  const strokes = [];
  for (let x = c.x0; x <= c.x1; x++) {
    // Longest vertical stroke in this column, jumping gaps of up to 2 pixels (blurry scans).
    let best = 0;
    let top = 0;
    let run = 0;
    let gap = 0;
    for (let y = c.y0; y <= c.y1; y++) {
      if (sym[y * w + x]) {
        run += 1 + gap;
        gap = 0;
        if (run > best) {
          best = run;
          top = y - run + 1;
        }
      } else if (++gap > 2) {
        run = 0;
        gap = 0;
      }
    }
    if (best >= 0.5 * ch) {
      const last = strokes[strokes.length - 1];
      if (last && x - last.x1 <= 1) {
        last.x1 = x;
        last.top = Math.min(last.top, top);
      } else strokes.push({ x0: x, x1: x, top });
    }
  }
  if (strokes.length === 1 && strokes[0].x0 - c.x0 < 0.35 * cw) return -1;
  if (strokes.length === 2) {
    const offset = strokes[1].top - strokes[0].top; // natural: left stroke starts much higher
    return offset > 0.45 * d ? 0 : 1;
  }
  return null;
}

/* ---------------- Reading one page ---------------- */

function readPage({ w, h, gray }, texts = []) {
  const dark = binarize({ w, h, gray });
  const staves = findStaves(dark, w, h);
  if (!staves.length) return { staves: [] };
  const d = staves.reduce((a, s) => a + s.d, 0) / staves.length;
  const sym = removeStaffLines(dark, w, staves);
  const { filled, hole } = fillHoles(dark, sym, w, h, Math.round(0.8 * d * d), staves);
  const { labels, comps } = components(sym, w, h);
  const compAt = (x, y) => comps[labels[y * w + x] - 1];

  // Noteheads: where a box about 2/3 of a space wide and 3/5 of a space tall fits in the ink.
  const rx = Math.max(2, Math.round(0.3 * d));
  const ry = Math.max(2, Math.round(0.27 * d));
  const core = erode(filled, w, h, rx, ry);
  const cores = components(core, w, h).comps.filter((c) => c.x1 - c.x0 <= 1.5 * d && c.y1 - c.y0 <= 0.95 * d);
  // How far ink reaches from (x, y) going in direction (dx, dy).
  const reach = (x, y, dx, dy, limit) => {
    let k = 0;
    while (k < limit) {
      const xx = x + dx * (k + 1);
      const yy = y + dy * (k + 1);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !filled[yy * w + xx]) break;
      k++;
    }
    return k;
  };
  const mid3 = (a) => [...a].sort((p, q) => p - q)[1];
  const heads = [];
  for (const c of cores) {
    const cx0 = Math.round((c.x0 + c.x1) / 2);
    const cy0 = Math.round((c.y0 + c.y1) / 2);
    // A tilted head can give two cores: skip one that lies inside a head already measured.
    if (heads.some((n) => n.headLike && cx0 >= n.x0 && cx0 <= n.x1 && cy0 >= n.y0 && cy0 <= n.y1)) continue;
    // Measure the real outline on three rows and three columns, taking the middle value, so a
    // ledger line or stem through one of them doesn't stretch the head.
    const off = Math.round(0.25 * d);
    const lim = Math.round(1.2 * d);
    const left = mid3([-off, 0, off].map((o) => reach(cx0, cy0 + o, -1, 0, lim)));
    const right = mid3([-off, 0, off].map((o) => reach(cx0, cy0 + o, 1, 0, lim)));
    const up = mid3([-off, 0, off].map((o) => reach(cx0 + o, cy0, 0, -1, lim)));
    const down = mid3([-off, 0, off].map((o) => reach(cx0 + o, cy0, 0, 1, lim)));
    const x0 = cx0 - left;
    const x1 = cx0 + right;
    const y0 = cy0 - up;
    const y1 = cy0 + down;
    let holes = 0;
    let area = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) (area++, (holes += hole[y * w + x]));
    // Rectangles (whole and half rests) fill their box completely; noteheads are rounded.
    let ink = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink += filled[y * w + x];
    const boxFill = ink / ((y1 - y0 + 1) * (x1 - x0 + 1));
    const headLike = y1 - y0 + 1 >= 0.7 * d && y1 - y0 + 1 <= 1.5 * d && x1 - x0 + 1 >= 0.8 * d && x1 - x0 + 1 <= 2.2 * d;
    heads.push({ x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, width: x1 - x0 + 1, height: y1 - y0 + 1, hollow: holes / area > 0.2, boxFill, headLike });
  }

  const typical = median(heads.filter((n) => n.headLike && n.width <= 1.6 * d).map((n) => n.width)) || 1.25 * d;
  const holdsHead = (c) => heads.some((n) => n.headLike && n.width >= 0.8 * typical && n.cx >= c.x0 && n.cx <= c.x1 && n.cy >= c.y0 && n.cy <= c.y1);

  // Each staff's header: clef, then key signature (sharps or flats right after it).
  for (const s of staves) {
    s.d = d;
    const inBand = (c) => c.y1 > s.top - 0.5 * d && c.y0 < s.bottom + 0.5 * d;
    const nearby = comps.filter((c) => inBand(c) && c.x1 >= s.x0 - d && c.x0 <= s.x1 + d).sort((a, b) => a.x0 - b.x0);
    s.comps = nearby;
    const clef = nearby.find((c) => c.y1 - c.y0 > 5 * d && c.x0 < s.x0 + 4 * d);
    let end = clef ? clef.x1 : s.x0;
    s.keyAcc = [];
    if (clef) {
      for (const c of nearby) {
        if (c.x0 <= clef.x1) continue;
        if (c.y1 - c.y0 < 0.8 * d) continue; // specks broken off by rubbing out the staff lines
        if (c.x0 - end > 1.6 * d) break;
        const acc = accidentalShape(sym, w, c, d);
        if (acc !== 1 && acc !== -1) break;
        if (holdsHead(c) || (s.keyAcc.length && acc !== s.keyAcc[0])) break; // a note, not a sharp or flat
        s.keyAcc.push(acc);
        end = c.x1;
        c.used = 'key';
      }
    }
    if (clef) clef.used = 'clef';
    // Time signature right after: two numbers stacked in the top and bottom halves of the staff,
    // or a single C sign across the middle.
    const mid = s.lines[2].y;
    const near = nearby.filter((c) => !c.used && c.x0 > end && c.x0 < end + 2.5 * d);
    for (const a of near) {
      const b = near.find((o) => o !== a && o.y0 > a.y1 - 0.3 * d && Math.min(o.x1, a.x1) - Math.max(o.x0, a.x0) > 0.3 * d);
      const digit = (c) => c.y1 - c.y0 > 1.4 * d && c.y1 - c.y0 < 2.5 * d && !holdsHead(c);
      if (b && a.y1 <= mid + 0.4 * d && b.y0 >= mid - 0.4 * d && digit(a) && digit(b)) {
        a.used = b.used = 'time';
        end = Math.max(end, a.x1, b.x1);
        break;
      }
      const ah = a.y1 - a.y0;
      if (ah > 1.6 * d && ah < 2.6 * d && a.y0 < mid && a.y1 > mid && a.x1 - a.x0 > 1.1 * d && !holdsHead(a)) {
        a.used = 'time';
        end = Math.max(end, a.x1);
        break;
      }
    }
    s.headerEnd = end;
  }

  // Notes more than half a space outside the staff sit on or next to short ledger lines.
  // Checks the ledger line nearest the staff, which every such note has.
  const ledgersOk = (n, s) => {
    let y;
    if (n.cy < s.top - 0.75 * d) y = s.top - d;
    else if (n.cy > s.bottom + 0.75 * d) y = s.bottom + d;
    else return true;
    const xa = Math.round(n.x0 - 0.15 * d);
    const xb = Math.round(n.x1 + 0.15 * d);
    for (let yy = Math.round(y - 0.25 * d); yy <= Math.round(y + 0.25 * d); yy++) {
      if (yy < 0 || yy >= h) continue;
      let ink = 0;
      for (let x = xa; x <= xb; x++) ink += dark[yy * w + x] || 0;
      if (ink >= 0.9 * (xb - xa + 1)) return true;
    }
    return false;
  };

  // Keep noteheads of normal size that belong to a staff and sit after its header.
  const notes = [];
  const reject = () => {}; // (why a candidate isn't a note; handy to log when tuning)
  for (const n of heads) {
    const s = staves.reduce((best, st) => (Math.abs(n.cy - (st.top + st.bottom) / 2) < Math.abs(n.cy - (best.top + best.bottom) / 2) ? st : best));
    if (n.cy < s.top - 5.5 * d || n.cy > s.bottom + 5.5 * d) continue;
    if (n.x0 <= s.headerEnd || n.x1 > s.x1 + d) continue;
    if (n.width < 0.72 * typical || n.width > (n.hollow ? 1.6 : 1.35) * typical) {
      reject(n, `width ${n.width} typical ${typical}`);
      continue;
    }
    if (n.height < 0.7 * d || n.height > 1.5 * d) {
      reject(n, `height ${n.height}`);
      continue;
    } // beams are thinner than noteheads
    if (texts.some((t) => /=/.test(t.str) && t.x > n.x0 && t.x < n.x1 + 3 * d && Math.abs(t.y - n.cy) < 2.5 * d)) {
      reject(n, 'tempo mark');
      continue;
    } // the little note in "♩ = 100"
    if (!ledgersOk(n, s)) {
      reject(n, 'no ledger line');
      continue;
    } // e.g. the little note in a tempo mark "♩ = 100" above the staff
    if (n.boxFill > 0.93) {
      reject(n, `boxFill ${n.boxFill.toFixed(2)}`);
      continue;
    } // a solid rectangle: a rest, handled below
    // Stem: a long thin line from the left or right edge of the head.
    const cy = Math.round(n.cy);
    let stem = null;
    for (const [x, dir] of [
      ...range(Math.round(n.x1) - 3, Math.round(n.x1) + 2).map((x) => [x, -1]),
      ...range(Math.round(n.x0) - 2, Math.round(n.x0) + 3).map((x) => [x, 1]),
    ]) {
      if (x < 0 || x >= w) continue;
      const run = verticalRun(sym, w, h, x, cy);
      const len = dir < 0 ? run.up : run.down;
      if (len >= 2.4 * d && (!stem || len > stem.len)) stem = { x, dir, len, tip: cy + dir * len };
    }
    if (!stem && !n.hollow) {
      reject(n, 'no stem');
      continue;
    } // a solid blob without a stem isn't a note
    if (!stem && n.width < 1.05 * typical) {
      reject(n, 'hollow, no stem, narrow');
      continue;
    } // whole notes are wider than other heads
    n.staff = s;
    n.stem = stem;
    n.comp = compAt(Math.round(n.cx), cy) || null;
    notes.push(n);
  }

  // A flag or beam end can pass for a head; its "stem" then runs into a real note's head.
  const onHead = (x, y, self) => notes.some((m) => m !== self && x >= m.x0 - 0.3 * d && x <= m.x1 + 0.3 * d && y >= m.y0 - 0.3 * d && y <= m.y1 + 0.3 * d);
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.stem && onHead(n.stem.x, n.stem.tip, n)) {
      reject(n, 'stem ends on another note');
      notes.splice(i, 1);
    }
  }

  // Chords: noteheads on the same stem. Keep the top one (usually the tune).
  notes.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const kept = [];
  let chords = 0;
  for (const n of notes) {
    const twin = kept.find((k) => k.staff === n.staff && Math.abs(k.cx - n.cx) < 0.6 * d && ((k.stem && n.stem && Math.abs(k.stem.x - n.stem.x) <= 2) || (!k.stem && !n.stem)));
    if (twin) {
      chords++;
      if (n.cy < twin.cy) Object.assign(twin, n);
      continue;
    }
    kept.push(n);
  }
  kept.forEach((n) => n.comp && (n.comp.used = 'note'));

  // Length of each note.
  const minRun = Math.max(2, Math.round(0.2 * d));
  for (const n of kept) {
    if (!n.stem) {
      n.beats = 4;
    } else if (n.hollow) {
      n.beats = 2;
    } else {
      const { x, dir, tip } = n.stem;
      // Only ink joined to this stem counts: a slur starting near the stem's end is a separate
      // curve, not a flag or beam.
      const stemLabel = labels[Math.round((n.cy + tip) / 2) * w + x];
      let beams = 0;
      for (const side of [-1, 1]) {
        for (const off of [0.35, 0.5, 0.65]) {
          const cx = x + side * Math.round(off * d);
          if (cx < 0 || cx >= w) continue;
          const ya = Math.round(tip + dir * 0.6 * d); // a little past the tip, as beams slope
          const yb = Math.round(tip - dir * 2.2 * d);
          if (Math.min(ya, yb) < 0 || Math.max(ya, yb) >= h) continue;
          beams = Math.max(beams, runsInColumn(sym, w, cx, ya, yb, minRun, Math.max(2, Math.round(0.12 * d)), n.staff.lines, stemLabel ? labels : null, stemLabel));
        }
      }
      n.beats = 1 / 2 ** Math.min(3, beams);
    }
  }

  // Bar lines, dots, accidentals and rests, from the remaining shapes.
  const events = [];
  let unreadAcc = 0;
  for (const s of staves) {
    const sNotes = kept.filter((n) => n.staff === s);
    const free = s.comps.filter((c) => !c.used);

    // Bar lines: columns inked from the top line to the bottom line that stop there. (Stems never
    // cover the whole staff; a bar line always does.) Works even when specks touch the line.
    const top = Math.round(s.top);
    const bottom = Math.round(s.bottom);
    const inkFrom = (x, y0, y1) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) n += sym[y * w + x];
      return n / (y1 - y0 + 1);
    };
    let run = null;
    const bars = [];
    for (let x = Math.ceil(s.headerEnd) + 1; x <= Math.min(w - 1, s.x1 + 2); x++) {
      const full = inkFrom(x, top, bottom) >= 0.92;
      if (full) run ? (run.x1 = x) : (run = { x0: x, x1: x });
      if ((!full || x === s.x1 + 2) && run) {
        bars.push(run);
        run = null;
      }
    }
    const stemXs = sNotes.filter((n) => n.stem).map((n) => n.stem.x);
    for (const b of bars) {
      if (b.x1 - b.x0 + 1 > 1.0 * d) continue;
      if (stemXs.some((x) => x >= b.x0 - 0.3 * d && x <= b.x1 + 0.3 * d)) continue; // a note's stem
      // The ink must stop at the top and bottom lines (a stem carries on to its head or beam).
      const past = [b.x0, Math.round((b.x0 + b.x1) / 2), b.x1].some((x) => {
        const run = verticalRun(sym, w, h, x, top);
        const runDown = verticalRun(sym, w, h, x, bottom);
        return run.up > 0.3 * d || runDown.down > 0.3 * d;
      });
      if (past) continue;
      events.push({ staff: s, x: b.x0, kind: 'bar' });
      free.forEach((c) => {
        if (!c.used && c.x0 >= b.x0 - 2 && c.x1 <= b.x1 + 2) c.used = 'bar';
      });
    }

    for (const n of sNotes) {
      // Sharp, flat or natural just in front of the note.
      const acc = free.find((c) => !c.used && c.x1 < n.x0 + 0.2 * d && c.x1 > n.x0 - 1.8 * d && c.y0 < n.cy && c.y1 > n.cy);
      if (acc) {
        const shape = accidentalShape(sym, w, acc, d);
        if (shape !== null) {
          n.acc = shape;
          acc.used = 'acc';
        } else if (acc.y1 - acc.y0 > 1.7 * d && acc.x1 - acc.x0 < 1.2 * d) {
          unreadAcc++;
        }
      }
      // Dot after the note makes it half as long again.
      const after = n.stem && n.stem.dir < 0 ? Math.max(n.x1, n.stem.x) : n.x1;
      const dot = free.find((c) => !c.used && isDot(c, d) && c.x0 > after && c.x0 < after + 1.5 * d && Math.abs((c.y0 + c.y1) / 2 - n.cy) < 0.8 * d);
      if (dot) {
        n.beats *= 1.5;
        dot.used = 'dot';
      }
      events.push({ staff: s, x: n.cx, kind: 'note', note: n });
    }

    // Rests.
    for (const c of free) {
      if (c.used || c.x0 <= s.headerEnd) continue;
      const cw = c.x1 - c.x0 + 1;
      const ch = c.y1 - c.y0 + 1;
      const cyc = (c.y0 + c.y1) / 2;
      if (cyc < s.top - 0.5 * d || cyc > s.bottom + 0.5 * d) continue;
      let beats = null;
      const fill = c.n / (cw * ch);
      if (fill > 0.75 && cw >= 0.7 * d && cw <= 1.9 * d && ch >= 0.25 * d && ch <= 0.8 * d) {
        if (Math.abs(c.y0 - s.lines[1].y) < 0.4 * d) beats = 'bar';
        else if (Math.abs(c.y1 - s.lines[2].y) < 0.4 * d) beats = 2;
      } else if (cw >= 0.45 * d && cw <= 1.35 * d && accidentalShape(sym, w, c, d) === null) {
        if (ch >= 2.1 * d && ch <= 3.6 * d) beats = 1;
        else if (ch >= 1.2 * d && ch < 2.1 * d) beats = 0.5;
      }
      if (beats === null) continue;
      c.used = 'rest';
      const dot = free.find((o) => !o.used && isDot(o, d) && o.x0 > c.x1 && o.x0 < c.x1 + 1.2 * d && o.y1 < c.y1 && o.y0 > c.y0 - d);
      if (dot && beats !== 'bar') {
        beats *= 1.5;
        dot.used = 'dot';
      }
      events.push({ staff: s, x: (c.x0 + c.x1) / 2, kind: 'rest', beats });
    }
  }
  return { staves, events, chords, unreadAcc, d };
}

function isDot(c, d) {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  // Big enough not to be a speck of dust, and round.
  return cw >= 0.25 * d && cw <= 0.7 * d && ch >= 0.25 * d && ch <= 0.7 * d && cw / ch > 0.6 && cw / ch < 1.6 && c.n / (cw * ch) > 0.6;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/* ---------------- Notes into bars ---------------- */

function pitchOf(note, keyAcc, barAcc) {
  const s = note.staff;
  const step = Math.round((s.lines[4].y - note.cy) / (s.d / 2)); // 0 = bottom line (E4)
  const diatonic = 2 + step + 7 * 4; // E4 counted from C0
  const letter = LETTERS[((diatonic % 7) + 7) % 7];
  const octave = Math.floor(diatonic / 7);
  const slot = `${letter}${octave}`;
  if (note.acc !== undefined) barAcc.set(slot, note.acc);
  const alter = barAcc.has(slot) ? barAcc.get(slot) : keyAcc.get(letter) || 0;
  return (octave + 1) * 12 + LETTER_SEMIS[LETTERS.indexOf(letter)] + alter;
}

function toBars(pagesRead) {
  const staves = pagesRead.flatMap((p) => p.staves);
  const first = staves.find((s) => s.keyAcc.length) || staves[0];
  const fifths = first.keyAcc.length ? first.keyAcc[0] * first.keyAcc.length : 0;
  const keyAcc = new Map();
  const order = fifths > 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(fifths); i++) keyAcc.set(order[i], Math.sign(fifths));

  const bars = [];
  let bar = [];
  let barAcc = new Map();
  const close = () => {
    if (bar.length) bars.push(bar);
    bar = [];
    barAcc = new Map();
  };
  for (const page of pagesRead) {
    for (const s of page.staves) {
      const ev = page.events.filter((e) => e.staff === s).sort((a, b) => a.x - b.x);
      for (const e of ev) {
        if (e.kind === 'bar') close();
        else if (e.kind === 'rest') bar.push({ midi: null, beats: e.beats });
        else bar.push({ midi: pitchOf(e.note, keyAcc, barAcc), beats: e.note.beats });
      }
      close(); // a new line always starts a new bar
    }
  }

  // Beats in a bar: the most common total of the full bars (first and last can be short).
  const totals = bars.map((b) => b.reduce((a, n) => a + (n.beats === 'bar' ? 0 : n.beats), 0));
  const middle = totals.length > 2 ? totals.slice(1, -1) : totals;
  const counts = new Map();
  middle.filter((t) => t > 0).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  let beatsPerBar = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 4;
  bars.forEach((b) => b.forEach((n) => n.beats === 'bar' && (n.beats = beatsPerBar)));
  const off = bars.filter((b, i) => i > 0 && i < bars.length - 1 && Math.abs(b.reduce((a, n) => a + n.beats, 0) - beatsPerBar) > 1e-6).length;
  return { bars, fifths, beatsPerBar, off };
}

/* ---------------- Title and tempo from a PDF's text ---------------- */

function titleAndTempo(page, scale, firstStaffTop) {
  const above = page.text.filter((t) => t.y * scale < firstStaffTop);
  const title = above.filter((t) => /[a-z]{2}/i.test(t.str)).sort((a, b) => b.size - a.size)[0];
  let tempo = null;
  for (const t of above) {
    const m = t.str.replace(/[=\s♩𝅘𝅥]/gu, '').match(/^(\d{2,3})$/);
    if (m && +m[1] >= 30 && +m[1] <= 240) {
      tempo = +m[1];
      break;
    }
  }
  return { title: title && title.size >= 12 ? title.str : null, tempo };
}

/* ---------------- Public ---------------- */

// Reads a PDF or picture of sheet music. Returns { song, warnings } like importScoreFile,
// or throws an Error whose message can be shown to the user.
export async function readSheetMusic(file, fallbackTitle) {
  const src = await pageSources(file);
  try {
    const read = [];
    let title = null;
    let tempo = null;
    for (const [i, page] of src.pages.entries()) {
      // First look at a moderate size to measure the staff, then read at a size where staff lines
      // are about TARGET_SPACE pixels apart.
      let scale = Math.min(4, 1600 / page.width);
      let pix = grayOf(await page.draw(scale));
      let staves = findStaves(binarize(pix), pix.w, pix.h);
      if (staves.length) {
        const d = median(staves.map((s) => s.d));
        const better = Math.min(scale * (TARGET_SPACE / d), 6000 / page.width);
        if (Math.abs(better - scale) / scale > 0.15) {
          scale = better;
          pix = grayOf(await page.draw(scale));
        }
      }
      const texts = page.text.map((t) => ({ str: t.str, x: t.x * scale, y: t.y * scale }));
      const result = readPage(pix, texts);
      if (!result.staves.length) continue;
      read.push(result);
      if (i === 0 && page.text.length) ({ title, tempo } = titleAndTempo(page, scale, result.staves[0].top));
    }
    if (!read.length) {
      throw new Error("I couldn't find any music staffs (the five lines) on this page. Make sure the page is straight, sharp and well lit.");
    }
    const { bars, fifths, beatsPerBar, off } = toBars(read);
    const noteCount = bars.flat().filter((n) => n.midi != null).length;
    if (noteCount < 2) throw new Error("I found the staff lines but couldn't make out the notes on them.");

    const notes = ['These notes were read from a picture, so compare them with the sheet before saving: press ▶ Listen and fix anything that looks wrong.'];
    if (off) notes.push(`${off} bar(s) don't add up to ${beatsPerBar} beats, so something in them may be misread.`);
    const chords = read.reduce((a, r) => a + r.chords, 0);
    if (chords) notes.push(`${chords} chord note(s) were left out: only the top note of each chord is kept.`);
    const unread = read.reduce((a, r) => a + r.unreadAcc, 0);
    if (unread) notes.push(`${unread} sharp/flat/natural sign(s) couldn't be read. Check the notes next to them.`);
    if (!tempo) notes.push('No speed was found on the sheet, so it is set to 90. Change it if you need to.');
    notes.push('Ties, slurs and repeat signs are not read: tied notes show as separate notes.');
    return buildSong({ title: title || fallbackTitle, fifths, beatsPerBar, tempo: tempo || 90, bars, notes });
  } finally {
    src.close();
  }
}

