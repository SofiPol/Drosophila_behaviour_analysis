/* ============================================================================
 * pdfexport.js — single-page vector PDF export for figures
 * Exposed as window.PdfExport
 *
 * Why a hand-written writer: Illustrator, Inkscape, PowerPoint and every
 * journal accept vector PDF, and base-14 fonts (Helvetica / Times / Courier /
 * Symbol) need no embedding, so text stays editable on any machine. The
 * converter covers the subset of SVG that Plotly emits for these charts:
 * translate/rotate/scale/matrix transforms, path (M L H V C S Q T A Z), rect,
 * line, polyline/polygon, circle/ellipse, clipPath (rect), text/tspan with
 * anchors, fill/stroke opacity, dash patterns and fill rules.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---------------------------- matrices ---------------------------- */
  const IDENT = [1, 0, 0, 1, 0, 0];
  function mul(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function parseTransform(str) {
    let m = IDENT;
    if (!str) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let hit;
    while ((hit = re.exec(str))) {
      const v = hit[2].split(/[\s,]+/).filter(Boolean).map(Number);
      let t = IDENT;
      switch (hit[1]) {
        case 'matrix': if (v.length >= 6) t = v.slice(0, 6); break;
        case 'translate': t = [1, 0, 0, 1, v[0] || 0, v[1] || 0]; break;
        case 'scale': t = [v[0] === undefined ? 1 : v[0], 0, 0, v[1] === undefined ? (v[0] === undefined ? 1 : v[0]) : v[1], 0, 0]; break;
        case 'rotate': {
          const a = (v[0] || 0) * Math.PI / 180;
          const cos = Math.cos(a), sin = Math.sin(a);
          t = [cos, sin, -sin, cos, 0, 0];
          if (v.length >= 3) t = mul(mul([1, 0, 0, 1, v[1], v[2]], t), [1, 0, 0, 1, -v[1], -v[2]]);
          break;
        }
        case 'skewX': t = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      m = mul(m, t);
    }
    return m;
  }

  /* ---------------------------- style / colour ---------------------------- */
  const INHERITED = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-family', 'font-weight',
    'font-style', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'text-anchor', 'display', 'visibility'];

  function styleMap(node) {
    const out = {};
    const raw = node.getAttribute && node.getAttribute('style');
    if (raw) {
      for (const part of raw.split(';')) {
        const i = part.indexOf(':');
        if (i < 0) continue;
        out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
      }
    }
    for (const a of INHERITED) {
      const v = node.getAttribute && node.getAttribute(a);
      if (v !== null && v !== undefined && out[a] === undefined) out[a] = String(v).trim();
    }
    return out;
  }

  function mergedStyle(node, parentStyle) {
    const own = styleMap(node);
    const out = Object.assign({}, parentStyle);
    for (const k of Object.keys(own)) if (own[k] !== '') out[k] = own[k];
    return out;
  }

  const NAMED = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
    blue: [0, 0, 255], grey: [128, 128, 128], gray: [128, 128, 128], yellow: [255, 255, 0],
    orange: [255, 165, 0], purple: [128, 0, 128], none: null, transparent: null
  };

  function parseColor(value) {
    if (value === null || value === undefined) return null;
    const v = String(value).trim();
    if (!v) return null;
    const key = v.toLowerCase();
    if (key === 'none' || key === 'transparent' || key === 'currentcolor') return key === 'currentcolor' ? { r: 0, g: 0, b: 0, a: 1 } : null;
    if (NAMED[key] !== undefined) {
      const c = NAMED[key];
      return c ? { r: c[0], g: c[1], b: c[2], a: 1 } : null;
    }
    let m = /^#([0-9a-f]{3})$/i.exec(v);
    if (m) {
      const h = m[1];
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
    }
    m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
      const h = m[1];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    m = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) {
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 };
      }
    }
    if (/^url\(/i.test(v)) return null; // gradients are not used by these figures
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  /* ---------------------------- text encoding ---------------------------- */
  const WINANSI = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
    '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93,
    '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
    'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
  };
  // Greek and maths go through the Symbol font, which is available everywhere.
  const SYMBOL = {
    'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Θ': 'Q', 'Ι': 'I',
    'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P', 'Ρ': 'R', 'Σ': 'S',
    'Τ': 'T', 'Υ': 'U', 'Φ': 'F', 'Χ': 'C', 'Ψ': 'Y', 'Ω': 'W',
    'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'h', 'θ': 'q', 'ι': 'i',
    'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's',
    'ς': 'V', 'τ': 't', 'υ': 'u', 'φ': 'f', 'χ': 'c', 'ψ': 'y', 'ω': 'w',
    '≤': 0xA3, '≥': 0xB3, '≈': 0xBB, '≠': 0xB9, '≡': 0xBA, '→': 0xAE, '←': 0xAC, '↔': 0xAB,
    '∞': 0xA5, '∂': 0xB6, '√': 0xD6, '∑': 0xE5, '∏': 0xD5, '°': 0xB0
  };

  function winAnsiCode(ch) {
    if (SYMBOL[ch] !== undefined) return null;
    const c = ch.charCodeAt(0);
    if (c === 0x2212 || c === 0x2011 || c === 0x2012) return 0x2D; // minus / non-breaking hyphen
    if (c === 0x00A0 || c === 0x2009 || c === 0x200A) return 0x20;
    if (WINANSI[ch] !== undefined) return WINANSI[ch];
    if (c >= 0x20 && c <= 0x7E) return c;
    if (c >= 0xA0 && c <= 0xFF) return c;
    return 0x3F; // '?'
  }

  function encodeRuns(text, baseFont) {
    const runs = [];
    let current = null;
    for (const ch of String(text)) {
      const symbol = SYMBOL[ch] !== undefined;
      const font = symbol ? 'Sym' : baseFont;
      let code;
      if (symbol) code = typeof SYMBOL[ch] === 'number' ? SYMBOL[ch] : SYMBOL[ch].charCodeAt(0);
      else code = winAnsiCode(ch);
      if (!current || current.font !== font) {
        current = { font, s: '' };
        runs.push(current);
      }
      current.s += String.fromCharCode(code);
    }
    return runs;
  }

  const FONT_FILES = {
    Helvetica: 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Helvetica-Oblique': 'Helvetica-Oblique',
    'Times-Roman': 'Times-Roman', 'Times-Bold': 'Times-Bold', 'Times-Italic': 'Times-Italic',
    Courier: 'Courier', 'Courier-Bold': 'Courier-Bold', Sym: 'Symbol'
  };

  function pdfFont(style) {
    const family = String(style['font-family'] || '').toLowerCase();
    const bold = /(bold|[6-9]00)/.test(String(style['font-weight'] || ''));
    const italic = /italic|oblique/.test(String(style['font-style'] || ''));
    if (/mono|courier/.test(family)) return bold ? 'Courier-Bold' : 'Courier';
    if (/sans-serif/.test(family)) return bold ? 'Helvetica-Bold' : (italic ? 'Helvetica-Oblique' : 'Helvetica');
    if (/serif|georgia|times|garamond|baskerville/.test(family)) return bold ? 'Times-Bold' : (italic ? 'Times-Italic' : 'Times-Roman');
    return bold ? 'Helvetica-Bold' : (italic ? 'Helvetica-Oblique' : 'Helvetica');
  }

  /* ---------------------------- path data ---------------------------- */
  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function fmt(n) {
    const r = Math.round(n * 1000) / 1000;
    return String(Object.is(r, -0) ? 0 : r);
  }

  /** Endpoint → centre parameterisation, then arc → cubic Béziers. */
  function arcToCubics(x0, y0, rx, ry, phiDeg, largeArc, sweep, x1, y1) {
    if (rx === 0 || ry === 0) return [['l', x1, y1]];
    const phi = (phiDeg || 0) * Math.PI / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const dx2 = (x0 - x1) / 2, dy2 = (y0 - y1) / 2;
    const x1p = cosPhi * dx2 + sinPhi * dy2;
    const y1p = -sinPhi * dx2 + cosPhi * dy2;
    rx = Math.abs(rx); ry = Math.abs(ry);
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const sign = largeArc === sweep ? -1 : 1;
    const num1 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = sign * Math.sqrt(Math.max(0, num1 / den));
    const cxp = coef * (rx * y1p / ry);
    const cyp = coef * (-ry * x1p / rx);
    const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
    const angle = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
      let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
    const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
    const delta = dTheta / segments;
    const t = 4 / 3 * Math.tan(delta / 4);
    const out = [];
    let theta = theta1;
    let px = x0, py = y0;
    for (let i = 0; i < segments; i++) {
      const nextTheta = theta + delta;
      const cos1 = Math.cos(theta), sin1 = Math.sin(theta);
      const cos2 = Math.cos(nextTheta), sin2 = Math.sin(nextTheta);
      const e1x = cx + rx * cosPhi * cos1 - ry * sinPhi * sin1;
      const e1y = cy + rx * sinPhi * cos1 + ry * cosPhi * sin1;
      const e2x = cx + rx * cosPhi * cos2 - ry * sinPhi * sin2;
      const e2y = cy + rx * sinPhi * cos2 + ry * cosPhi * sin2;
      const d1x = -rx * cosPhi * sin1 - ry * sinPhi * cos1;
      const d1y = -rx * sinPhi * sin1 + ry * cosPhi * cos1;
      const d2x = -rx * cosPhi * sin2 - ry * sinPhi * cos2;
      const d2y = -rx * sinPhi * sin2 + ry * cosPhi * cos2;
      out.push(['c', e1x + t * d1x, e1y + t * d1y, e2x - t * d2x, e2y - t * d2y, e2x, e2y]);
      px = e2x; py = e2y;
      theta = nextTheta;
    }
    return out;
  }

  /** Convert an SVG path `d` attribute into PDF path operators. */
  function pathToOperators(d) {
    const tokens = String(d || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const ops = [];
    let i = 0, cmd = null;
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let lastCubic = null, lastQuad = null;
    const read = () => Number(tokens[i++]);
    let guard = 0;
    while (i < tokens.length && guard++ < 500000) {
      const token = tokens[i];
      if (typeof token === 'string' && /^[a-zA-Z]$/.test(token)) { cmd = token; i++; }
      if (!cmd) break;
      const upper = cmd.toUpperCase();
      const rel = cmd !== upper;
      const offset = (x, y) => (rel ? [cx + x, cy + y] : [x, y]);
      if (upper === 'Z') {
        ops.push('h');
        cx = sx; cy = sy;
        lastCubic = lastQuad = null;
        cmd = null;
        continue;
      }
      if (upper === 'M') {
        const [x, y] = offset(read(), read());
        cx = x; cy = y; sx = x; sy = y;
        ops.push(`${fmt(cx)} ${fmt(cy)} m`);
        cmd = rel ? 'l' : 'L';
        lastCubic = lastQuad = null;
        continue;
      }
      if (upper === 'L') {
        const [x, y] = offset(read(), read());
        cx = x; cy = y;
        ops.push(`${fmt(cx)} ${fmt(cy)} l`);
        lastCubic = lastQuad = null;
        continue;
      }
      if (upper === 'H') {
        const x = read();
        cx = rel ? cx + x : x;
        ops.push(`${fmt(cx)} ${fmt(cy)} l`);
        lastCubic = lastQuad = null;
        continue;
      }
      if (upper === 'V') {
        const y = read();
        cy = rel ? cy + y : y;
        ops.push(`${fmt(cx)} ${fmt(cy)} l`);
        lastCubic = lastQuad = null;
        continue;
      }
      if (upper === 'C') {
        const [x1, y1] = offset(read(), read());
        const [x2, y2] = offset(read(), read());
        const [x, y] = offset(read(), read());
        ops.push(`${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} c`);
        lastCubic = [x2, y2]; lastQuad = null;
        cx = x; cy = y;
        continue;
      }
      if (upper === 'S') {
        const [x2, y2] = offset(read(), read());
        const [x, y] = offset(read(), read());
        const x1 = lastCubic ? 2 * cx - lastCubic[0] : cx;
        const y1 = lastCubic ? 2 * cy - lastCubic[1] : cy;
        ops.push(`${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} c`);
        lastCubic = [x2, y2]; lastQuad = null;
        cx = x; cy = y;
        continue;
      }
      if (upper === 'Q') {
        const [qx, qy] = offset(read(), read());
        const [x, y] = offset(read(), read());
        const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
        const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
        ops.push(`${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} c`);
        lastQuad = [qx, qy]; lastCubic = null;
        cx = x; cy = y;
        continue;
      }
      if (upper === 'T') {
        const [x, y] = offset(read(), read());
        const qx = lastQuad ? 2 * cx - lastQuad[0] : cx;
        const qy = lastQuad ? 2 * cy - lastQuad[1] : cy;
        const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
        const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
        ops.push(`${fmt(x1)} ${fmt(y1)} ${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} c`);
        lastQuad = [qx, qy]; lastCubic = null;
        cx = x; cy = y;
        continue;
      }
      if (upper === 'A') {
        const rx = read(), ry = read(), rot = read(), large = read(), sweep = read();
        const [x, y] = offset(read(), read());
        for (const seg of arcToCubics(cx, cy, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, x, y)) {
          if (seg[0] === 'l') ops.push(`${fmt(seg[1])} ${fmt(seg[2])} l`);
          else ops.push(`${fmt(seg[1])} ${fmt(seg[2])} ${fmt(seg[3])} ${fmt(seg[4])} ${fmt(seg[5])} ${fmt(seg[6])} c`);
        }
        lastCubic = lastQuad = null;
        cx = x; cy = y;
        continue;
      }
      // Unknown command: skip it so one bad token cannot loop forever.
      i++;
    }
    return ops.join('\n');
  }

  /* ---------------------------- PDF writer ---------------------------- */
  function pdfNumber(n) { return fmt(n); }

  function buildPdf(page) {
    const objects = [];           // 1-based object bodies
    const push = (body) => { objects.push(body); return objects.length; };

    const fontKeys = Object.keys(page.fonts);
    const alphaKeys = Object.keys(page.alphas);
    const fontObj = {};
    const alphaObj = {};
    let next = 5;                 // 1 catalog, 2 pages, 3 page, 4 content
    for (const k of fontKeys) fontObj[k] = next++;
    for (const k of alphaKeys) alphaObj[k] = next++;

    const fontDict = fontKeys.map((k) => `${page.fonts[k]} ${fontObj[k]} 0 R`).join(' ');
    const gsDict = alphaKeys.map((k) => `${page.alphas[k]} ${alphaObj[k]} 0 R`).join(' ');

    push('<< /Type /Catalog /Pages 2 0 R >>');
    push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] `
      + `/Resources << /ProcSet [/PDF /Text] /Font << ${fontDict} >>`
      + (gsDict ? ` /ExtGState << ${gsDict} >>` : '')
      + ` >> /Contents 4 0 R >>`);
    push(`<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`);
    for (const k of fontKeys) {
      const base = FONT_FILES[k] || 'Helvetica';
      push(base === 'Symbol'
        ? '<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>'
        : `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
    }
    for (const k of alphaKeys) push(`<< /Type /ExtGState /ca ${k} /CA ${k} >>`);

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const startxref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------------------------- SVG → content ---------------------------- */
  function collectIds(root) {
    const map = new Map();
    root.querySelectorAll('[id]').forEach((el) => { if (!map.has(el.id)) map.set(el.id, el); });
    return map;
  }

  function strokeState(style, alpha, ctx) {
    const stroke = parseColor(style.stroke);
    if (!stroke) return null;
    const width = num(style['stroke-width'], 1);
    let out = '';
    const effAlpha = alpha * num(style['stroke-opacity'], 1) * stroke.a;
    out += ctx.alphaRef(effAlpha);
    out += `${pdfNumber(stroke.r / 255)} ${pdfNumber(stroke.g / 255)} ${pdfNumber(stroke.b / 255)} RG\n`;
    out += `${pdfNumber(width)} w\n`;
    const cap = style['stroke-linecap'];
    out += `${cap === 'round' ? 1 : cap === 'square' ? 2 : 0} J\n`;
    const join = style['stroke-linejoin'];
    out += `${join === 'round' ? 1 : join === 'bevel' ? 2 : 0} j\n`;
    const dash = style['stroke-dasharray'];
    if (dash && dash !== 'none') {
      const parts = String(dash).split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
      if (parts.length && parts.some((v) => v > 0)) out += `[${parts.map(pdfNumber).join(' ')}] 0 d\n`;
    }
    return out;
  }

  function drawSvgElement(node, ctx) {
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'defs' || tag === 'clippath' || tag === 'lineargradient' || tag === 'radialgradient' || tag === 'title' || tag === 'desc') return;
    const style = mergedStyle(node, ctx.style);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const local = parseTransform(node.getAttribute && node.getAttribute('transform'));
    const m = mul(ctx.m, local);
    const opacity = ctx.alpha * num(style.opacity, 1);

    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      const clipRef = node.getAttribute && node.getAttribute('clip-path');
      let clipped = false;
      if (clipRef) {
        const id = clipRef.replace(/^url\(#?/, '').replace(/\)$/, '');
        const clipEl = ctx.ids.get(id);
        if (clipEl) {
          const rect = clipEl.querySelector('rect');
          if (rect) {
            const cm = mul(m, parseTransform(rect.getAttribute('transform')));
            const x = num(rect.getAttribute('x')), y = num(rect.getAttribute('y'));
            const w = num(rect.getAttribute('width')), h = num(rect.getAttribute('height'));
            ctx.out.push('q');
            ctx.out.push(`${cm.map(pdfNumber).join(' ')} cm`);
            ctx.out.push(`${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(w)} ${pdfNumber(h)} re W n`);
            clipped = true;
          }
        }
      }
      for (const child of node.children) drawSvgElement(child, { ...ctx, m, style, alpha: opacity });
      if (clipped) ctx.out.push('Q');
      return;
    }

    const paint = (pathOps, fillRule) => {
      const fill = parseColor(style.fill);
      const stroke = strokeState(style, opacity, ctx);
      const hasFill = !!fill;
      const hasStroke = !!stroke;
      if (!hasFill && !hasStroke) return;
      ctx.out.push('q');
      ctx.out.push(`${m.map(pdfNumber).join(' ')} cm`);
      if (hasFill) {
        ctx.out.push(ctx.alphaRef(opacity * num(style['fill-opacity'], 1) * fill.a));
        ctx.out.push(`${pdfNumber(fill.r / 255)} ${pdfNumber(fill.g / 255)} ${pdfNumber(fill.b / 255)} rg`);
      }
      if (hasStroke) ctx.out.push(stroke);
      ctx.out.push(pathOps);
      const evenOdd = fillRule === 'evenodd' || style['fill-rule'] === 'evenodd';
      if (hasFill && hasStroke) ctx.out.push(evenOdd ? 'B*' : 'B');
      else if (hasFill) ctx.out.push(evenOdd ? 'f*' : 'f');
      else ctx.out.push('S');
      ctx.out.push('Q');
    };

    if (tag === 'path') {
      const ops = pathToOperators(node.getAttribute('d'));
      if (ops) paint(ops, node.getAttribute('fill-rule'));
      return;
    }
    if (tag === 'rect') {
      const x = num(node.getAttribute('x')), y = num(node.getAttribute('y'));
      const w = num(node.getAttribute('width')), h = num(node.getAttribute('height'));
      if (w > 0 && h > 0) paint(`${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(w)} ${pdfNumber(h)} re`);
      return;
    }
    if (tag === 'line') {
      const x1 = num(node.getAttribute('x1')), y1 = num(node.getAttribute('y1'));
      const x2 = num(node.getAttribute('x2')), y2 = num(node.getAttribute('y2'));
      if (!style.stroke) style.stroke = 'black';
      paint(`${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l`);
      return;
    }
    if (tag === 'polyline' || tag === 'polygon') {
      const pts = String(node.getAttribute('points') || '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (pts.length < 4) return;
      let ops = `${pdfNumber(pts[0])} ${pdfNumber(pts[1])} m`;
      for (let i = 2; i + 1 < pts.length; i += 2) ops += ` ${pdfNumber(pts[i])} ${pdfNumber(pts[i + 1])} l`;
      if (tag === 'polygon') ops += ' h';
      paint(ops);
      return;
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(node.getAttribute('cx')), cy = num(node.getAttribute('cy'));
      const rx = tag === 'circle' ? num(node.getAttribute('r')) : num(node.getAttribute('rx'));
      const ry = tag === 'circle' ? num(node.getAttribute('r')) : num(node.getAttribute('ry'));
      if (rx <= 0 || ry <= 0) return;
      const k = 0.5522847498;
      const ops = [
        `${pdfNumber(cx + rx)} ${pdfNumber(cy)} m`,
        `${pdfNumber(cx + rx)} ${pdfNumber(cy + ry * k)} ${pdfNumber(cx + rx * k)} ${pdfNumber(cy + ry)} ${pdfNumber(cx)} ${pdfNumber(cy + ry)} c`,
        `${pdfNumber(cx - rx * k)} ${pdfNumber(cy + ry)} ${pdfNumber(cx - rx)} ${pdfNumber(cy + ry * k)} ${pdfNumber(cx - rx)} ${pdfNumber(cy)} c`,
        `${pdfNumber(cx - rx)} ${pdfNumber(cy - ry * k)} ${pdfNumber(cx - rx * k)} ${pdfNumber(cy - ry)} ${pdfNumber(cx)} ${pdfNumber(cy - ry)} c`,
        `${pdfNumber(cx + rx * k)} ${pdfNumber(cy - ry)} ${pdfNumber(cx + rx)} ${pdfNumber(cy - ry * k)} ${pdfNumber(cx + rx)} ${pdfNumber(cy)} c`,
        'h'
      ].join('\n');
      paint(ops);
      return;
    }
    if (tag === 'text') {
      drawText(node, { ...ctx, m, style, alpha: opacity });
      return;
    }
    // Unknown container: keep walking so nothing is silently lost.
    for (const child of node.children || []) drawSvgElement(child, { ...ctx, m, style, alpha: opacity });
  }

  function escapePdfString(s) {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function drawText(node, ctx) {
    const style = ctx.style;
    const family = pdfFont(style);
    const fontSize = num(style['font-size'], 12);
    const anchor = (style['text-anchor'] || 'start').toLowerCase();
    const fill = parseColor(style.fill) || { r: 0, g: 0, b: 0, a: 1 };
    const alpha = ctx.alpha * num(style['fill-opacity'], 1) * fill.a;

    const tspans = Array.from(node.children || []).filter((c) => (c.tagName || '').toLowerCase() === 'tspan');
    const baseX = num(node.getAttribute('x'), 0);
    const baseY = num(node.getAttribute('y'), 0);

    const emit = (target, text, x, y, styleOverride) => {
      const clean = String(text || '');
      if (!clean.trim()) return;
      const st = styleOverride ? mergedStyle(target, styleOverride) : style;
      const size = num(st['font-size'], fontSize);
      const font = pdfFont(st) === family ? family : pdfFont(st);
      let width = 0;
      try { width = target.getComputedTextLength(); } catch (e) { width = 0; }
      if (!Number.isFinite(width) || width <= 0) width = clean.length * size * 0.5;
      let tx = x;
      if (anchor === 'middle') tx -= width / 2;
      else if (anchor === 'end') tx -= width;
      const textMatrix = mul(ctx.m, [1, 0, 0, -1, tx, y]);
      ctx.out.push('q');
      ctx.out.push(`${textMatrix.map(pdfNumber).join(' ')} cm`);
      ctx.out.push('BT');
      ctx.out.push(ctx.alphaRef(alpha));
      ctx.out.push(`${pdfNumber(fill.r / 255)} ${pdfNumber(fill.g / 255)} ${pdfNumber(fill.b / 255)} rg`);
      let currentFont = null;
      for (const run of encodeRuns(clean, font)) {
        if (run.font !== currentFont) {
          ctx.out.push(`/${ctx.fontRef(run.font)} ${pdfNumber(size)} Tf`);
          currentFont = run.font;
        }
        ctx.out.push(`(${escapePdfString(run.s)}) Tj`);
      }
      ctx.out.push('ET');
      ctx.out.push('Q');
    };

    if (!tspans.length) {
      emit(node, node.textContent, baseX, baseY);
      return;
    }
    let x = baseX, y = baseY;
    for (const ts of tspans) {
      const tsx = ts.getAttribute('x');
      const tsy = ts.getAttribute('y');
      if (tsx !== null && tsx !== '') x = num(tsx, x);
      if (tsy !== null && tsy !== '') y = num(tsy, y);
      const dy = ts.getAttribute('dy');
      if (dy) {
        const value = parseFloat(dy);
        if (Number.isFinite(value)) y += /em$/.test(dy) ? value * fontSize : value;
      }
      emit(ts, ts.textContent, x, y, style);
    }
  }

  /* ---------------------------- public API ---------------------------- */
  function svgToContent(svgEl, opts) {
    const out = [];
    const fontKeys = {};
    const alphaKeys = {};
    let fontCounter = 0, gsCounter = 0;
    const ctx = {
      m: IDENT,
      style: {},
      alpha: 1,
      out,
      ids: collectIds(svgEl),
      fonts: fontKeys,
      fontRef(name) {
        if (!fontKeys[name]) fontKeys[name] = `F${++fontCounter}`;
        return fontKeys[name];
      },
      alphaRef(value) {
        const a = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
        const key = a.toFixed(3);
        if (!alphaKeys[key]) alphaKeys[key] = `GS${++gsCounter}`;
        // Trailing newline matters: callers concatenate this with colour
        // operators, and "gs0.067" would otherwise be read as one token.
        return a >= 0.999 ? '' : `/${alphaKeys[key]} gs\n`;
      }
    };
    for (const child of svgEl.children) drawSvgElement(child, { ...ctx, m: opts.m || IDENT });
    return { content: out.filter(Boolean).join('\n'), fonts: fontKeys, alphas: alphaKeys };
  }

  function parseSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('The figure could not be parsed for PDF export.');
    return doc.documentElement;
  }

  /**
   * Convert one Plotly panel (SVG string) into PDF content placed at x/y in a
   * page whose height is `pageHeight` (SVG y grows downwards, PDF y upwards).
   */
  function panelToContent(svgText, panel) {
    const svg = parseSvg(svgText);
    const width = num(svg.getAttribute('width'), panel.width);
    const height = num(svg.getAttribute('height'), panel.height);
    // Attach to the document so text widths (getComputedTextLength) are real.
    const host = document.createElement('div');
    host.setAttribute('style', 'position:absolute;left:-100000px;top:0;pointer-events:none;');
    document.body.appendChild(host);
    host.appendChild(svg);
    try {
      const converted = svgToContent(svg, {
        m: [1, 0, 0, 1, panel.x, panel.y]
      });
      return Object.assign({ width, height }, converted);
    } finally {
      host.remove();
    }
  }

  /**
   * Build a single-page vector PDF from one or more rendered Plotly panels.
   * The page is sized in points at 1 CSS px = 1 pt, so a 900 px figure prints
   * at 900 pt (31.7 cm) wide unless the document is resized in Illustrator.
   */
  async function fromPlots(plots, opts = {}) {
    if (!plots || !plots.length) throw new Error('No figure found in this panel.');
    const cols = plots.length === 1 ? 1 : Math.min(opts.cols || 3, plots.length);
    const rows = Math.ceil(plots.length / cols);
    const cellW = Math.max(1, Math.round(plots[0].clientWidth || 900));
    const cellH = Math.max(1, Math.round(plots[0].clientHeight || 520));
    const width = cols * cellW;
    const height = rows * cellH;
    const parts = [];
    const fonts = {};
    const alphas = {};
    let fontCounter = 0, gsCounter = 0;

    for (let i = 0; i < plots.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const svgUrl = await Plotly.toImage(plots[i], {
        format: 'svg', width: cellW, height: cellH
      });
      const svgText = await (await fetch(svgUrl)).text();
      // Panel origin in the flipped (top-down) user space of the page.
      const converted = panelToContent(svgText, {
        x: col * cellW,
        y: (rows - 1 - row) * cellH,
        width: cellW,
        height: cellH
      });
      // Renumber font / alpha names so the panels do not collide.
      const remap = {};
      for (const [name] of Object.entries(converted.fonts)) {
        if (!fonts[name]) fonts[name] = `F${++fontCounter}`;
        remap[converted.fonts[name]] = fonts[name];
      }
      for (const [key, ref] of Object.entries(converted.alphas)) {
        if (!alphas[key]) alphas[key] = `GS${++gsCounter}`;
        remap[ref] = alphas[key];
      }
      // Replace in one pass: a chained replace could remap F1→F2 and then
      // rewrite that new F2 again.
      const content = converted.content.replace(/\/(F\d+|GS\d+)\b/g, (whole, name) => (remap[name] ? `/${remap[name]}` : whole));
      parts.push(`q\n${content}\nQ`);
    }

    const pageHeight = height;
    const content = ['q', `1 0 0 -1 0 ${pdfNumber(pageHeight)} cm`, ...parts, 'Q'].join('\n');
    return buildPdf({ width, height, content, fonts, alphas });
  }

  global.PdfExport = { fromPlots, fromSvg: (text, opts) => panelToContent(text, opts || { x: 0, y: 0, width: 0, height: 0 }), buildPdf };
})(window);
