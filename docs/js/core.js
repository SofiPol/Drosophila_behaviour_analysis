/* ============================================================================
 * core.js — numerical, distribution, IO and formatting utilities
 * Chronobiology Workbench · runs entirely in the browser
 * Exposed as window.Core
 * ==========================================================================*/
(function (global) {
  'use strict';

  const VERSION = '2.0.0';
  const TAU = Math.PI * 2;

  /* ============================ basic helpers ============================ */
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const safeDiv = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : NaN);
  const sum = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) if (isNum(a[i])) s += a[i];
    return s;
  };
  const nValid = (a) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (isNum(a[i])) n++;
    return n;
  };
  const valid = (a) => a.filter(isNum);
  const mean = (a) => {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (isNum(a[i])) { s += a[i]; n++; }
    return n ? s / n : NaN;
  };
  const variance = (a, sample = true) => {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (isNum(a[i])) { s += a[i]; n++; }
    if (n < (sample ? 2 : 1)) return NaN;
    const m = s / n;
    let ss = 0;
    for (let i = 0; i < a.length; i++) if (isNum(a[i])) ss += (a[i] - m) * (a[i] - m);
    return ss / (n - (sample ? 1 : 0));
  };
  const sd = (a) => Math.sqrt(variance(a, true));
  const sem = (a) => {
    const n = nValid(a);
    return n > 1 ? sd(a) / Math.sqrt(n) : NaN;
  };
  const median = (a) => quantile(a, 0.5);
  const quantile = (a, q) => {
    const x = valid(a).sort((p, r) => p - r);
    if (!x.length) return NaN;
    if (x.length === 1) return x[0];
    const pos = (x.length - 1) * clamp(q, 0, 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return x[lo] + (pos - lo) * (x[hi] - x[lo]);
  };
  const iqr = (a) => quantile(a, 0.75) - quantile(a, 0.25);
  const min = (a) => {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (isNum(a[i]) && a[i] < m) m = a[i];
    return m === Infinity ? NaN : m;
  };
  const max = (a) => {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (isNum(a[i]) && a[i] > m) m = a[i];
    return m === -Infinity ? NaN : m;
  };
  const range = (a) => [min(a), max(a)];
  const unique = (a) => {
    const out = [];
    const seen = new Set();
    for (const v of a) if (!seen.has(v)) { seen.add(v); out.push(v); }
    return out;
  };
  const countBy = (a) => {
    const m = new Map();
    for (const v of a) m.set(v, (m.get(v) || 0) + 1);
    return m;
  };
  const cumsum = (a) => {
    const out = new Array(a.length);
    let s = 0;
    for (let i = 0; i < a.length; i++) { s += isNum(a[i]) ? a[i] : 0; out[i] = s; }
    return out;
  };
  const diff = (a) => a.map((v, i) => (i === 0 ? NaN : v - a[i - 1]));

  function rank(a) {
    const idx = a.map((v, i) => [v, i]).filter(([v]) => isNum(v));
    idx.sort((p, r) => p[0] - r[0]);
    const ranks = new Array(a.length).fill(NaN);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
      i = j + 1;
    }
    return ranks;
  }

  /* ============================ distributions ============================ */
  const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  function gammaLn(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - gammaLn(1 - x);
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(TAU) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function regularizedGammaP(a, x) {
    if (!(a > 0) || x < 0) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) {
      let term = 1 / a, sumv = term, ap = a;
      for (let n = 1; n < 2000; n++) {
        ap += 1; term *= x / ap; sumv += term;
        if (Math.abs(term) < Math.abs(sumv) * 1e-15) break;
      }
      return sumv * Math.exp(-x + a * Math.log(x) - gammaLn(a));
    }
    const EPS = 1e-15;
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 2000; i++) {
      const an = -i * (i - a);
      b += 2; d = an * d + b;
      if (Math.abs(d) < EPS) d = EPS;
      c = b + an / c;
      if (Math.abs(c) < EPS) c = EPS;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
  }
  const regularizedGammaQ = (a, x) => 1 - regularizedGammaP(a, x);

  function chiSquareCdf(x, df) {
    if (!(df > 0) || x <= 0) return x <= 0 ? 0 : NaN;
    return regularizedGammaP(df / 2, x / 2);
  }
  const chiSquareSf = (x, df) => 1 - chiSquareCdf(x, df);
  function chiSquareQuantile(p, df) {
    if (!(df > 0) || p <= 0) return 0;
    if (p >= 1) return Infinity;
    let lo = 0, hi = Math.max(100, df * 10);
    while (chiSquareCdf(hi, df) < p && hi < 1e9) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (chiSquareCdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
      a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
    return s * y;
  }
  const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  function normalQuantile(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
    const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1];
    const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
      -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
    const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
      3.754408661907416e0];
    const PLOW = 0.02425;
    let x;
    if (p < PLOW) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    } else if (p <= 1 - PLOW) {
      const q = p - 0.5, r = q * q;
      x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
        (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    }
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(TAU) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 1e-14, FPMIN = 1e-300;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function incompleteBeta(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbeta = gammaLn(a + b) - gammaLn(a) - gammaLn(b);
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) + lbeta);
    if (x < (a + 1) / (a + b + 2)) return front * betacf(a, b, x) / a;
    return 1 - front * betacf(b, a, 1 - x) / b;
  }

  function tCdf(t, df) {
    if (!(df > 0)) return NaN;
    if (t === Infinity) return 1;
    if (t === -Infinity) return 0;
    const x = df / (df + t * t);
    const p = 0.5 * incompleteBeta(df / 2, 0.5, x);
    return t >= 0 ? 1 - p : p;
  }
  function tSf(t, df) { return 1 - tCdf(t, df); }
  function tQuantile(p, df) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    let lo = -1e3, hi = 1e3;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function fCdf(f, d1, d2) {
    if (!(f >= 0) || !(d1 > 0) || !(d2 > 0)) return NaN;
    return incompleteBeta(d1 / 2, d2 / 2, d1 * f / (d1 * f + d2));
  }
  const fSf = (f, d1, d2) => 1 - fCdf(f, d1, d2);

  /* ============================ regression ============================ */
  function linearRegression(x, y) {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(y[i])) { xs.push(x[i]); ys.push(y[i]); }
    const n = xs.length;
    if (n < 2) return { n, slope: NaN, intercept: NaN, r2: NaN, seSlope: NaN, t: NaN, p: NaN, ci95: NaN };
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) * (xs[i] - mx);
      sxy += (xs[i] - mx) * (ys[i] - my);
      syy += (ys[i] - my) * (ys[i] - my);
    }
    if (sxx === 0) return { n, slope: NaN, intercept: NaN, r2: NaN, seSlope: NaN, t: NaN, p: NaN, ci95: NaN };
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const e = ys[i] - (intercept + slope * xs[i]);
      sse += e * e;
    }
    const df = n - 2;
    const s2 = df > 0 ? sse / df : NaN;
    const seSlope = Math.sqrt(s2 / sxx);
    const t = seSlope > 0 ? slope / seSlope : NaN;
    const p = df > 0 ? 2 * tSf(Math.abs(t), df) : NaN;
    const tcrit = df > 0 ? tQuantile(0.975, df) : NaN;
    return {
      n, slope, intercept,
      r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0,
      seSlope, t, p, ci95: tcrit * seSlope
    };
  }

  function detrend(y) {
    const x = y.map((_, i) => i);
    const r = linearRegression(x, y);
    return y.map((v, i) => v - (r.intercept + r.slope * i));
  }

  function pearson(x, y) {
    const xs = [], ys = [];
    for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(y[i])) { xs.push(x[i]); ys.push(y[i]); }
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  /* ============================ smoothing / circular ============================ */
  function movingAverageCircular(values, window) {
    const n = values.length;
    if (!n || window < 2) return values.slice();
    const half = Math.floor(window / 2);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = -half; j <= half; j++) {
        const v = values[((i + j) % n + n) % n];
        if (isNum(v)) { s += v; k++; }
      }
      out[i] = k ? s / k : NaN;
    }
    return out;
  }
  function movingAverage(values, window) {
    const n = values.length;
    if (!n || window < 2) return values.slice();
    const half = Math.floor(window / 2);
    const out = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      let s = 0, k = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
        if (isNum(values[j])) { s += values[j]; k++; }
      }
      if (k) out[i] = s / k;
    }
    return out;
  }
  function circularMeanTime(times, weights) {
    let sx = 0, sy = 0;
    for (let i = 0; i < times.length; i++) {
      const w = weights ? weights[i] : 1;
      if (!isNum(times[i]) || !isNum(w)) continue;
      sx += w * Math.cos(TAU * times[i] / 24);
      sy += w * Math.sin(TAU * times[i] / 24);
    }
    if (sx === 0 && sy === 0) return NaN;
    return ((Math.atan2(sy, sx) / TAU) * 24 + 24) % 24;
  }
  function circularDiff(a, b, period = 24) {
    let d = (a - b) % period;
    if (d > period / 2) d -= period;
    if (d < -period / 2) d += period;
    return d;
  }
  function inCircularWindow(t, start, end, period = 24) {
    const p = ((t % period) + period) % period;
    const s = ((start % period) + period) % period;
    const e = ((end % period) + period) % period;
    if (s === e) return true;
    return s < e ? (p >= s && p < e) : (p >= s || p < e);
  }

  /* ============================ date / time ============================ */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parseDateTime(str) {
    if (!str) return null;
    if (str instanceof Date) return isNaN(str) ? null : str;
    const s = String(str).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?)?/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
    if (m) {
      let yr = +m[3];
      if (yr < 100) yr += yr >= 70 ? 1900 : 2000;
      // Default to day-first (UK / TriKinetics style); swap if month > 12.
      let d = +m[1], mo = +m[2];
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      return new Date(yr, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
    if (m) {
      const mo = MONTHS.findIndex((x) => m[2].toLowerCase().startsWith(x.toLowerCase()));
      if (mo >= 0) {
        let yr = +m[3];
        if (yr < 100) yr += 2000;
        return new Date(yr, mo, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      }
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const pad2 = (v) => String(v).padStart(2, '0');
  function formatDateTime(d) {
    if (!d) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function formatClock(hours) {
    if (!isNum(hours)) return '—';
    const h = ((hours % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    if (mm === 60) return `${pad2((hh + 1) % 24)}:00`;
    return `${pad2(hh)}:${pad2(mm)}`;
  }
  function parseClock(str, fallback = 8) {
    if (str === null || str === undefined || str === '') return fallback;
    const m = /^(\d{1,2})(?::(\d{1,2}))?/.exec(String(str).trim());
    if (!m) return fallback;
    return clamp(+m[1] + (+(m[2] || 0)) / 60, 0, 24);
  }
  function fmtNum(v, digits = 2) {
    if (!isNum(v)) return '—';
    if (Math.abs(v) >= 1e6 || (Math.abs(v) > 0 && Math.abs(v) < 1e-4)) return v.toExponential(2);
    return v.toFixed(digits);
  }
  function fmtP(p) {
    if (!isNum(p)) return '—';
    if (p < 0.0001) return '< 0.0001';
    return p.toFixed(4);
  }

  /* ============================ CSV ============================ */
  function csvParse(text, delimiter) {
    if (typeof text !== 'string') return { rows: [], delimiter: ',' };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let delim = delimiter;
    if (!delim) {
      const first = text.slice(0, Math.min(text.length, 5000)).split(/\r?\n/).find((l) => l.trim());
      if (first) {
        const counts = [[',', (first.match(/,/g) || []).length], ['\t', (first.match(/\t/g) || []).length], [';', (first.match(/;/g) || []).length]];
        counts.sort((a, b) => b[1] - a[1]);
        delim = counts[0][1] > 0 ? counts[0][0] : ',';
      } else delim = ',';
    }
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((c) => c.trim().length > 0)) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
    }
    return { rows, delimiter: delim };
  }

  function csvStringify(headers, rows) {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number' && !Number.isFinite(v)) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const r of rows) lines.push(r.map(esc).join(','));
    return lines.join('\n');
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const downloadText = (text, filename, mime) => downloadBlob(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), filename);

  /* ============================ palette ============================ */
  const palette = [
    '#3F6078', '#A45A52', '#5E8C61', '#8A6FA8',
    '#B08D57', '#4F8A8B', '#7A6A5A', '#C17C74',
    '#6C7A89', '#7D8F5A', '#9B6A8F', '#4E7F9E'
  ];
  const paletteNames = ['slate', 'terracotta', 'sage', 'mauve', 'ochre', 'teal', 'umber', 'rose',
    'steel', 'olive', 'plum', 'denim'];
  const groupColor = (i) => palette[i % palette.length];

  /* ============================ misc ============================ */
  function groupBy(arr, keyFn) {
    const m = new Map();
    for (const v of arr) {
      const k = keyFn(v);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    return m;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function mode(values) {
    const m = countBy(values.filter((v) => v !== null && v !== undefined && v !== ''));
    let best = null, bestN = -1;
    for (const [k, n] of m) if (n > bestN) { best = k; bestN = n; }
    return best;
  }

  global.Core = {
    VERSION, TAU, MONTHS,
    isNum, clamp, safeDiv, sum, nValid, valid, mean, variance, sd, sem, median, quantile, iqr,
    min, max, range, unique, countBy, cumsum, diff, rank, groupBy, mode,
    gammaLn, regularizedGammaP, regularizedGammaQ, chiSquareCdf, chiSquareSf, chiSquareQuantile,
    normalCdf, normalQuantile, incompleteBeta, tCdf, tSf, tQuantile, fCdf, fSf,
    linearRegression, detrend, pearson,
    movingAverage, movingAverageCircular, circularMeanTime, circularDiff, inCircularWindow,
    parseDateTime, formatDateTime, formatClock, parseClock, pad2, fmtNum, fmtP,
    csvParse, csvStringify, hashString, downloadBlob, downloadText,
    palette, paletteNames, groupColor, sleep
  };
})(window);
