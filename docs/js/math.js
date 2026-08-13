/* ============================================================================
 * math.js — numerical & distribution utilities
 * Gamma, chi-square and normal distributions plus basic stats helpers.
 * Exposed globally as window.ZMath.
 * ==========================================================================*/
window.ZMath = (function () {
  'use strict';

  /* ---------------- Log gamma (Lanczos) ---------------- */
  const G = 7;
  const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];

  function gammaLn(x) {
    if (x < 0.5) {
      return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - gammaLn(1 - x);
    }
    x -= 1;
    let a = LANCZOS[0];
    const t = x + G + 0.5;
    for (let i = 1; i < G + 2; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  /* ------- Regularized lower incomplete gamma P(a, x) ------- */
  function regularizedGammaP(a, x) {
    if (x < 0 || a <= 0) return NaN;
    if (x === 0) return 0;
    if (x < a + 1) {
      // series representation
      let term = 1 / a;
      let sum = term;
      let ap = a;
      for (let n = 1; n < 1000; n++) {
        ap += 1;
        term *= x / ap;
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a));
    }
    // continued fraction representation
    const EPS = 1e-14;
    let b = x + 1 - a;
    let c = 1e300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < EPS) d = EPS;
      c = b + an / c;
      if (Math.abs(c) < EPS) c = EPS;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
  }

  /* ---------------- Chi-square ---------------- */
  function chiSquareCdf(x, df) {
    if (x <= 0) return 0;
    return regularizedGammaP(df / 2, x / 2);
  }
  function chiSquareSurvival(x, df) {
    return 1 - chiSquareCdf(x, df);
  }
  function chiSquareQuantile(p, df) {
    if (p <= 0) return 0;
    if (p >= 1) return Infinity;
    let lo = 0;
    let hi = 10000;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      if (chiSquareCdf(mid, df) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------------- Normal ---------------- */
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
      a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
    return sign * y;
  }
  function normalCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
  }
  // Acklam's algorithm for the inverse normal CDF
  function normalQuantile(p) {
    const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
      1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
    const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
      6.680131188771972e1, -1.328068155288572e1];
    const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
      -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
    const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
      3.754408661907416e0];
    const PLOW = 0.02425, PHIGH = 1 - PLOW;
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    let x;
    if (p < PLOW) {
      const q = Math.sqrt(-2 * Math.log(p));
      x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    } else if (p <= PHIGH) {
      const q = p - 0.5;
      const r = q * q;
      x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
        (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    }
    // one Halley refinement step
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  /* ---------------- Basic statistics ---------------- */
  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function variance(a) {
    const m = mean(a);
    return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
  }
  function sd(a) { return Math.sqrt(variance(a)); }
  function median(a) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const n = s.length;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return s[base] + (base + 1 < s.length ? rest * (s[base + 1] - s[base]) : 0);
  }
  function sum(a) { return a.reduce((s, v) => s + v, 0); }
  // loop-based (never spread) so very large arrays don't overflow the call stack
  function min(a) {
    let m = Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  }
  function max(a) {
    let m = -Infinity;
    for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
    return m;
  }
  // average ranks with ties
  function rank(arr) {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(arr.length);
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

  return {
    gammaLn, regularizedGammaP,
    chiSquareCdf, chiSquareSurvival, chiSquareQuantile,
    normalCdf, normalQuantile,
    mean, variance, sd, median, quantile, sum, min, max, rank
  };
})();
