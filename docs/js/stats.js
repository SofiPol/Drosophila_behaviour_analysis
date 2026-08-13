/* ============================================================================
 * stats.js — statistical hypothesis tests
 *   - Shapiro-Wilk normality test (exact port of scipy.stats.shapiro)
 *   - Wilcoxon rank-sum / Mann-Whitney U (normal approximation)
 *   - Kruskal-Wallis H test
 *   - Dunn's post-hoc test with Bonferroni adjustment
 * Exposed globally as window.ZStats.
 * ==========================================================================*/
window.ZStats = (function () {
  'use strict';

  const M = window.ZMath;

  /* -------------------------------------------------------------
   * Shapiro-Wilk test
   * Ported from scipy.stats.shapiro (_swilk), scipy/stats/_morestats.py
   * -----------------------------------------------------------*/
  function swilkW(y, a) {
    // W = (a·y)^2 / Σ(y_i - mean)^2
    let num = 0;
    for (let i = 0; i < y.length; i++) num += a[i] * y[i];
    num *= num;
    const m = M.mean(y);
    let den = 0;
    for (let i = 0; i < y.length; i++) den += (y[i] - m) * (y[i] - m);
    return num / den;
  }

  // y must already be sorted
  function swilk(y) {
    const n = y.length;

    if (n === 3) {
      const c = Math.SQRT2 / 2;
      const a = [-c, 0, c];
      const W = Math.min(Math.max(swilkW(y, a), 0.75), 1);
      const pvalue = Math.min(Math.max(1 - (6 / Math.PI) * Math.acos(Math.sqrt(W)), 0), 1);
      return { W, p: pvalue };
    }

    const m = new Array(n);
    for (let i = 0; i < n; i++) {
      m[i] = M.normalQuantile((i + 1 - 3 / 8) / (n + 1 / 4));
    }
    const u = Math.pow(n, -0.5);
    let mTm = 0;
    for (let i = 0; i < n; i++) mTm += m[i] * m[i];

    const cArr = m.map((v) => v / Math.sqrt(mTm));
    const mn = m[n - 1];
    const mnm1 = m[n - 2];
    const cn = cArr[n - 1];
    const cnm1 = cArr[n - 2];

    const an = cn + 0.221157 * u - 0.147981 * u * u - 2.071190 * u * u * u +
      4.434685 * Math.pow(u, 4) - 2.706056 * Math.pow(u, 5);
    const anm1 = cnm1 + 0.042981 * u - 0.293762 * u * u - 1.752461 * u * u * u +
      5.682633 * Math.pow(u, 4) - 3.582633 * Math.pow(u, 5);

    const phi = n <= 5
      ? (mTm - 2 * mn * mn) / (1 - 2 * an * an)
      : (mTm - 2 * mn * mn - 2 * mnm1 * mnm1) / (1 - 2 * an * an - 2 * anm1 * anm1);

    const a = m.map((v) => v / Math.sqrt(phi));
    if (n > 5) {
      a[1] = -anm1;
      a[n - 2] = anm1;
    }
    a[0] = -an;
    a[n - 1] = an;

    const W = swilkW(y, a);

    // p-value (Royston 1993, Table 1)
    let gW, mu, sigma;
    if (n <= 11) {
      const un = n;
      const gamma = -2.273 + 0.459 * un;
      mu = 0.5440 - 0.39978 * un + 0.025054 * un * un - 0.0006714 * Math.pow(un, 3);
      sigma = Math.exp(1.3822 - 0.77857 * un + 0.062767 * un * un - 0.0020322 * Math.pow(un, 3));
      gW = -Math.log(gamma - Math.log(1 - W));
    } else {
      const un = Math.log(n);
      mu = -1.5861 - 0.31082 * un - 0.083751 * un * un + 0.0038915 * Math.pow(un, 3);
      sigma = Math.exp(-0.4803 - 0.082676 * un + 0.0030302 * un * un);
      gW = Math.log(1 - W);
    }
    const z = (gW - mu) / sigma;
    const p = M.normalCdf(-z);
    return { W, p };
  }

  function shapiroWilk(data) {
    const x = [...data];
    if (x.length < 3) return { W: NaN, p: NaN };
    x.sort((a, b) => a - b);
    // subtract median for numerical stability (as scipy does)
    const med = x[Math.floor(x.length / 2)];
    for (let i = 0; i < x.length; i++) x[i] -= med;
    return swilk(x);
  }

  /* -------------------------------------------------------------
   * Wilcoxon rank-sum (Mann-Whitney U), normal approximation
   * -----------------------------------------------------------*/
  function wilcoxonRankSum(a, b) {
    const n1 = a.length;
    const n2 = b.length;
    if (!n1 || !n2) return { U: NaN, z: NaN, p: NaN };

    const all = a.map((v) => ({ v, g: 0 })).concat(b.map((v) => ({ v, g: 1 })));
    all.sort((x, y) => x.v - y.v);

    // average ranks
    const ranks = new Array(all.length);
    let i = 0;
    while (i < all.length) {
      let j = i;
      while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[k] = avg;
      i = j + 1;
    }

    let r1 = 0;
    for (let k = 0; k < all.length; k++) if (all[k].g === 0) r1 += ranks[k];

    const U1 = r1 - n1 * (n1 + 1) / 2;
    const U = U1; // statistic for sample a

    const mu = n1 * n2 / 2;
    // variance with tie correction
    let tieSum = 0;
    {
      let t = 1;
      for (let k = 1; k <= all.length; k++) {
        if (k < all.length && all[k].v === all[k - 1].v) { t++; continue; }
        tieSum += (t * t * t - t) / (all.length * (all.length - 1));
        t = 1;
      }
    }
    const varU = n1 * n2 / 12 * ((all.length + 1) - tieSum);
    let z;
    if (varU <= 0) {
      z = 0;
    } else {
      z = (U - mu) / Math.sqrt(varU);
    }
    const p = 2 * (1 - M.normalCdf(Math.abs(z)));
    return { U, z, p };
  }

  /* -------------------------------------------------------------
   * Kruskal-Wallis H test
   * -----------------------------------------------------------*/
  function kruskalWallis(groups) {
    const k = groups.length;
    const ns = groups.map((g) => g.length);
    if (ns.some((n) => n === 0)) return { H: NaN, df: NaN, p: NaN };

    const all = [];
    groups.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
    all.sort((x, y) => x.v - y.v);

    const ranks = new Array(all.length);
    let i = 0;
    while (i < all.length) {
      let j = i;
      while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[k] = avg;
      i = j + 1;
    }

    const N = all.length;
    const sumRanks = new Array(k).fill(0);
    for (let idx = 0; idx < all.length; idx++) sumRanks[all[idx].gi] += ranks[idx];

    let H = (12 / (N * (N + 1))) * sumRanks.reduce((s, R, gi) => s + R * R / ns[gi], 0) -
      3 * (N + 1);

    // tie correction
    let tieSum = 0;
    {
      let t = 1;
      for (let k = 1; k <= all.length; k++) {
        if (k < all.length && all[k].v === all[k - 1].v) { t++; continue; }
        tieSum += t * t * t - t;
        t = 1;
      }
    }
    const C = 1 - tieSum / (N * N * N - N);
    if (C > 0) H /= C;

    const df = k - 1;
    const p = 1 - M.chiSquareCdf(H, df);
    return { H, df, p, sumRanks };
  }

  /* -------------------------------------------------------------
   * Dunn's post-hoc test with Bonferroni adjustment
   * -----------------------------------------------------------*/
  function dunnTest(groups, labels) {
    const k = groups.length;
    const ns = groups.map((g) => g.length);
    const all = [];
    groups.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
    all.sort((x, y) => x.v - y.v);
    const ranks = new Array(all.length);
    let i = 0;
    while (i < all.length) {
      let j = i;
      while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[k] = avg;
      i = j + 1;
    }
    const N = all.length;
    const sumRanks = new Array(k).fill(0);
    for (let idx = 0; idx < all.length; idx++) sumRanks[all[idx].gi] += ranks[idx];
    const meanRanks = sumRanks.map((R, gi) => R / ns[gi]);

    // tie variance
    let tieSum = 0;
    {
      let t = 1;
      for (let k = 1; k <= all.length; k++) {
        if (k < all.length && all[k].v === all[k - 1].v) { t++; continue; }
        tieSum += t * t * t - t;
        t = 1;
      }
    }
    const tieCorr = tieSum / (N * (N - 1));

    const pairs = [];
    const comparisons = [];
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const pooled = N * (N + 1) / 12 - tieCorr * N * (N + 1) / 12 * 0; // base
        const se = Math.sqrt(((N * (N + 1)) / 12 - tieSum / (12 * (N - 1))) *
          (1 / ns[a] + 1 / ns[b]));
        const z = (meanRanks[a] - meanRanks[b]) / se;
        const pRaw = 2 * (1 - M.normalCdf(Math.abs(z)));
        comparisons.push({ a, b, z, pRaw });
        pairs.push([labels[a], labels[b]]);
      }
    }
    const nPairs = comparisons.length;
    comparisons.forEach((c) => {
      c.pAdj = Math.min(c.pRaw * nPairs, 1);
    });
    return { comparisons, pairs, meanRanks };
  }

  return {
    shapiroWilk,
    wilcoxonRankSum,
    kruskalWallis,
    dunnTest
  };
})();
