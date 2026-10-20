/* ============================================================================
 * stats.js — hypothesis tests, effect sizes and multiple-comparison control
 * Exposed as window.StatTests
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;

  /* ============================ descriptive ============================ */
  function describe(values) {
    const x = C.valid(values);
    const n = x.length;
    return {
      n,
      mean: n ? C.mean(x) : NaN,
      sd: n > 1 ? C.sd(x) : NaN,
      sem: n > 1 ? C.sem(x) : NaN,
      median: n ? C.median(x) : NaN,
      q1: n ? C.quantile(x, 0.25) : NaN,
      q3: n ? C.quantile(x, 0.75) : NaN,
      iqr: n ? C.iqr(x) : NaN,
      min: n ? C.min(x) : NaN,
      max: n ? C.max(x) : NaN
    };
  }

  /* ============================ Shapiro-Wilk ============================ */
  function swilkW(y, a) {
    let num = 0;
    for (let i = 0; i < y.length; i++) num += a[i] * y[i];
    num *= num;
    const m = C.mean(y);
    let den = 0;
    for (let i = 0; i < y.length; i++) den += (y[i] - m) ** 2;
    return den > 0 ? num / den : NaN;
  }
  function swilk(y) {
    const n = y.length;
    if (n === 3) {
      const c = Math.SQRT2 / 2;
      const a = [-c, 0, c];
      const W = C.clamp(swilkW(y, a), 0.75, 1);
      const p = C.clamp(1 - (6 / Math.PI) * Math.acos(Math.sqrt(W)), 0, 1);
      return { W, p };
    }
    const m = new Array(n);
    for (let i = 0; i < n; i++) m[i] = C.normalQuantile((i + 1 - 3 / 8) / (n + 1 / 4));
    const u = Math.pow(n, -0.5);
    let mTm = 0;
    for (let i = 0; i < n; i++) mTm += m[i] * m[i];
    const cArr = m.map((v) => v / Math.sqrt(mTm));
    const mn = m[n - 1], mnm1 = m[n - 2];
    const cn = cArr[n - 1], cnm1 = cArr[n - 2];
    const an = cn + 0.221157 * u - 0.147981 * u * u - 2.071190 * u ** 3 + 4.434685 * u ** 4 - 2.706056 * u ** 5;
    const anm1 = cnm1 + 0.042981 * u - 0.293762 * u * u - 1.752461 * u ** 3 + 5.682633 * u ** 4 - 3.582633 * u ** 5;
    const phi = n <= 5
      ? (mTm - 2 * mn * mn) / (1 - 2 * an * an)
      : (mTm - 2 * mn * mn - 2 * mnm1 * mnm1) / (1 - 2 * an * an - 2 * anm1 * anm1);
    const a = m.map((v) => v / Math.sqrt(phi));
    if (n > 5) { a[1] = -anm1; a[n - 2] = anm1; }
    a[0] = -an; a[n - 1] = an;
    const W = swilkW(y, a);
    let gW, mu, sigma;
    if (n <= 11) {
      const un = n;
      const gamma = -2.273 + 0.459 * un;
      mu = 0.5440 - 0.39978 * un + 0.025054 * un * un - 0.0006714 * un ** 3;
      sigma = Math.exp(1.3822 - 0.77857 * un + 0.062767 * un * un - 0.0020322 * un ** 3);
      gW = -Math.log(gamma - Math.log(1 - W));
    } else {
      const un = Math.log(n);
      mu = -1.5861 - 0.31082 * un - 0.083751 * un * un + 0.0038915 * un ** 3;
      sigma = Math.exp(-0.4803 - 0.082676 * un + 0.0030302 * un * un);
      gW = Math.log(1 - W);
    }
    const z = (gW - mu) / sigma;
    return { W, p: C.normalCdf(-z) };
  }
  function shapiroWilk(data) {
    const x = C.valid(data);
    if (x.length < 3 || x.length > 5000) return { W: NaN, p: NaN, n: x.length };
    const sorted = [...x].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    for (let i = 0; i < sorted.length; i++) sorted[i] -= med;
    const r = swilk(sorted);
    return { W: r.W, p: r.p, n: x.length };
  }

  /* ============================ t-tests ============================ */
  function tTest(a, b, equalVar = false) {
    const x = C.valid(a), y = C.valid(b);
    const n1 = x.length, n2 = y.length;
    if (n1 < 2 || n2 < 2) return { test: equalVar ? 'Student t' : 'Welch t', t: NaN, df: NaN, p: NaN, meanDiff: NaN, ci95: NaN, d: NaN, n1, n2 };
    const m1 = C.mean(x), m2 = C.mean(y);
    const v1 = C.variance(x), v2 = C.variance(y);
    const diff = m1 - m2;
    let se, df;
    if (equalVar) {
      const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
      df = n1 + n2 - 2;
    } else {
      se = Math.sqrt(v1 / n1 + v2 / n2);
      df = (v1 / n1 + v2 / n2) ** 2 /
        ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
    }
    const t = se > 0 ? diff / se : NaN;
    const p = C.tSf(Math.abs(t), df) * 2;
    const tcrit = C.tQuantile(0.975, df);
    const pooled = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / Math.max(1, n1 + n2 - 2));
    return {
      test: equalVar ? 'Student t' : 'Welch t',
      t, df, p, meanDiff: diff,
      ci95: tcrit * se,
      ciLow: diff - tcrit * se,
      ciHigh: diff + tcrit * se,
      d: pooled > 0 ? diff / pooled : NaN,
      n1, n2, mean1: m1, mean2: m2, sd1: Math.sqrt(v1), sd2: Math.sqrt(v2)
    };
  }

  function pairedTTest(a, b) {
    const x = [], y = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (C.isNum(a[i]) && C.isNum(b[i])) { x.push(a[i]); y.push(b[i]); }
    const d = x.map((v, i) => v - y[i]);
    const nD = d.length;
    if (nD < 2) return { t: NaN, df: NaN, p: NaN, meanDiff: NaN, ci95: NaN, d: NaN, n: nD };
    const md = C.mean(d), sdd = C.sd(d);
    const se = sdd / Math.sqrt(nD);
    const t = se > 0 ? md / se : NaN;
    const df = nD - 1;
    const tc = C.tQuantile(0.975, df);
    return { t, df, p: 2 * C.tSf(Math.abs(t), df), meanDiff: md, ci95: tc * se, d: md / sdd, n: nD };
  }

  /* ============================ ANOVA ============================ */
  function anovaOneWay(groups, labels) {
    const gs = groups.map((g) => C.valid(g)).filter((g) => g.length > 0);
    const k = gs.length;
    const N = gs.reduce((s, g) => s + g.length, 0);
    if (k < 2 || N <= k) return { F: NaN, df1: k - 1, df2: N - k, p: NaN, eta2: NaN };
    const grand = C.mean(gs.flat());
    let ssb = 0, ssw = 0;
    const means = [];
    for (const g of gs) {
      const m = C.mean(g);
      means.push(m);
      ssb += g.length * (m - grand) ** 2;
      for (const v of g) ssw += (v - m) ** 2;
    }
    const df1 = k - 1, df2 = N - k;
    const msb = ssb / df1, msw = ssw / df2;
    const F = msw > 0 ? msb / msw : NaN;
    return {
      F, df1, df2, p: C.fSf(F, df1, df2),
      eta2: ssb + ssw > 0 ? ssb / (ssb + ssw) : NaN,
      means, labels: labels || gs.map((_, i) => 'G' + (i + 1)),
      grandMean: grand, ssb, ssw, n: N
    };
  }

  function pairwiseT(groups, labels, correction = 'holm') {
    const out = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const r = tTest(groups[i], groups[j], false);
        out.push({
          a: labels[i], b: labels[j],
          meanA: r.mean1, meanB: r.mean2,
          diff: r.meanDiff, t: r.t, df: r.df, p: r.p, d: r.d
        });
      }
    }
    const ps = out.map((r) => r.p);
    const adj = correction === 'holm' ? holm(ps) : correction === 'bh' ? bh(ps) : bonferroni(ps);
    out.forEach((r, i) => { r.pAdj = adj[i]; });
    return out;
  }

  /* ============================ rank tests ============================ */
  function mannWhitney(a, b) {
    const x = C.valid(a), y = C.valid(b);
    const n1 = x.length, n2 = y.length;
    if (!n1 || !n2) return { U: NaN, z: NaN, p: NaN, rankBiserial: NaN, n1, n2 };
    const all = x.map((v) => ({ v, g: 0 })).concat(y.map((v) => ({ v, g: 1 })));
    all.sort((p, r) => p.v - r.v);
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
    const U = U1;
    const mu = n1 * n2 / 2;
    let tieSum = 0;
    let t = 1;
    for (let k = 1; k <= all.length; k++) {
      if (k < all.length && all[k].v === all[k - 1].v) { t++; continue; }
      tieSum += (t ** 3 - t) / (all.length * (all.length - 1));
      t = 1;
    }
    const varU = n1 * n2 / 12 * ((all.length + 1) - tieSum);
    const z = varU > 0 ? (U - mu) / Math.sqrt(varU) : 0;
    const p = 2 * C.normalCdf(-Math.abs(z));
    return {
      U, z, p,
      rankBiserial: 2 * U / (n1 * n2) - 1,
      n1, n2,
      median1: C.median(x), median2: C.median(y)
    };
  }

  function kruskalWallis(groups) {
    const gs = groups.map((g) => C.valid(g));
    const k = gs.length;
    const ns = gs.map((g) => g.length);
    if (k < 2 || ns.some((n) => n === 0)) return { H: NaN, df: NaN, p: NaN };
    const all = [];
    gs.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
    all.sort((x, y) => x.v - y.v);
    const ranks = new Array(all.length);
    let i = 0;
    while (i < all.length) {
      let j = i;
      while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let q = i; q <= j; q++) ranks[q] = avg;
      i = j + 1;
    }
    const N = all.length;
    const sumRanks = new Array(k).fill(0);
    for (let idx = 0; idx < all.length; idx++) sumRanks[all[idx].gi] += ranks[idx];
    let H = (12 / (N * (N + 1))) * sumRanks.reduce((s, R, gi) => s + R * R / ns[gi], 0) - 3 * (N + 1);
    let tieSum = 0;
    let t = 1;
    for (let q = 1; q <= all.length; q++) {
      if (q < all.length && all[q].v === all[q - 1].v) { t++; continue; }
      tieSum += t ** 3 - t;
      t = 1;
    }
    const Ccorr = 1 - tieSum / (N ** 3 - N);
    if (Ccorr > 0) H /= Ccorr;
    const df = k - 1;
    return { H, df, p: C.chiSquareSf(H, df), sumRanks, n: N };
  }

  function dunnTest(groups, labels, correction = 'bonferroni') {
    const gs = groups.map((g) => C.valid(g));
    const k = gs.length;
    const ns = gs.map((g) => g.length);
    const all = [];
    gs.forEach((g, gi) => g.forEach((v) => all.push({ v, gi })));
    all.sort((x, y) => x.v - y.v);
    const ranks = new Array(all.length);
    let i = 0;
    while (i < all.length) {
      let j = i;
      while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let q = i; q <= j; q++) ranks[q] = avg;
      i = j + 1;
    }
    const N = all.length;
    const sumRanks = new Array(k).fill(0);
    for (let idx = 0; idx < all.length; idx++) sumRanks[all[idx].gi] += ranks[idx];
    const meanRanks = sumRanks.map((R, gi) => R / ns[gi]);
    let tieSum = 0;
    let t = 1;
    for (let q = 1; q <= all.length; q++) {
      if (q < all.length && all[q].v === all[q - 1].v) { t++; continue; }
      tieSum += t ** 3 - t;
      t = 1;
    }
    const variance = (N * (N + 1) / 12) - tieSum / (12 * (N - 1));
    const comps = [];
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const se = Math.sqrt(variance * (1 / ns[a] + 1 / ns[b]));
        const z = se > 0 ? (meanRanks[a] - meanRanks[b]) / se : NaN;
        const pRaw = 2 * C.normalCdf(-Math.abs(z));
        comps.push({ a, b, z, pRaw, labelA: labels[a], labelB: labels[b], meanRankA: meanRanks[a], meanRankB: meanRanks[b] });
      }
    }
    const ps = comps.map((c) => c.pRaw);
    const adj = correction === 'holm' ? holm(ps) : correction === 'bh' ? bh(ps) : ps.map((p) => Math.min(1, p * comps.length));
    comps.forEach((c, idx) => { c.pAdj = adj[idx]; });
    return { comparisons: comps, meanRanks, correction };
  }

  /* ============================ categorical tests ============================ */
  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return C.gammaLn(n + 1) - C.gammaLn(k + 1) - C.gammaLn(n - k + 1);
  }
  function hypergeomPmf(k, N, K, n) {
    const denom = logChoose(N, n);
    const num = logChoose(K, k) + logChoose(N - K, n - k);
    return Math.exp(num - denom);
  }
  function fisherExact(a, b, c, d) {
    // 2x2 table [[a,b],[c,d]]
    const row1 = a + b, row2 = c + d, col1 = a + c, col2 = b + d;
    const N = row1 + row2;
    const lo = Math.max(0, col1 - row2);
    const hi = Math.min(row1, col1);
    const obs = hypergeomPmf(a, N, col1, row1);
    let pTwo = 0;
    const probs = [];
    for (let k = lo; k <= hi; k++) {
      const p = hypergeomPmf(k, N, col1, row1);
      probs.push(p);
      if (p <= obs * (1 + 1e-9)) pTwo += p;
    }
    return {
      p: Math.min(1, pTwo),
      oddsRatio: b * c > 0 ? (a * d) / (b * c) : (a * d > 0 ? Infinity : NaN),
      table: [[a, b], [c, d]], expected: [
        [row1 * col1 / N, row1 * col2 / N],
        [row2 * col1 / N, row2 * col2 / N]
      ]
    };
  }
  function chiSquareTest(matrix) {
    const rows = matrix.length, cols = matrix[0] ? matrix[0].length : 0;
    if (rows < 2 || cols < 2) return { chi2: NaN, df: NaN, p: NaN, cramersV: NaN };
    const rowSums = matrix.map((r) => C.sum(r));
    const colSums = new Array(cols).fill(0);
    let N = 0;
    for (let i = 0; i < rows; i++) {
      N += rowSums[i];
      for (let j = 0; j < cols; j++) colSums[j] += matrix[i][j];
    }
    let chi2 = 0, minExp = Infinity;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const e = rowSums[i] * colSums[j] / N;
        minExp = Math.min(minExp, e);
        if (e > 0) chi2 += (matrix[i][j] - e) ** 2 / e;
      }
    }
    const df = (rows - 1) * (cols - 1);
    return {
      chi2, df, p: C.chiSquareSf(chi2, df),
      cramersV: N > 0 ? Math.sqrt(chi2 / (N * Math.min(rows - 1, cols - 1))) : NaN,
      minExpected: minExp,
      warning: minExp < 5 ? 'Some expected counts are below 5; interpret the chi-square approximation cautiously (Fisher exact is exact for 2×2).' : ''
    };
  }

  /* ============================ corrections ============================ */
  function holm(ps) {
    const idx = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const out = new Array(ps.length);
    let running = 0;
    const m = ps.length;
    idx.forEach((o, rank) => {
      const adj = Math.min(1, (m - rank) * o.p);
      running = Math.max(running, adj);
      out[o.i] = running;
    });
    return out;
  }
  function bh(ps) {
    const idx = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const out = new Array(ps.length);
    const m = ps.length;
    let running = 1;
    for (let rank = m - 1; rank >= 0; rank--) {
      const o = idx[rank];
      const adj = Math.min(1, o.p * m / (rank + 1));
      running = Math.min(running, adj);
      out[o.i] = running;
    }
    return out;
  }
  const bonferroni = (ps) => ps.map((p) => Math.min(1, p * ps.length));

  /* ============================ profile comparisons ============================ */
  function profilePermutationTest(groupA, groupB, permutations = 1000, seed = 42) {
    // groupA/groupB: arrays (animals) of arrays (bins), same length.
    const nA = groupA.length, nB = groupB.length;
    const nBins = Math.min(...groupA.concat(groupB).map((x) => x.length));
    if (!nA || !nB || nBins < 2) return { p: NaN, observed: NaN, nA, nB, nBins };
    const meansA = new Array(nBins).fill(0), meansB = new Array(nBins).fill(0);
    const countsA = new Array(nBins).fill(0), countsB = new Array(nBins).fill(0);
    for (const row of groupA) for (let b = 0; b < nBins; b++) if (C.isNum(row[b])) { meansA[b] += row[b]; countsA[b]++; }
    for (const row of groupB) for (let b = 0; b < nBins; b++) if (C.isNum(row[b])) { meansB[b] += row[b]; countsB[b]++; }
    for (let b = 0; b < nBins; b++) {
      meansA[b] = countsA[b] ? meansA[b] / countsA[b] : NaN;
      meansB[b] = countsB[b] ? meansB[b] / countsB[b] : NaN;
    }
    const stat = (ma, mb) => {
      let s = 0;
      for (let b = 0; b < nBins; b++) {
        if (C.isNum(ma[b]) && C.isNum(mb[b])) s += (ma[b] - mb[b]) ** 2;
      }
      return s;
    };
    const observed = stat(meansA, meansB);
    let rngState = seed >>> 0;
    const rng = () => {
      rngState = (1664525 * rngState + 1013904223) >>> 0;
      return rngState / 4294967296;
    };
    const all = groupA.concat(groupB);
    const labels = all.map((_, i) => i < nA ? 0 : 1);
    let ge = 0;
    for (let p = 0; p < permutations; p++) {
      // Fisher-Yates shuffle of labels
      for (let i = labels.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = labels[i]; labels[i] = labels[j]; labels[j] = t;
      }
      const aMeans = new Array(nBins).fill(0), bMeans = new Array(nBins).fill(0);
      const aN = new Array(nBins).fill(0), bN = new Array(nBins).fill(0);
      for (let i = 0; i < all.length; i++) {
        const row = all[i];
        if (labels[i] === 0) {
          for (let b = 0; b < nBins; b++) if (C.isNum(row[b])) { aMeans[b] += row[b]; aN[b]++; }
        } else {
          for (let b = 0; b < nBins; b++) if (C.isNum(row[b])) { bMeans[b] += row[b]; bN[b]++; }
        }
      }
      for (let b = 0; b < nBins; b++) {
        aMeans[b] = aN[b] ? aMeans[b] / aN[b] : NaN;
        bMeans[b] = bN[b] ? bMeans[b] / bN[b] : NaN;
      }
      if (stat(aMeans, bMeans) >= observed - 1e-12) ge++;
    }
    return { p: (ge + 1) / (permutations + 1), observed, nA, nB, nBins, permutations };
  }

  function profileBinTests(groupA, groupB) {
    const nBins = Math.min(...groupA.concat(groupB).map((x) => x.length));
    const rows = [];
    for (let b = 0; b < nBins; b++) {
      const a = groupA.map((r) => r[b]);
      const bb = groupB.map((r) => r[b]);
      const r = tTest(a, bb, false);
      rows.push({ bin: b, meanA: r.mean1, meanB: r.mean2, diff: r.meanDiff, t: r.t, p: r.p });
    }
    const adj = bh(rows.map((r) => C.isNum(r.p) ? r.p : 1));
    rows.forEach((r, i) => { r.pAdj = adj[i]; });
    return rows;
  }

  /* ============================ summary helper ============================ */
  function compareGroups(valuesByGroup, labels, opts = {}) {
    const groups = labels.map((g) => C.valid(valuesByGroup[g] || []));
    const desc = labels.map((g, i) => Object.assign({ group: g }, describe(groups[i])));
    const out = { descriptive: desc };
    if (groups.length === 2 && groups.every((g) => g.length >= 2)) {
      out.welch = tTest(groups[0], groups[1], false);
      out.student = tTest(groups[0], groups[1], true);
      out.mannWhitney = mannWhitney(groups[0], groups[1]);
    } else if (groups.length > 2) {
      out.anova = anovaOneWay(groups, labels);
      out.kruskal = kruskalWallis(groups);
      out.dunn = dunnTest(groups, labels, opts.dunnCorrection || 'bonferroni');
      out.pairwiseWelch = pairwiseT(groups, labels, opts.tCorrection || 'holm');
    }
    out.shapiro = labels.map((g, i) => Object.assign({ group: g }, shapiroWilk(groups[i])));
    return out;
  }

  global.StatTests = {
    describe, shapiroWilk, tTest, pairedTTest, anovaOneWay, pairwiseT,
    mannWhitney, kruskalWallis, dunnTest, fisherExact, chiSquareTest,
    holm, bh, bonferroni, profilePermutationTest, profileBinTests, compareGroups
  };
})(window);
