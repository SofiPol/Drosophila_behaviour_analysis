/* ============================================================================
 * circadian.js — periodograms, rhythmicity and phase estimation
 * Implements Sokolove & Bushell (1978), Lomb-Scargle (1976/1982),
 * autocorrelation (Levine et al. 2002), FFT, cosinor and onset regression.
 * Exposed as window.CircadianLab
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;
  const I = global.Importers;

  /* ============================ series preparation ============================ */
  function aggregateForPeriodogram(animal, mask, targetBinMin) {
    const srcBin = animal.binMinutes;
    const target = Math.max(srcBin, targetBinMin || 30);
    const n = Math.ceil(animal.activity.length * srcBin / target);
    const values = new Array(n).fill(NaN);
    const counts = new Array(n).fill(0);
    const times = new Array(n);
    for (let b = 0; b < n; b++) times[b] = b * target / 60;
    for (let i = 0; i < animal.activity.length; i++) {
      if (!mask[i]) continue;
      const v = animal.activity[i];
      if (!C.isNum(v)) continue;
      const b = Math.min(n - 1, Math.floor((animal.tHours[i] * 60) / target));
      if (!C.isNum(values[b])) values[b] = 0;
      values[b] += v;
      counts[b]++;
    }
    return { values, times, binMin: target, counts };
  }

  /**
   * Remove leading/trailing missing values and linearly interpolate internal
   * gaps up to maxGapMin. Returns an error if a longer gap remains.
   */
  function cleanSeries(values, binMin, maxGapMin = 60, interpolate = true) {
    let first = 0, last = values.length - 1;
    while (first < values.length && !C.isNum(values[first])) first++;
    while (last >= 0 && !C.isNum(values[last])) last--;
    if (last <= first) return { values: [], start: 0, end: 0, error: 'No usable data in the analysis window.', interpolated: 0 };
    const out = [];
    const times = [];
    let gap = 0;
    let interpolated = 0;
    for (let i = first; i <= last; i++) {
      if (C.isNum(values[i])) {
        out.push(values[i]);
        times.push(i * binMin / 60);
        gap = 0;
      } else {
        gap++;
        if (gap * binMin > maxGapMin || !interpolate) {
          return {
            values: [], start: first, end: last,
            error: `Missing data gap longer than ${maxGapMin} min (${(gap * binMin).toFixed(0)} min).`,
            interpolated
          };
        }
        // linear interpolation between nearest valid neighbours
        let prev = i - 1;
        while (prev >= first && !C.isNum(values[prev])) prev--;
        let next = i + 1;
        while (next <= last && !C.isNum(values[next])) next++;
        if (prev < first || next > last) {
          return { values: [], start: first, end: last, error: 'Missing data at an analysis-window edge.', interpolated };
        }
        const f = (i - prev) / (next - prev);
        out.push(values[prev] + f * (values[next] - values[prev]));
        times.push(i * binMin / 60);
        interpolated++;
      }
    }
    return { values: out, times, start: first, end: last, interpolated, error: null, n: out.length };
  }

  function prepare(animal, mask, targetBinMin, opts = {}) {
    const agg = aggregateForPeriodogram(animal, mask, targetBinMin);
    const clean = cleanSeries(agg.values, agg.binMin, opts.maxGapMin ?? 120, opts.interpolate !== false);
    return Object.assign({}, agg, clean);
  }

  /* ============================ chi-square ============================ */
  /**
   * Sokolove & Bushell chi-square periodogram.
   * Qp = K * N' * Σ_h (M_h - M)^2 / Σ_i (X_i - M)^2
   * where P is the trial period in bins, K = floor(N/P), N' = K*P,
   * M_h are the P column means and M is the grand mean.
   */
  function chiSquare(values, binMin, opts = {}) {
    const minPeriod = opts.minPeriod ?? 16;
    const maxPeriod = opts.maxPeriod ?? 32;
    const step = opts.step ?? 0.1;
    const alpha = opts.alpha ?? 0.05;
    const N = values.length;
    if (N < 8) return { method: 'chi-square', periods: [], qp: [], threshold: [], power: [], error: 'Fewer than 8 bins; periodogram cannot be computed.' };
    const grand = C.mean(values);
    let ssTotal = 0;
    for (let i = 0; i < N; i++) ssTotal += (values[i] - grand) ** 2;
    if (!(ssTotal > 0)) return { method: 'chi-square', periods: [], qp: [], threshold: [], power: [], error: 'Constant series (no variance).' };

    const periods = [], periodBins = [], qp = [], thresholds = [], powers = [], dfs = [], Ks = [], Nps = [];
    let lastP = -1;
    for (let tauH = minPeriod; tauH <= maxPeriod + 1e-9; tauH += step) {
      const P = Math.max(2, Math.round(tauH * 60 / binMin));
      if (P === lastP) continue; // the resolution is one bin; avoid duplicate P
      lastP = P;
      const K = Math.floor(N / P);
      if (K < 2) continue;
      const Np = K * P;
      const Mh = new Array(P).fill(0);
      for (let h = 0; h < P; h++) {
        let s = 0;
        for (let k = 0; k < K; k++) s += values[h + k * P];
        Mh[h] = s / K;
      }
      // grand mean over the used N' points
      let gm = 0;
      for (let i = 0; i < Np; i++) gm += values[i];
      gm /= Np;
      let ssb = 0;
      for (let h = 0; h < P; h++) ssb += (Mh[h] - gm) ** 2;
      let sst = 0;
      for (let i = 0; i < Np; i++) sst += (values[i] - gm) ** 2;
      if (!(sst > 0)) continue;
      const Q = K * Np * ssb / sst;
      const df = P - 1;
      const thr = C.chiSquareQuantile(1 - alpha, df);
      // The true resolution is one bin; store the centre of that bin rather
      // than the first requested grid point (which would bias tau by ~Δ/2).
      periods.push(P * binMin / 60);
      periodBins.push(P);
      qp.push(Q);
      thresholds.push(thr);
      powers.push(Q - thr);
      dfs.push(df);
      Ks.push(K);
      Nps.push(Np);
    }
    if (!periods.length) return { method: 'chi-square', periods: [], qp: [], threshold: [], power: [], error: 'No period with at least 2 complete cycles.' };

    let peakIdx = 0;
    for (let i = 1; i < qp.length; i++) if (qp[i] > qp[peakIdx]) peakIdx = i;
    const peakPeriod = periodBins[peakIdx] * binMin / 60;
    const peakQp = qp[peakIdx];
    const peakThr = thresholds[peakIdx];
    const peakPower = peakQp - peakThr;

    // Peak width at the significance line (contiguous above-threshold region)
    let left = peakIdx, right = peakIdx;
    if (peakQp >= peakThr) {
      while (left > 0 && qp[left - 1] >= thresholds[left - 1]) left--;
      while (right < qp.length - 1 && qp[right + 1] >= thresholds[right + 1]) right++;
    }
    const stepH = binMin / 60;
    const width = peakQp >= peakThr ? (periods[right] - periods[left]) + stepH : 0;

    // Parabolic interpolation around the peak (optional refinement)
    let tau = peakPeriod;
    if (peakIdx > 0 && peakIdx < qp.length - 1) {
      const y0 = qp[peakIdx - 1], y1 = qp[peakIdx], y2 = qp[peakIdx + 1];
      const denom = (y0 - 2 * y1 + y2);
      if (Math.abs(denom) > 1e-12) {
        const delta = 0.5 * (y0 - y2) / denom;
        if (Math.abs(delta) <= 1) tau = periods[peakIdx] + delta * stepH;
      }
    }
    const powerMin = opts.powerMin ?? 10;
    const widthMin = opts.widthMin ?? 2;
    return {
      method: 'chi-square',
      periods, periodBins, qp, threshold: thresholds, power: powers, df: dfs, K: Ks, Np: Nps,
      peakPeriod, tau, peakQp, peakThreshold: peakThr, peakPower,
      peakWidth: width, rhythmic: peakPower >= powerMin && width >= widthMin,
      powerMin, widthMin, alpha,
      percentVariance: peakQp / Math.max(1, Nps[peakIdx]) * 100,
      error: null, n: N, binMin
    };
  }

  /* ============================ Lomb-Scargle ============================ */
  function lombScargle(values, times, opts = {}) {
    const minPeriod = opts.minPeriod ?? 16;
    const maxPeriod = opts.maxPeriod ?? 32;
    const step = opts.step ?? 0.1;
    const alpha = opts.alpha ?? 0.05;
    const source = opts.detrend === false ? values : C.detrend(values);
    const x = [], t = [];
    for (let i = 0; i < source.length; i++) {
      if (C.isNum(source[i]) && C.isNum(times[i])) { x.push(source[i]); t.push(times[i]); }
    }
    const N = x.length;
    if (N < 8) return { method: 'lomb-scargle', periods: [], power: [], error: 'Fewer than 8 points.' };
    const xbar = C.mean(x);
    let s2 = 0;
    for (const v of x) s2 += (v - xbar) ** 2;
    s2 /= N;
    if (!(s2 > 0)) return { method: 'lomb-scargle', periods: [], power: [], error: 'Constant series.' };
    const periods = [], power = [], pvals = [];
    const M = Math.max(1, Math.round((maxPeriod - minPeriod) / step) + 1);
    for (let P = minPeriod; P <= maxPeriod + 1e-9; P += step) {
      const w = C.TAU / P;
      let sumSin2 = 0, sumCos2 = 0;
      for (const tj of t) {
        sumSin2 += Math.sin(2 * w * tj);
        sumCos2 += Math.cos(2 * w * tj);
      }
      const tau = 0.5 * Math.atan2(sumSin2, sumCos2) / w;
      let cNum = 0, sNum = 0, cDen = 0, sDen = 0;
      for (let j = 0; j < N; j++) {
        const arg = w * (t[j] - tau);
        const c = Math.cos(arg), s = Math.sin(arg);
        const d = x[j] - xbar;
        cNum += d * c;
        sNum += d * s;
        cDen += c * c;
        sDen += s * s;
      }
      const PN = (1 / (2 * s2)) * (
        (cDen > 0 ? cNum * cNum / cDen : 0) +
        (sDen > 0 ? sNum * sNum / sDen : 0)
      );
      periods.push(P);
      power.push(PN);
      pvals.push(1 - Math.pow(1 - Math.exp(-PN), M));
    }
    let peakIdx = 0;
    for (let i = 1; i < power.length; i++) if (power[i] > power[peakIdx]) peakIdx = i;
    const zThreshold = -Math.log(1 - Math.pow(1 - alpha, 1 / M));
    const peakPower = power[peakIdx];
    const p = 1 - Math.pow(1 - Math.exp(-peakPower), M);
    return {
      method: 'lomb-scargle',
      periods, power, pValues: pvals,
      peakPeriod: periods[peakIdx], tau: periods[peakIdx],
      peakPower, threshold: zThreshold, powerAboveThreshold: peakPower - zThreshold,
      p, significant: p < alpha,
      significantPower: peakPower >= zThreshold,
      M, alpha, n: N, error: null
    };
  }

  /* ============================ autocorrelation ============================ */
  function findPeaks(r, minLagBins, minSeparationBins) {
    const peaks = [];
    for (let k = minLagBins + 1; k < r.length - 1; k++) {
      if (r[k] >= r[k - 1] && r[k] > r[k + 1] && r[k] > 0.05) {
        if (!peaks.length || k - peaks[peaks.length - 1] >= minSeparationBins) peaks.push(k);
        else if (r[k] > r[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = k;
      }
    }
    return peaks;
  }

  function autocorrelation(values, binMin, opts = {}) {
    const maxLagHours = opts.maxLagHours ?? 120;
    const smoothBins = opts.smoothBins ?? 3;
    const minPeakLagHours = opts.minPeakLagHours ?? 8;
    const rippleMin = opts.rippleMin ?? 0.3;
    const N = values.length;
    if (N < 16) return { method: 'autocorrelation', error: 'Fewer than 16 bins.' };
    const mean = C.mean(values);
    let denom = 0;
    for (const v of values) denom += (v - mean) ** 2;
    if (!(denom > 0)) return { method: 'autocorrelation', error: 'Constant series.' };
    const maxLag = Math.min(N - 2, Math.round(maxLagHours * 60 / binMin));
    const lags = [], r = [];
    for (let k = 0; k <= maxLag; k++) {
      let s = 0;
      for (let i = 0; i < N - k; i++) s += (values[i] - mean) * (values[i + k] - mean);
      lags.push(k * binMin / 60);
      r.push(s / denom);
    }
    const smoothed = C.movingAverage(r, smoothBins);
    const peaks = findPeaks(smoothed, Math.round(minPeakLagHours * 60 / binMin), Math.round(12 * 60 / binMin));
    const peakLag = peaks.length ? lags[peaks[0]] : NaN;
    let period = NaN;
    if (peaks.length) {
      // highest peak after lag 0
      let best = peaks[0];
      for (const p of peaks) if (smoothed[p] > smoothed[best]) best = p;
      period = lags[best];
    }
    const third = peaks.length >= 3 ? peaks[2] : null;
    const RI = third !== null ? smoothed[third] : 0;
    const RS = RI / (2 / Math.sqrt(N));
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(lags[peaks[i]] - lags[peaks[i - 1]]);
    return {
      method: 'autocorrelation',
      lags, r, smoothed, peaks,
      peakPeriod: period, tau: period,
      periodFromPeakIntervals: intervals.length ? C.mean(intervals) : NaN,
      RI, RS,
      rhythmic: RI >= rippleMin,
      rippleMin,
      confidence: 2 / Math.sqrt(N),
      n: N, binMin, error: null,
      peakLags: peaks.map((p) => lags[p]),
      peakHeights: peaks.map((p) => smoothed[p])
    };
  }

  /* ============================ FFT ============================ */
  function fft(re, im) {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        const tr = re[i]; re[i] = re[j]; re[j] = tr;
        const ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -C.TAU / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function fftPeriodogram(values, binMin, opts = {}) {
    const minPeriod = opts.minPeriod ?? 16;
    const maxPeriod = opts.maxPeriod ?? 32;
    const detrend = opts.detrend !== false;
    const window = opts.window !== false;
    const N = values.length;
    if (N < 16) return { method: 'fft', error: 'Fewer than 16 bins.' };
    let x = detrend ? C.detrend(values) : values.slice();
    if (window) {
      for (let i = 0; i < N; i++) x[i] *= 0.5 * (1 - Math.cos(C.TAU * i / (N - 1)));
    }
    let nfft = 1;
    while (nfft < N * 2) nfft <<= 1;
    const re = new Float64Array(nfft), im = new Float64Array(nfft);
    for (let i = 0; i < N; i++) re[i] = x[i];
    fft(re, im);
    const freqs = [], periods = [], power = [];
    for (let k = 1; k < nfft / 2; k++) {
      const f = k / (nfft * binMin / 60); // cycles per hour
      const P = 1 / f;
      if (P < minPeriod || P > maxPeriod) continue;
      freqs.push(f); periods.push(P);
      power.push((re[k] * re[k] + im[k] * im[k]) / N);
    }
    if (!periods.length) return { method: 'fft', error: 'No frequencies in the selected period range.' };
    let peakIdx = 0;
    for (let i = 1; i < power.length; i++) if (power[i] > power[peakIdx]) peakIdx = i;
    return {
      method: 'fft', periods, frequencies: freqs, power,
      peakPeriod: periods[peakIdx], tau: periods[peakIdx], peakPower: power[peakIdx],
      detrended: detrend, window, nfft, n: N, error: null
    };
  }

  /* ============================ cosinor ============================ */
  function solve3(A, b) {
    const a = A.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
      if (Math.abs(a[p][i]) < 1e-14) return null;
      [a[i], a[p]] = [a[p], a[i]];
      const piv = a[i][i];
      for (let c = i; c < 4; c++) a[i][c] /= piv;
      for (let r = 0; r < 3; r++) {
        if (r === i) continue;
        const f = a[r][i];
        for (let c = i; c < 4; c++) a[r][c] -= f * a[i][c];
      }
    }
    return [a[0][3], a[1][3], a[2][3]];
  }

  function cosinor(values, times, tau, alpha = 0.05) {
    const x = [], y = [];
    for (let i = 0; i < values.length; i++) {
      if (C.isNum(values[i]) && C.isNum(times[i])) { x.push(values[i]); y.push(times[i]); }
    }
    const N = x.length;
    if (N < 5) return { method: 'cosinor', error: 'Fewer than 5 points.' };
    const w = C.TAU / tau;
    const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const Xty = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const v = [1, Math.cos(w * y[i]), Math.sin(w * y[i])];
      for (let a = 0; a < 3; a++) {
        Xty[a] += v[a] * x[i];
        for (let b = 0; b < 3; b++) XtX[a][b] += v[a] * v[b];
      }
    }
    const beta = solve3(XtX, Xty);
    if (!beta) return { method: 'cosinor', error: 'Singular design matrix.' };
    const [mesor, bcos, bsin] = beta;
    const amp = Math.sqrt(bcos * bcos + bsin * bsin);
    const phi = Math.atan2(-bsin, bcos); // y = M + A cos(wt + phi)
    let acrophase = (-phi / w) % tau;
    if (acrophase < 0) acrophase += tau;
    let sse = 0, sst = 0;
    const mean = C.mean(x);
    for (let i = 0; i < N; i++) {
      const fit = mesor + bcos * Math.cos(w * y[i]) + bsin * Math.sin(w * y[i]);
      sse += (x[i] - fit) ** 2;
      sst += (x[i] - mean) ** 2;
    }
    const r2 = sst > 0 ? 1 - sse / sst : 0;
    const df1 = 2, df2 = N - 3;
    const F = df1 > 0 && df2 > 0 ? (r2 / df1) / ((1 - r2) / df2) : NaN;
    const p = C.fSf(F, df1, df2);
    return {
      method: 'cosinor',
      tau, mesor, amplitude: amp, beta: bcos, gamma: bsin,
      phi, acrophase,
      acrophaseHours: acrophase,
      r2, percentRhythm: 100 * r2,
      F, df1, df2, p,
      significant: p < alpha,
      n: N, error: null
    };
  }

  function cosinorBest(values, times, opts = {}) {
    const minPeriod = opts.minPeriod ?? 16;
    const maxPeriod = opts.maxPeriod ?? 32;
    const step = opts.step ?? 0.25;
    let best = null;
    for (let tau = minPeriod; tau <= maxPeriod + 1e-9; tau += step) {
      const r = cosinor(values, times, tau, opts.alpha ?? 0.05);
      if (!r.error && (!best || r.r2 > best.r2)) best = r;
    }
    return best || { method: 'cosinor', error: 'No fit.' };
  }

  /* ============================ onset regression ============================ */
  function onsetRegression(animal, mask, settings = {}) {
    const binMin = animal.binMinutes;
    const smoothWindow = Math.max(1, Math.round(30 / binMin));
    const minDuration = Math.max(1, Math.round((settings.onsetMinDurationMin ?? 30) / binMin));
    const thresholdFrac = settings.onsetThresholdFrac ?? 0.2;
    const days = [...new Set(animal.day.filter((_, i) => mask[i]))].sort((a, b) => a - b);
    const onsets = [];
    for (const d of days) {
      // window: CT 12–36 (subjective afternoon through next subjective morning)
      const idx = [];
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const dayOffset = animal.day[i] - d;
        const ct = animal.ct[i] + dayOffset * 24;
        if (ct >= 12 && ct < 36) idx.push(i);
      }
      if (idx.length < 10) continue;
      const raw = idx.map((i) => animal.activity[i]);
      const smooth = C.movingAverage(raw, smoothWindow);
      const mx = C.max(smooth);
      if (!(mx > 0)) continue;
      const thr = mx * thresholdFrac;
      let onset = null;
      for (let j = 0; j < smooth.length; j++) {
        if (!C.isNum(smooth[j]) || smooth[j] < thr) continue;
        let ok = true;
        for (let k = j; k < Math.min(smooth.length, j + minDuration); k++) {
          if (!C.isNum(smooth[k]) || smooth[k] < thr) { ok = false; break; }
        }
        if (ok) { onset = j; break; }
      }
      if (onset === null) continue;
      const i0 = idx[0];
      const onsetCt = animal.ct[i0] + (animal.day[i0] - d) * 24 + onset * binMin / 60;
      onsets.push({ day: d, onsetCt: ((onsetCt % 24) + 24) % 24, onsetAbs: animal.tHours[idx[onset]] });
    }
    if (onsets.length < 3) return { method: 'onset', onsets, tau: NaN, error: 'Fewer than 3 detectable onsets.' };
    // Fit onset time vs day, allowing wrap-around: use the first onset as a
    // reference and unwrap subsequent onsets to the nearest cycle.
    const xs = onsets.map((o) => o.day);
    const ys = [];
    let prev = onsets[0].onsetCt;
    for (let i = 0; i < onsets.length; i++) {
      let v = onsets[i].onsetCt;
      while (v - prev > 12) v -= 24;
      while (v - prev < -12) v += 24;
      if (i === 0) v = onsets[0].onsetCt;
      ys.push(v);
      prev = v;
    }
    const reg = C.linearRegression(xs, ys);
    const tau = 24 + reg.slope;
    let meanOnset = C.circularMeanTime(onsets.map((o) => o.onsetCt), null);
    const sdOnset = (() => {
      const diffs = onsets.map((o) => C.circularDiff(o.onsetCt, meanOnset));
      return C.sd(diffs);
    })();
    return {
      method: 'onset', onsets, tau, slope: reg.slope, r2: reg.r2,
      sdOnset, meanOnset, n: onsets.length, error: null
    };
  }

  /* ============================ all methods ============================ */
  function analyseAnimal(animal, settings, phaseMap) {
    const mask = I.analysisMask(animal, settings, phaseMap);
    const targetBin = settings.periodogramBinMin ?? 30;
    const prep = prepare(animal, mask, targetBin, settings);
    if (prep.error) {
      return { animal, error: prep.error, mask, prep };
    }
    const periods = settings;
    const cs = chiSquare(prep.values, prep.binMin, periods);
    const ls = lombScargle(prep.values, prep.times, { ...periods, detrend: settings.detrend !== false });
    const ac = autocorrelation(prep.values, prep.binMin, {
      maxLagHours: settings.autoMaxLagHours ?? 120,
      smoothBins: settings.autoSmoothBins ?? 3,
      minPeakLagHours: settings.autoMinPeakLagHours ?? 8,
      rippleMin: settings.riThreshold ?? 0.3
    });
    const ff = fftPeriodogram(prep.values, prep.binMin, periods);
    const primaryTau = cs.tau || 24;
    const cos = cosinorBest(prep.values, prep.times, {
      ...periods,
      step: Math.max(0.1, (periods.step || 0.1) * 2)
    });
    const onset = onsetRegression(animal, mask, settings);
    const methodTaus = [cs.tau, ls.tau, ac.tau, ff.tau, cos.tau, onset.tau].filter(C.isNum);
    const primary = settings.primaryMethod || 'chi-square';
    const primaryResult = { 'chi-square': cs, 'lomb-scargle': ls, autocorrelation: ac, fft: ff, cosinor: cos, onset }[primary] || cs;
    // Consensus is judged on the periodogram/cosinor estimates; onset
    // regression is a different (and noisier) estimator, so it is reported
    // separately rather than triggering a consensus flag on its own.
    const consensusTaus = [cs.tau, ls.tau, ac.tau, ff.tau, cos.tau].filter(C.isNum);
    const consensusMedian = consensusTaus.length ? C.median(consensusTaus) : NaN;
    const consensusRange = consensusTaus.length ? C.max(consensusTaus) - C.min(consensusTaus) : NaN;
    const tol = settings.consensusTolerance ?? 0.5;
    const consensusFlag = C.isNum(consensusMedian) &&
      Math.abs(consensusMedian - primaryResult.tau) > tol &&
      consensusRange > 2 * tol + 1e-9;
    let rhythmic;
    if (primary === 'chi-square') rhythmic = cs.rhythmic;
    else if (primary === 'lomb-scargle') rhythmic = ls.significant;
    else if (primary === 'autocorrelation') rhythmic = ac.rhythmic;
    else if (primary === 'cosinor') rhythmic = cos.significant;
    else rhythmic = cs.rhythmic; // FFT and onset use the chi-square classification as the gate
    return {
      animal, mask, prep,
      chiSquare: cs, lombScargle: ls, autocorrelation: ac, fft: ff, cosinor: cos, onset,
      primaryMethod: primary, primary: primaryResult,
      tau: primaryResult.tau,
      rhythmic,
      consensusFlag,
      consensusMedian,
      consensusRange,
      methodTaus,
      error: null
    };
  }

  function populationPeriodogram(results, method = 'chi-square') {
    const valid = results.filter((r) => r && !r.error && r[method === 'chi-square' ? 'chiSquare' : method === 'lomb-scargle' ? 'lombScargle' : method] &&
      (r[method === 'chi-square' ? 'chiSquare' : method === 'lomb-scargle' ? 'lombScargle' : method].periods || []).length);
    if (!valid.length) return null;
    const key = method === 'chi-square' ? 'chiSquare' : method === 'lomb-scargle' ? 'lombScargle' : method;
    const grid = valid[0][key].periods;
    const series = valid.map((r) => r[key]);
    const mean = new Array(grid.length).fill(0);
    const sem = new Array(grid.length).fill(0);
    const n = new Array(grid.length).fill(0);
    for (let i = 0; i < grid.length; i++) {
      const vals = [];
      for (const s of series) {
        if (i < s.periods.length && Math.abs(s.periods[i] - grid[i]) < 1e-6) {
          const v = method === 'chi-square' ? s.qp[i] - s.threshold[i] :
            method === 'lomb-scargle' ? s.power[i] : s.power[i];
          if (C.isNum(v)) vals.push(v);
        }
      }
      n[i] = vals.length;
      if (vals.length) {
        mean[i] = C.mean(vals);
        if (vals.length > 1) sem[i] = C.sem(vals);
      }
    }
    return { method, periods: grid, mean, sem, n, nAnimals: valid.length };
  }

  function groupSummary(results) {
    const groups = C.unique(results.map((r) => r.animal.group));
    return groups.map((g) => {
      const rows = results.filter((r) => r.animal.group === g && !r.error);
      const rhythmic = rows.filter((r) => r.rhythmic);
      const significant = rows.filter((r) => r.chiSquare && C.isNum(r.chiSquare.peakPower) && r.chiSquare.peakPower >= 0);
      const taus = rhythmic.map((r) => r.tau).filter(C.isNum);
      return {
        group: g,
        n: rows.length,
        nRhythmic: rhythmic.length,
        percentRhythmic: rows.length ? 100 * rhythmic.length / rows.length : NaN,
        nSignificant: significant.length,
        percentSignificant: rows.length ? 100 * significant.length / rows.length : NaN,
        meanTau: taus.length ? C.mean(taus) : NaN,
        semTau: taus.length > 1 ? C.sem(taus) : NaN,
        medianTau: taus.length ? C.median(taus) : NaN,
        meanPower: C.mean(rows.map((r) => r.chiSquare && r.chiSquare.peakPower).filter(C.isNum)),
        meanRI: C.mean(rows.map((r) => r.autocorrelation && r.autocorrelation.RI).filter(C.isNum)),
        nFlagged: rows.filter((r) => r.consensusFlag).length,
        taus
      };
    });
  }

  global.CircadianLab = {
    aggregateForPeriodogram, cleanSeries, prepare,
    chiSquare, lombScargle, autocorrelation, fftPeriodogram, fft,
    cosinor, cosinorBest, onsetRegression, analyseAnimal,
    populationPeriodogram, groupSummary, findPeaks
  };
})(window);
