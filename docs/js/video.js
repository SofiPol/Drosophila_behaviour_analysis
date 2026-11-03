/* ============================================================================
 * video.js — video sources (MJPEG AVI demuxed in the browser, or any format the
 * browser can play) and well-grid geometry. Exposed as window.VideoLab
 * ==========================================================================*/
(function (global) {
  'use strict';

  const fourcc = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  const readBytes = async (file, a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
  const u32 = (u, o) => (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0;

  /* ============================ AVI (MJPEG) ============================ */
  async function parseAvi(file) {
    const head = await readBytes(file, 0, 12);
    if (fourcc(head, 0) !== 'RIFF' || fourcc(head, 8) !== 'AVI ') throw new Error('Not an AVI file.');

    // Top-level walk: hdrl, movi lists (one per RIFF segment) and idx1.
    let hdrl = null, idx1 = null;
    const movis = [];
    let riffStart = 0;
    while (riffStart + 12 <= file.size) {
      const rh = await readBytes(file, riffStart, riffStart + 12);
      if (fourcc(rh, 0) !== 'RIFF') break;
      const riffEnd = Math.min(file.size, riffStart + 8 + u32(rh, 4));
      let p = riffStart + 12;
      while (p + 12 <= riffEnd) {
        const h = await readBytes(file, p, p + 12);
        const id = fourcc(h, 0), sz = u32(h, 4);
        if (id === 'LIST') {
          const type = fourcc(h, 8);
          if (type === 'hdrl' && !hdrl) hdrl = { pos: p, size: sz };
          else if (type === 'movi') movis.push({ pos: p, size: sz });
        } else if (id === 'idx1' && !idx1) idx1 = { pos: p, size: sz };
        p += 8 + sz + (sz & 1);
      }
      riffStart = riffEnd + (riffEnd & 1);
    }
    if (!hdrl) throw new Error('AVI header not found.');
    if (!movis.length) throw new Error('No video data found in the AVI.');

    // Header: main header + the first video stream.
    const hb = await readBytes(file, hdrl.pos, hdrl.pos + 8 + hdrl.size);
    let usecPerFrame = 0, width = 0, height = 0, scale = 0, rate = 0, handler = '', compression = '', videoIndex = -1, streamNo = -1;
    const walk = (start, end) => {
      let p = start;
      while (p + 8 <= end) {
        const id = fourcc(hb, p), sz = u32(hb, p + 4);
        if (id === 'LIST') {
          walk(p + 12, Math.min(end, p + 8 + sz));
        } else if (id === 'avih') {
          usecPerFrame = u32(hb, p + 8);
          width = u32(hb, p + 8 + 32);
          height = u32(hb, p + 8 + 36);
        } else if (id === 'strh') {
          streamNo++;
          if (fourcc(hb, p + 8) === 'vids' && videoIndex < 0) {
            videoIndex = streamNo;
            handler = fourcc(hb, p + 12);
            scale = u32(hb, p + 8 + 20);
            rate = u32(hb, p + 8 + 24);
          }
        } else if (id === 'strf' && streamNo === videoIndex && videoIndex >= 0 && !compression) {
          width = u32(hb, p + 12) || width;
          height = Math.abs(u32(hb, p + 16) | 0) || height;
          compression = fourcc(hb, p + 8 + 16);
        }
        p += 8 + sz + (sz & 1);
      }
    };
    walk(12, hb.length);
    if (videoIndex < 0) throw new Error('No video stream found in the AVI.');
    const codec = (compression || handler).trim();
    if (!/mjpg|mjpeg|jpeg|avi1|ijpg/i.test(codec)) {
      throw new Error(`This AVI uses the ${codec || 'unknown'} codec, which cannot be read in the browser. Convert it to MP4 (H.264) or MJPEG AVI.`);
    }
    const fps = scale > 0 && rate > 0 ? rate / scale : (usecPerFrame > 0 ? 1e6 / usecPerFrame : 30);
    const tag = String(videoIndex).padStart(2, '0');
    const isVideoChunk = (id) => id.startsWith(tag) && (id.endsWith('dc') || id.endsWith('db'));

    // Frame table from the index; fall back to scanning the movi lists.
    let frames = [];
    if (idx1 && idx1.size >= 16) {
      const ib = await readBytes(file, idx1.pos + 8, idx1.pos + 8 + idx1.size);
      const entries = [];
      for (let o = 0; o + 16 <= ib.length; o += 16) {
        const id = fourcc(ib, o);
        if (isVideoChunk(id)) entries.push({ id, off: u32(ib, o + 8), size: u32(ib, o + 12) });
      }
      if (entries.length) {
        const bases = [movis[0].pos + 8, 0];
        let base = null;
        for (const b of bases) {
          const test = await readBytes(file, b + entries[0].off, b + entries[0].off + 8);
          if (test.length === 8 && fourcc(test, 0) === entries[0].id) { base = b; break; }
        }
        if (base !== null) frames = entries.map((e) => ({ off: base + e.off + 8, size: e.size }));
      }
    }
    if (!frames.length) {
      for (const m of movis) {
        let p = m.pos + 12;
        const end = Math.min(file.size, m.pos + 8 + m.size);
        while (p + 8 <= end) {
          const h = await readBytes(file, p, p + 12);
          const id = fourcc(h, 0), sz = u32(h, 4);
          if (id === 'LIST') { p += 12; continue; }
          if (isVideoChunk(id)) frames.push({ off: p + 8, size: sz });
          p += 8 + sz + (sz & 1);
        }
      }
    }
    if (!frames.length) throw new Error('No video frames found in the AVI.');
    return { frames, fps, width, height, codec };
  }

  async function openAvi(file) {
    const info = await parseAvi(file);
    const { frames, fps } = info;
    const cache = new Map();
    const MAX = 90;
    const decode = (i) => {
      let k = i;
      while (k > 0 && frames[k].size === 0) k--;
      if (cache.has(k)) {
        const hit = cache.get(k);
        cache.delete(k); cache.set(k, hit);
        return hit;
      }
      const f = frames[k];
      const p = createImageBitmap(file.slice(f.off, f.off + f.size, 'image/jpeg'));
      cache.set(k, p);
      while (cache.size > MAX) {
        const oldest = cache.keys().next().value;
        const old = cache.get(oldest);
        cache.delete(oldest);
        old.then((bmp) => { try { bmp.close(); } catch (e) { /* noop */ } }).catch(() => {});
      }
      return p;
    };
    const first = await decode(0);
    return {
      kind: 'avi', name: file.name, codec: info.codec,
      width: first.width || info.width, height: first.height || info.height,
      fps, nFrames: frames.length, duration: frames.length / fps,
      frameIndex(t) { return Math.max(0, Math.min(frames.length - 1, Math.floor(t * fps + 1e-6))); },
      frameAt(t) { return decode(this.frameIndex(t)); },
      prefetch(t, n = 3) { const i = this.frameIndex(t); for (let k = 1; k <= n && i + k < frames.length; k++) decode(i + k).catch(() => {}); },
      close() { cache.clear(); }
    };
  }

  /* ============================ native video ============================ */
  async function openNative(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(new Error('This browser cannot play that video. Use MJPEG AVI, MP4 (H.264) or WebM.'));
    });
    const fps = 30;
    return {
      kind: 'native', name: file.name, codec: 'browser',
      width: v.videoWidth, height: v.videoHeight, fps,
      nFrames: Math.max(1, Math.floor(v.duration * fps)), duration: v.duration,
      frameIndex(t) { return Math.floor(t * fps); },
      frameAt(t) {
        const target = Math.max(0, Math.min(v.duration - 1e-3, t));
        if (Math.abs(v.currentTime - target) < 1e-3) return Promise.resolve(v);
        return new Promise((resolve) => {
          const done = () => { v.removeEventListener('seeked', done); resolve(v); };
          v.addEventListener('seeked', done);
          v.currentTime = target;
        });
      },
      prefetch() {},
      close() { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
    };
  }

  async function openVideo(file) {
    if (/\.avi$/i.test(file.name)) return openAvi(file);
    return openNative(file);
  }

  /** Start of the recording encoded in a file name such as name-20261022T165244.avi. */
  function timestampFromName(name) {
    const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(name || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  /* ============================ plate geometry ============================ */
  function defaultCalibration(rows, cols) {
    // Corners are the centres of A1, A(last col), (last row)1 and (last row)(last col), as fractions of the frame.
    if (rows === 8 && cols === 12) return { corners: [[0.194, 0.235], [0.864, 0.217], [0.176, 0.796], [0.865, 0.785]], size: 0.9 };
    if (rows === 4 && cols === 6) return { corners: [[0.2, 0.26], [0.8, 0.26], [0.2, 0.74], [0.8, 0.74]], size: 0.9 };
    return { corners: [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]], size: 0.9 };
  }

  function wellCentre(cal, rows, cols, r, c, W, H) {
    const u = cols > 1 ? c / (cols - 1) : 0.5;
    const v = rows > 1 ? r / (rows - 1) : 0.5;
    const [a, b, d, e] = cal.corners;
    const x = (1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * e[0]);
    const y = (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * e[1]);
    return [x * W, y * H];
  }

  function cellSize(cal, rows, cols, W, H) {
    const p00 = wellCentre(cal, rows, cols, 0, 0, W, H);
    const dx = cols > 1 ? Math.hypot(...wellCentre(cal, rows, cols, 0, 1, W, H).map((v, i) => v - p00[i])) : Infinity;
    const dy = rows > 1 ? Math.hypot(...wellCentre(cal, rows, cols, 1, 0, W, H).map((v, i) => v - p00[i])) : Infinity;
    const s = Math.min(dx, dy);
    return (Number.isFinite(s) ? s : Math.min(W, H) / 2) * cal.size;
  }

  /** Row/column of an animal: a well label such as "B7", otherwise its channel number counted row by row. */
  function wellPosition(animal, rows, cols) {
    const m = /^([A-Za-z])(\d{1,2})$/.exec(String(animal.well == null ? '' : animal.well).trim());
    if (m) {
      const r = m[1].toUpperCase().charCodeAt(0) - 65, c = +m[2] - 1;
      if (r >= 0 && r < rows && c >= 0 && c < cols) return { r, c };
    }
    const ch = Number(animal.channel);
    if (Number.isFinite(ch) && ch >= 1) {
      const idx = ch - 1;
      const r = Math.floor(idx / cols), c = idx % cols;
      if (r < rows) return { r, c };
    }
    return null;
  }

  function detectPlate(animals) {
    let maxR = -1, maxC = -1;
    for (const a of animals) {
      const m = /^([A-Za-z])(\d{1,2})$/.exec(String(a.well == null ? '' : a.well).trim());
      if (!m) continue;
      maxR = Math.max(maxR, m[1].toUpperCase().charCodeAt(0) - 65);
      maxC = Math.max(maxC, +m[2] - 1);
    }
    if (maxR >= 0) return maxR < 4 && maxC < 6 && animals.length <= 24 ? { rows: 4, cols: 6 } : { rows: 8, cols: 12 };
    return animals.length > 24 ? { rows: 8, cols: 12 } : { rows: 4, cols: 6 };
  }

  global.VideoLab = { openVideo, timestampFromName, defaultCalibration, wellCentre, cellSize, wellPosition, detectPlate };
})(window);
