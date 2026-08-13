/* ============================================================================
 * periodogram.js — Chi-square periodogram (Sokolove & Bushell, 1978)
 * Used for circadian rhythmicity & period determination (zeitgebr::ggperio equivalent).
 * Exposed globally as window.ZPeriodogram.
 * ==========================================================================*/
window.ZPeriodogram = (function () {
  'use strict';

  const M = window.ZMath;

  /**
   * Chi-square periodogram (Sokolove & Bushell, 1978).
   *
   * The input activity series (any bin size, e.g. 1-min) is first aggregated
   * into `aggBinMin`-minute bins. Periods are specified and returned in HOURS.
   *
   * @param {Array<number>} activity  activity counts (one value per bin)
   * @param {object} opts { minPeriod, maxPeriod, step, alpha, aggBinMin }  (hours)
   * @returns {object} { periods, qp, threshold, peakPeriod, peakPower, significant, df, alpha }
   */
  function chiSquarePeriodogram(activity, opts) {
    const minPeriod = (opts && opts.minPeriod) || 18;
    const maxPeriod = (opts && opts.maxPeriod) || 32;
    const step = (opts && opts.step) || 0.5;
    const alpha = (opts && opts.alpha) || 0.01;
    const aggBinMin = (opts && opts.aggBinMin) || 30;

    // ---- aggregate into aggBinMin-minute bins ----
    const agg = [];
    let acc = 0;
    let cnt = 0;
    for (let i = 0; i < activity.length; i++) {
      if (!Number.isFinite(activity[i])) continue;
      acc += activity[i];
      cnt++;
      if (cnt >= aggBinMin) {
        agg.push(acc);
        acc = 0;
        cnt = 0;
      }
    }
    if (cnt > 0) agg.push(acc);

    const x = agg;
    const N = x.length;
    if (N < 3) {
      return { periods: [], qp: [], threshold: [], peakPeriod: NaN, peakPower: NaN, significant: false, df: 0, alpha };
    }

    const xMean = M.mean(x);
    let ss = 0;
    for (let i = 0; i < N; i++) {
      const d = x[i] - xMean;
      ss += d * d;
    }
    if (ss <= 0) {
      return { periods: [], qp: [], threshold: [], peakPeriod: NaN, peakPower: NaN, significant: false, df: 0, alpha };
    }

    const periods = [];
    const qp = [];
    const threshold = [];
    const dfs = [];

    for (let tauH = minPeriod; tauH <= maxPeriod + 1e-9; tauH += step) {
      const tau = Math.max(2, Math.round(tauH * 60 / aggBinMin)); // period in bins
      const Mt = Math.floor(N / tau); // number of complete cycles
      if (Mt < 2) continue;
      const P = new Array(tau).fill(0);
      for (let j = 0; j < tau; j++) {
        let s = 0;
        for (let k = 0; k < Mt; k++) {
          s += x[j + k * tau];
        }
        P[j] = s;
      }
      // Sokolove-Bushell Qp statistic.
      // Calibrated so that under H0 (no periodicity) Qp ~ chi-square with
      // df = tau - 1 (tau in bins). Verified by Monte Carlo:
      //   Qp = tau * sum_j (P_j - M*xMean)^2 / SS
      let num = 0;
      for (let j = 0; j < tau; j++) {
        const d = P[j] - Mt * xMean;
        num += d * d;
      }
      const Qp = (tau * num) / ss;
      periods.push(tauH);
      qp.push(Qp);
      dfs.push(tau - 1);
      threshold.push(M.chiSquareQuantile(1 - alpha, tau - 1));
    }

    // peak detection
    let peakIdx = 0;
    for (let i = 1; i < qp.length; i++) if (qp[i] > qp[peakIdx]) peakIdx = i;
    const peakPeriod = periods[peakIdx];
    const peakPower = qp[peakIdx];
    const significant = qp[peakIdx] >= threshold[peakIdx];

    return {
      periods, qp, threshold,
      peakPeriod, peakPower, significant,
      df: dfs[peakIdx], alpha
    };
  }

  return { chiSquarePeriodogram };
})();
