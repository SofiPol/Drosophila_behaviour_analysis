/* ============================================================================
 * analysis.js — sleep scoring, bouts, daily summaries & profiles
 * Implements the Rethomics-style analysis pipeline in the browser.
 * Exposed globally as window.ZAnalysis.
 * ==========================================================================*/
window.ZAnalysis = (function () {
  'use strict';

  const M = window.ZMath;

  /* ---------------- helpers ---------------- */
  function uniqueGenotypes(flies) {
    const seen = [];
    for (const f of flies) {
      if (!seen.includes(f.genotype)) seen.push(f.genotype);
    }
    return seen;
  }

  /* ---------------- Sub-minute → 1-minute aggregation ---------------- */
  // Zantiks MWP often records at ~1 s per bin. Sleep scoring, actograms and
  // profiles assume the standard 1-minute DAM resolution, so sub-minute
  // series are aggregated to 1-minute bins (summing activity, majority light).
  function aggregateSubMinute(flies) {
    for (const fly of flies) {
      if (!fly.binMin || fly.binMin >= 1) continue;
      const buckets = new Map();
      const order = [];
      for (let i = 0; i < fly.activity.length; i++) {
        const key = Math.floor(fly.timestamps[i].getTime() / 60000);
        let b = buckets.get(key);
        if (!b) {
          b = { act: 0, light: 0, n: 0, ts: key * 60000 };
          buckets.set(key, b);
          order.push(key);
        }
        b.act += fly.activity[i];
        b.light += fly.light[i];
        b.n++;
      }
      const act = [];
      const light = [];
      const tHours = [];
      const todHours = [];
      const dayIdx = [];
      const timestamps = [];
      const start = fly.start;
      for (const key of order) {
        const b = buckets.get(key);
        const ts = new Date(b.ts);
        const hrs = (ts - start) / 3600000;
        act.push(b.act);
        light.push(Math.round(b.light / b.n));
        tHours.push(hrs);
        todHours.push(ts.getHours() + ts.getMinutes() / 60);
        dayIdx.push(Math.floor(hrs / 24));
        timestamps.push(ts);
      }
      fly.activity = act;
      fly.light = light;
      fly.tHours = tHours;
      fly.todHours = todHours;
      fly.dayIdx = dayIdx;
      fly.timestamps = timestamps;
      fly.binMin = 1;
      fly.aggregatedToMin = true;
    }
    return flies;
  }

  /* ---------------- Sleep scoring ---------------- */
  // Standard Drosophila sleep: ≥5 consecutive minutes of zero activity.
  function sleepThresholdBins(fly) {
    const binMin = Math.max(fly.binMin || 1, 0.001);
    return Math.max(1, Math.ceil(5 / binMin));
  }

  function computeSleep(flies) {
    for (const fly of flies) {
      const thr = sleepThresholdBins(fly);
      const n = fly.activity.length;
      const sleep = new Uint8Array(n);
      // single linear pass: when a zero-run closes (non-zero bin or end of
      // array), mark the whole run once if it is long enough (≥5 min).
      let run = 0;
      for (let i = 0; i <= n; i++) {
        if (i < n && fly.activity[i] === 0) {
          run++;
          continue;
        }
        if (run >= thr) {
          for (let k = i - run; k < i; k++) sleep[k] = 1;
        }
        run = 0;
      }
      fly.sleep = sleep;
    }
    return flies;
  }

  /* ---------------- Bout analysis ---------------- */
  function sleepBouts(sleep, binMin) {
    let count = 0;
    const durations = [];
    let run = 0;
    for (let i = 0; i < sleep.length; i++) {
      if (sleep[i] === 1) {
        run++;
      } else {
        if (run > 0) {
          count++;
          durations.push(run * binMin);
        }
        run = 0;
      }
    }
    if (run > 0) {
      count++;
      durations.push(run * binMin);
    }
    const meanDur = durations.length ? M.mean(durations) : 0;
    return { count, meanDurationMin: meanDur, durations };
  }

  /* ---------------- Daily summaries ---------------- */
  /**
   * Returns per-fly per-day summaries. Days must be at least `minCompleteFraction`
   * complete (real Zantiks recordings often have gaps); sleep/activity are scaled
   * up to a full day so partial days remain comparable.
   */
  function dailySummaries(flies, opts) {
    const minComplete = (opts && opts.minCompleteFraction) || 0.85;
    const out = [];
    for (const fly of flies) {
      if (!fly.sleep) continue;
      const binMin = fly.binMin || 1;
      const binsPerDay = Math.round(24 * 60 / binMin);
      const dayMap = new Map();
      for (let i = 0; i < fly.dayIdx.length; i++) {
        const d = fly.dayIdx[i];
        if (!dayMap.has(d)) dayMap.set(d, { n: 0, sleep: 0, act: 0, boutRun: 0, bouts: [], inBout: false });
        const rec = dayMap.get(d);
        rec.n++;
        rec.act += fly.activity[i];
        if (fly.sleep[i] === 1) {
          rec.sleep += 1;
          rec.boutRun++;
        } else {
          if (rec.boutRun > 0) { rec.bouts.push(rec.boutRun); rec.boutRun = 0; }
        }
      }
      for (const [day, rec] of dayMap) {
        if (rec.boutRun > 0) rec.bouts.push(rec.boutRun);
        if (rec.n < binsPerDay * minComplete) continue;
        const scale = binsPerDay / Math.max(1, rec.n); // normalize partial days
        const boutCount = rec.bouts.length;
        const meanBoutLen = boutCount ? M.mean(rec.bouts) * binMin : 0;
        out.push({
          fly, day,
          sleepMin: rec.sleep * binMin * scale,
          activity: rec.act * scale,
          boutCount,
          meanBoutLen,
          n: rec.n
        });
      }
    }
    return out;
  }

  /**
   * Per-fly level metrics (means across complete days) — used for box plots & stats.
   */
  function flyLevelSummaries(flies, opts) {
    const daily = dailySummaries(flies, opts);
    const byFly = new Map();
    for (const d of daily) {
      if (!byFly.has(d.fly.id)) {
        byFly.set(d.fly.id, { fly: d.fly, sleep: [], act: [], bouts: [], boutLen: [] });
      }
      const rec = byFly.get(d.fly.id);
      rec.sleep.push(d.sleepMin);
      rec.act.push(d.activity);
      rec.bouts.push(d.boutCount);
      rec.boutLen.push(d.meanBoutLen);
    }
    const out = [];
    for (const rec of byFly.values()) {
      out.push({
        fly: rec.fly,
        genotype: rec.fly.genotype,
        well: rec.fly.well,
        sex: rec.fly.sex,
        replicate: rec.fly.replicate,
        observations: rec.fly.observations,
        days: rec.sleep.length,
        sleepMinDay: M.mean(rec.sleep),
        activityDay: M.mean(rec.act),
        boutCountDay: M.mean(rec.bouts),
        meanBoutLenDay: M.mean(rec.boutLen),
        sleepMinValues: rec.sleep,
        activityValues: rec.act,
        boutCountValues: rec.bouts,
        meanBoutLenValues: rec.boutLen
      });
    }
    return out;
  }

  /* ---------------- Phase (LD / DD) day classification ---------------- */
  function classifyDays(fly) {
    const dayMap = new Map();
    for (let i = 0; i < fly.dayIdx.length; i++) {
      const d = fly.dayIdx[i];
      if (!dayMap.has(d)) dayMap.set(d, { light: 0, dark: 0, n: 0 });
      const rec = dayMap.get(d);
      rec.n++;
      if (fly.light[i] === 1) rec.light++; else rec.dark++;
    }
    const days = [];
    for (const [day, rec] of dayMap) {
      let phase = 'LD';
      const fracDark = rec.dark / rec.n;
      if (fracDark > 0.95) phase = 'DD';
      else if (fracDark < 0.05) phase = 'LL';
      days.push({ day, phase, light: rec.light, dark: rec.dark, n: rec.n });
    }
    return days;
  }

  function selectPhaseDays(fly, phase) {
    const days = classifyDays(fly);
    if (phase === 'ALL') return days.map((d) => d.day);
    if (phase === 'LD') return days.filter((d) => d.phase === 'LD').map((d) => d.day);
    if (phase === 'DD') return days.filter((d) => d.phase === 'DD').map((d) => d.day);
    return [];
  }

  /* ---------------- 24h wrapped profiles ---------------- */
  /**
   * Mean activity & fraction-asleep across time-of-day for each genotype.
   * @param {Array} flies
   * @param {string} phase 'LD' | 'DD' | 'ALL'
   * @param {number} resMin resolution in minutes (default 5)
   */
  function profiles24(flies, phase, resMin) {
    resMin = resMin || 5;
    const nSlots = Math.round(24 * 60 / resMin);
    const genotypes = uniqueGenotypes(flies);

    const result = genotypes.map((g) => {
      const gflies = flies.filter((f) => f.genotype === g);

      // per-fly slot means across the selected days (single pass over bins)
      const perFlyAct = [];
      const perFlySleep = [];
      let nFlies = 0;
      for (const fly of gflies) {
        const allowed = new Set(selectPhaseDays(fly, phase));
        if (allowed.size === 0) continue;
        nFlies++;
        const actSum = new Array(nSlots).fill(0);
        const actCnt = new Array(nSlots).fill(0);
        const slpSum = new Array(nSlots).fill(0);
        const slpCnt = new Array(nSlots).fill(0);
        for (let i = 0; i < fly.activity.length; i++) {
          if (!allowed.has(fly.dayIdx[i])) continue;
          const s = Math.min(nSlots - 1, Math.floor(fly.todHours[i] * 60 / resMin));
          actSum[s] += fly.activity[i];
          actCnt[s]++;
          if (fly.sleep) {
            slpSum[s] += fly.sleep[i];
            slpCnt[s]++;
          }
        }
        const actMean = actSum.map((s, idx) => (actCnt[idx] > 0 ? s / actCnt[idx] : null));
        const slpMean = slpSum.map((s, idx) => (slpCnt[idx] > 0 ? s / slpCnt[idx] : null));
        perFlyAct.push(actMean);
        perFlySleep.push(slpMean);
      }

      // across-fly mean & SEM per slot
      const hours = [];
      const actMean = [];
      const actSem = [];
      const sleepMean = [];
      const sleepSem = [];
      for (let s = 0; s < nSlots; s++) {
        hours.push((s * resMin) / 60);
        const av = [];
        const sv = [];
        for (let f = 0; f < perFlyAct.length; f++) {
          if (perFlyAct[f][s] !== null) av.push(perFlyAct[f][s]);
          if (perFlySleep[f][s] !== null) sv.push(perFlySleep[f][s]);
        }
        actMean.push(av.length ? M.mean(av) : null);
        actSem.push(av.length > 1 ? M.sd(av) / Math.sqrt(av.length) : null);
        sleepMean.push(sv.length ? M.mean(sv) : null);
        sleepSem.push(sv.length > 1 ? M.sd(sv) / Math.sqrt(sv.length) : null);
      }
      return { name: g, hours, actMean, actSem, sleepMean, sleepSem, n: nFlies };
    });
    return result;
  }

  /* ---------------- Whole-experiment time series ---------------- */
  function wholeExperiment(flies, binMin) {
    binMin = binMin || 30;
    const genotypes = uniqueGenotypes(flies);
    // common time grid in hours
    let tMax = 0;
    for (const f of flies) if (f.tHours.length && f.tHours[f.tHours.length - 1] > tMax) tMax = f.tHours[f.tHours.length - 1];
    const nBins = Math.ceil(tMax / (binMin / 60)) + 1;
    const t = [];
    for (let i = 0; i < nBins; i++) t.push(i * binMin / 60);

    const result = genotypes.map((g) => {
      const gflies = flies.filter((f) => f.genotype === g);
      const perFlyMean = new Array(nBins).fill(null);
      const perFlyN = new Array(nBins).fill(0);
      for (const fly of gflies) {
        const acc = new Array(nBins).fill(0);
        const cnt = new Array(nBins).fill(0);
        for (let i = 0; i < fly.activity.length; i++) {
          const b = Math.min(nBins - 1, Math.floor(fly.tHours[i] / (binMin / 60)));
          acc[b] += fly.activity[i];
          cnt[b]++;
        }
        for (let b = 0; b < nBins; b++) {
          if (cnt[b] > 0) {
            const v = acc[b] / cnt[b];
            if (perFlyMean[b] === null) perFlyMean[b] = [];
            perFlyMean[b].push(v);
          }
        }
      }
      const mean = [];
      const sem = [];
      const n = [];
      for (let b = 0; b < nBins; b++) {
        if (perFlyMean[b] && perFlyMean[b].length > 0) {
          mean.push(M.mean(perFlyMean[b]));
          sem.push(perFlyMean[b].length > 1 ? M.sd(perFlyMean[b]) / Math.sqrt(perFlyMean[b].length) : 0);
          n.push(perFlyMean[b].length);
        } else {
          mean.push(null);
          sem.push(null);
          n.push(0);
        }
      }
      return { name: g, t, mean, sem, n };
    });
    return result;
  }

  /* ---------------- Periodogram analysis ---------------- */
  function phaseRestrictedActivity(fly, phase) {
    const allowed = new Set(selectPhaseDays(fly, phase));
    const out = [];
    for (let i = 0; i < fly.activity.length; i++) {
      if (allowed.has(fly.dayIdx[i])) out.push(fly.activity[i]);
    }
    return out;
  }

  function periodogramSummary(flies, opts) {
    opts = opts || {};
    const phase = opts.phase || 'ALL';
    const out = [];
    for (const fly of flies) {
      const series = phase === 'ALL' ? fly.activity : phaseRestrictedActivity(fly, phase);
      const res = window.ZPeriodogram.chiSquarePeriodogram(series, opts);
      out.push({
        fly,
        genotype: fly.genotype,
        well: fly.well,
        sex: fly.sex,
        period: res.peakPeriod,
        power: res.peakPower,
        threshold: res.threshold && res.threshold.length ? res.threshold[res.qp.indexOf(res.peakPower)] : NaN,
        significant: res.significant,
        result: res
      });
    }
    return out;
  }

  return {
    uniqueGenotypes,
    computeSleep,
    sleepThresholdBins,
    sleepBouts,
    dailySummaries,
    flyLevelSummaries,
    classifyDays,
    selectPhaseDays,
    profiles24,
    wholeExperiment,
    phaseRestrictedActivity,
    aggregateSubMinute,
    periodogramSummary
  };
})();
