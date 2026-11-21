// Sheet music pictures: photos and PDFs of printed music, kept on this device in IndexedDB
// (they're too big for localStorage) and shown page by page. PDFs are drawn with pdf.js
// (vendor/pdfjs), which is only loaded the first time a PDF is opened.

import { titleFromFileName } from './import.js';

const DB_NAME = 'violinPractice.sheets';
const STORE = 'sheets';
const MAX_BYTES = 30 * 1024 * 1024;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser cannot store files.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full.'));
  });
}

// Titles and dates only (no file data), oldest first.
export async function listPictures() {
  const all = await tx('readonly', (s) => s.getAll());
  return all.map(({ id, title, type, added }) => ({ id, title, type, added })).sort((a, b) => a.added - b.added);
}

export async function getPicture(id) {
  return tx('readonly', (s) => s.get(id));
}

export async function addPicture(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is bigger than 30 MB. Try a smaller photo or PDF.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const sheet = {
    id: `sheet-${Date.now().toString(36)}`,
    title: titleFromFileName(file.name),
    type: isPdf ? 'pdf' : 'image',
    blob: file,
    added: Date.now(),
  };
  await tx('readwrite', (s) => s.put(sheet));
  return { id: sheet.id, title: sheet.title, type: sheet.type, added: sheet.added };
}

export async function renamePicture(id, title) {
  const sheet = await getPicture(id);
  if (!sheet) return;
  sheet.title = title.trim().slice(0, 60) || sheet.title;
  await tx('readwrite', (s) => s.put(sheet));
}

export async function deletePicture(id) {
  await tx('readwrite', (s) => s.delete(id));
}

/* ---------------- Showing a sheet ---------------- */

const PDFJS_BASE = new URL('../vendor/pdfjs/', import.meta.url);
export const PDF_FONTS_URL = new URL('standard_fonts/', PDFJS_BASE).href;
let pdfjs = null;
export async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import(new URL('pdf.min.mjs', PDFJS_BASE).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDFJS_BASE).href;
  }
  return pdfjs;
}

// Shows `sheet` (from getPicture) in `container`, one page under another, as wide as the
// container times `zoom`. Returns { pages, redraw(zoom), destroy() }.
export async function showPicture(container, sheet) {
  container.innerHTML = '';
  let url = null;
  let pdf = null;
  let zoom = 1;
  const pages = [];

  if (sheet.type === 'pdf') {
    const lib = await loadPdfJs();
    pdf = await lib.getDocument({ data: new Uint8Array(await sheet.blob.arrayBuffer()), standardFontDataUrl: PDF_FONTS_URL }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = document.createElement('canvas');
      canvas.className = 'picture-page';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${sheet.title}, page ${i} of ${pdf.numPages}`);
      container.append(canvas);
      pages.push({ canvas, page: await pdf.getPage(i), task: null });
    }
  } else {
    url = URL.createObjectURL(sheet.blob);
    const img = document.createElement('img');
    img.className = 'picture-page';
    img.alt = sheet.title;
    img.src = url;
    container.append(img);
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = () => {
        container.innerHTML = '<p class="card">⚠️ This browser can\'t show this picture. Try a JPG or PNG photo instead.</p>';
        resolve();
      };
    });
  }

  async function redraw(newZoom = zoom) {
    zoom = newZoom;
    container.style.setProperty('--zoom', zoom);
    if (!pdf) return;
    const width = (container.clientWidth || 700) * zoom;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    for (const p of pages) {
      p.task?.cancel();
      const base = p.page.getViewport({ scale: 1 });
      const scale = (width / base.width) * ratio;
      const viewport = p.page.getViewport({ scale });
      p.canvas.width = Math.floor(viewport.width);
      p.canvas.height = Math.floor(viewport.height);
      p.task = p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport, background: 'white' });
      try {
        await p.task.promise;
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') throw e;
      }
    }
  }
  await redraw(1);

  return {
    pages: pdf ? pdf.numPages : 1,
    redraw,
    destroy() {
      pages.forEach((p) => p.task?.cancel());
      pdf?.destroy();
      if (url) URL.revokeObjectURL(url);
      container.innerHTML = '';
    },
  };
}
