/* ============================================================================
 * phase.js — non-parametric indices, phase and anticipation
 * Implements IS, IV, M10, L5, RA, COG, day/night ratio, M/E peaks,
 * Harrisingh-style anticipation indices and onset/offset phase.
 * Exposed as window.PhaseLab
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;
  const I = global.Importers;

  /* ============================ hourly aggregation ============================ */
  function aggregateToMinutes(animal, mask, targetMin) {
    const target = Math.max(animal.binMinutes, targetMin || 60);
    const n = Math.ceil(animal.activity.length * animal.binMinutes / target);
    const sums = new Array(n).fill(0);
    const counts = new Array(n).fill(0);
    const todSum = new Array(n).fill(0);
    const todCount = new Array(n).fill(0);
    for (let i = 0; i < animal.activity.length; i++) {
      if (!mask[i] || !C.isNum(animal.activity[i])) continue;
      const b = Math.min(n - 1, Math.floor(animal.tHours[i] * 60 / target));
      sums[b] += animal.activity[i];
      counts[b]++;
      todSum[b] += animal.zt[i];
      todCount[b]++;
    }
    const values = sums.map((s, i) => counts[i] ? s / counts[i] : NaN);
    const tod = todSum.map((s, i) => todCount[i] ? s / todCount[i] : NaN);
    return { values, tod, binMin: target, n };
  }

  function hourlyProfile(animal, mask) {
    // Mean activity per hour of ZT, over days.
    const p = 24;
    const sums = new Array(p).fill(0);
    const counts = new Array(p).fill(0);
    for (let i = 0; i < animal.activity.length; i++) {
      if (!mask[i] || !C.isNum(animal.activity[i])) continue;
      const h = Math.floor(((animal.zt[i] % 24) + 24) % 24);
      sums[h] += animal.activity[i];
      counts[h]++;
    }
    return sums.map((s, i) => counts[i] ? s / counts[i] : NaN);
  }

  /* ============================ IS / IV ============================ */
  function interdailyStability(animal, mask) {
    const agg = aggregateToMinutes(animal, mask, 60);
    const vals = [], tods = [];
    for (let i = 0; i < agg.values.length; i++) {
      if (C.isNum(agg.values[i])) { vals.push(agg.values[i]); tods.push(agg.tod[i]); }
    }
    const N = vals.length;
    if (N < 24) return NaN;
    const grand = C.mean(vals);
    const p = 24;
    const profSum = new Array(p).fill(0), profN = new Array(p).fill(0);
    for (let i = 0; i < N; i++) {
      const h = C.clamp(Math.floor(tods[i]), 0, 23);
      profSum[h] += vals[i];
      profN[h]++;
    }
    let between = 0;
    for (let h = 0; h < p; h++) {
      if (profN[h]) between += (profSum[h] / profN[h] - grand) ** 2;
    }
    let total = 0;
    for (const v of vals) total += (v - grand) ** 2;
    return total > 0 ? N * between / (p * total) : NaN;
  }

  function intradailyVariability(animal, mask) {
    const agg = aggregateToMinutes(animal, mask, 60);
    const vals = agg.values;
    const valid = vals.filter(C.isNum);
    const N = valid.length;
    if (N < 24) return NaN;
    const grand = C.mean(valid);
    let total = 0;
    for (const v of valid) total += (v - grand) ** 2;
    let diffSum = 0, pairs = 0;
    for (let i = 1; i < vals.length; i++) {
      if (C.isNum(vals[i]) && C.isNum(vals[i - 1])) {
        diffSum += (vals[i] - vals[i - 1]) ** 2;
        pairs++;
      }
    }
    return total > 0 && pairs > 0 ? (N * diffSum) / (pairs * total) : NaN;
  }

  /* ============================ M10 / L5 / RA / COG ============================ */
  function circularWindowMean(profile, start, length) {
    const n = profile.length;
    let s = 0, c = 0;
    for (let k = 0; k < length; k++) {
      const v = profile[((start + k) % n + n) % n];
      if (C.isNum(v)) { s += v; c++; }
    }
    return c ? s / c : NaN;
  }
  function bestWindow(profile, length, mode) {
    let best = null;
    for (let start = 0; start < profile.length; start++) {
      const v = circularWindowMean(profile, start, length);
      if (!C.isNum(v)) continue;
      if (!best || (mode === 'max' ? v > best.value : v < best.value)) {
        best = { value: v, start, center: (start + length / 2) % profile.length };
      }
    }
    return best;
  }

  function nonParametric(animal, mask) {
    const profile = hourlyProfile(animal, mask);
    if (profile.every((v) => !C.isNum(v))) return { error: 'No profile data.' };
    const m10 = bestWindow(profile, 10, 'max');
    const l5 = bestWindow(profile, 5, 'min');
    const ra = m10 && l5 && (m10.value + l5.value) !== 0 ? (m10.value - l5.value) / (m10.value + l5.value) : NaN;
    // centre of gravity
    let sx = 0, sy = 0;
    for (let h = 0; h < 24; h++) {
      if (!C.isNum(profile[h])) continue;
      sx += profile[h] * Math.cos(C.TAU * h / 24);
      sy += profile[h] * Math.sin(C.TAU * h / 24);
    }
    const cog = (sx === 0 && sy === 0) ? NaN : ((Math.atan2(sy, sx) / C.TAU) * 24 + 24) % 24;
    const is = interdailyStability(animal, mask);
    const iv = intradailyVariability(animal, mask);
    return {
      profile, IS: is, IV: iv,
      M10: m10 ? m10.value : NaN, M10start: m10 ? m10.start : NaN, M10center: m10 ? m10.center : NaN,
      L5: l5 ? l5.value : NaN, L5start: l5 ? l5.start : NaN, L5center: l5 ? l5.center : NaN,
      RA: ra, COG: cog, error: null
    };
  }

  /* ============================ day/night ratio ============================ */
  function dayNightRatio(animal, mask) {
    let light = 0, dark = 0;
    let lightN = 0, darkN = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (animal.light[i] === 1) lightN++;
      else if (animal.light[i] === 0) darkN++;
    }
    const phase = lightN > 0 && darkN > 0 ? 'LD' : darkN > 0 ? 'DD' : lightN > 0 ? 'LL' : 'unknown';
    const useSubjective = phase === 'DD' || phase === 'unknown';
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || !C.isNum(animal.activity[i])) continue;
      const isDay = phase === 'LL' ? true : (useSubjective ? animal.ct[i] < 12 : animal.light[i] === 1);
      if (isDay) light += animal.activity[i];
      else dark += animal.activity[i];
    }
    return { light, dark, ratio: dark > 0 ? light / dark : NaN };
  }

  /* ============================ peak phases ============================ */
  function lightTransitions(animal, mask) {
    const ons = [], offs = [];
    for (let i = 1; i < animal.light.length; i++) {
      if (!mask[i] || !mask[i - 1]) continue;
      if (animal.light[i] === 1 && animal.light[i - 1] === 0) ons.push(i);
      if (animal.light[i] === 0 && animal.light[i - 1] === 1) offs.push(i);
    }
    return { ons, offs };
  }

  function peakPhases(animal, mask) {
    const profile = hourlyProfile(animal, mask);
    const sm = C.movingAverageCircular(profile.map((v) => C.isNum(v) ? v : 0), 3);
    const trans = lightTransitions(animal, mask);
    const lightsOnHour = animal.lightsOn ? animal.lightsOn.clock : 0;
    const lightsOffHour = (() => {
      if (trans.offs.length) {
        const i = trans.offs[0];
        return animal.clock[i];
      }
      return (lightsOnHour + 12) % 24;
    })();
    const bestAround = (center, radius) => {
      let best = null;
      for (let start = Math.floor(center - radius); start <= center + radius; start++) {
        const h = ((start % 24) + 24) % 24;
        const v = sm[h];
        if (!C.isNum(v)) continue;
        if (!best || v > best.value) best = { value: v, hour: h };
      }
      return best;
    };
    const mPeak = bestAround(lightsOnHour, 3);
    const ePeak = bestAround(lightsOffHour, 3);
    return {
      morningPeak: mPeak ? mPeak.hour : NaN,
      morningPeakValue: mPeak ? mPeak.value : NaN,
      eveningPeak: ePeak ? ePeak.hour : NaN,
      eveningPeakValue: ePeak ? ePeak.value : NaN,
      lightsOnHour, lightsOffHour
    };
  }

  /* ============================ onset / offset phase ============================ */
  function onsetOffset(animal, mask, settings = {}) {
    const binMin = animal.binMinutes;
    const smoothWin = Math.max(1, Math.round(30 / binMin));
    const minDur = Math.max(1, Math.round((settings.onsetMinDurationMin ?? 30) / binMin));
    const frac = settings.onsetThresholdFrac ?? 0.2;
    const days = [...new Set(animal.day.filter((_, i) => mask[i]))].sort((a, b) => a - b);
    const onsets = [], offsets = [];
    const onsetEntries = [], offsetEntries = [];
    for (const d of days) {
      const idx = [];
      for (let i = 0; i < mask.length; i++) if (mask[i] && animal.day[i] === d) idx.push(i);
      if (idx.length < 10) continue;
      const raw = idx.map((i) => animal.activity[i]);
      const sm = C.movingAverage(raw, smoothWin);
      const mx = C.max(sm);
      if (!(mx > 0)) continue;
      const thr = mx * frac;
      let onset = null, offset = null;
      for (let j = 0; j < sm.length; j++) {
        if (!C.isNum(sm[j]) || sm[j] < thr) continue;
        let ok = true;
        for (let k = j; k < Math.min(sm.length, j + minDur); k++) {
          if (!C.isNum(sm[k]) || sm[k] < thr) { ok = false; break; }
        }
        if (ok) { onset = j; break; }
      }
      if (onset !== null) {
        for (let j = sm.length - 1; j >= onset; j--) {
          if (!C.isNum(sm[j]) || sm[j] < thr) continue;
          let ok = true;
          for (let k = j; k > Math.max(onset, j - minDur); k--) {
            if (!C.isNum(sm[k]) || sm[k] < thr) { ok = false; break; }
          }
          if (ok) { offset = j; break; }
        }
      }
      if (onset !== null) {
        const zt = animal.zt[idx[onset]];
        onsets.push(zt);
        onsetEntries.push({ day: d, zt });
      }
      if (offset !== null) {
        const zt = animal.zt[idx[offset]];
        offsets.push(zt);
        offsetEntries.push({ day: d, zt });
      }
    }
    const meanOnset = onsets.length ? C.circularMeanTime(onsets, null) : NaN;
    const meanOffset = offsets.length ? C.circularMeanTime(offsets, null) : NaN;
    const sdOnset = onsets.length > 1 ? C.sd(onsets.map((o) => C.circularDiff(o, meanOnset))) : NaN;
    const sdOffset = offsets.length > 1 ? C.sd(offsets.map((o) => C.circularDiff(o, meanOffset))) : NaN;
    return { nOnsets: onsets.length, nOffsets: offsets.length, meanOnset, meanOffset, sdOnset, sdOffset, onsets, offsets, onsetEntries, offsetEntries };
  }

  /* ============================ anticipation ============================ */
  function windowActivity(animal, mask, tEnd, hours) {
    const tStart = tEnd - hours;
    let sum = 0, n = 0;
    const values = [];
    for (let i = 0; i < animal.activity.length; i++) {
      if (!mask[i] || !C.isNum(animal.activity[i])) continue;
      const t = animal.tHours[i];
      if (t >= tStart && t < tEnd) {
        sum += animal.activity[i];
        n++;
        values.push({ t, v: animal.activity[i] });
      }
    }
    return { sum, n, values };
  }

  function slopeIndex(animal, mask, tEnd, hours = 6) {
    const w = windowActivity(animal, mask, tEnd, hours);
    if (w.values.length < 3) return { slope: NaN, ci95: NaN, r2: NaN, n: w.values.length };
    const mean = C.mean(w.values.map((x) => x.v));
    if (!(mean > 0)) return { slope: NaN, ci95: NaN, r2: NaN, n: w.values.length };
    const xs = w.values.map((x) => x.t - (tEnd - hours));
    const ys = w.values.map((x) => x.v / mean);
    const reg = C.linearRegression(xs, ys);
    return { slope: reg.slope, ci95: reg.ci95, r2: reg.r2, n: w.values.length, p: reg.p };
  }

  function anticipationEvent(animal, mask, tEvent) {
    const short = windowActivity(animal, mask, tEvent, 3);
    const long = windowActivity(animal, mask, tEvent, 6);
    const ratio = long.sum > 0 ? short.sum / long.sum : NaN;
    const diffRatio = long.sum > 0 ? (short.sum - (long.sum - short.sum)) / long.sum : NaN;
    const slope = slopeIndex(animal, mask, tEvent, 6);
    return {
      tEvent, ratio, diffRatio,
      shortSum: short.sum, longSum: long.sum,
      shortN: short.n, longN: long.n,
      slope: slope.slope, slopeCI: slope.ci95, slopeR2: slope.r2, slopeN: slope.n
    };
  }

  function anticipation(animal, mask, settings = {}) {
    // Use actual light transitions in the selected window.
    const trans = lightTransitions(animal, mask);
    const morning = [], evening = [];
    // Only one transition per day and per type; the first after a change.
    const seenOn = new Set(), seenOff = new Set();
    for (const i of trans.ons) {
      const d = animal.day[i];
      if (seenOn.has(d)) continue;
      seenOn.add(d);
      morning.push(anticipationEvent(animal, mask, animal.tHours[i]));
    }
    for (const i of trans.offs) {
      const d = animal.day[i];
      if (seenOff.has(d)) continue;
      seenOff.add(d);
      evening.push(anticipationEvent(animal, mask, animal.tHours[i]));
    }
    const summarise = (events) => {
      const valid = events.filter((e) => C.isNum(e.ratio));
      if (!valid.length) return { ratio: NaN, diffRatio: NaN, slope: NaN, slopeCI: NaN, nDays: 0, events };
      const slopes = valid.map((e) => e.slope).filter(C.isNum);
      const cis = valid.map((e) => e.slopeCI).filter(C.isNum);
      return {
        ratio: C.mean(valid.map((e) => e.ratio)),
        diffRatio: C.mean(valid.map((e) => e.diffRatio)),
        slope: slopes.length ? C.mean(slopes) : NaN,
        slopeCI: cis.length ? C.mean(cis) : NaN,
        nDays: valid.length,
        events
      };
    };
    const m = summarise(morning);
    const e = summarise(evening);
    return {
      morning: m, evening: e,
      MAI: m.ratio, EAI: e.ratio,
      morningDiff: m.diffRatio, eveningDiff: e.diffRatio,
      morningSlope: m.slope, eveningSlope: e.slope,
      nMorning: m.nDays, nEvening: e.nDays
    };
  }

  /* ============================ combined phase metrics ============================ */
  function phaseMetrics(animal, settings = {}, phaseMap, circadianResult) {
    const mask = I.analysisMask(animal, settings, phaseMap);
    const np = nonParametric(animal, mask);
    const dn = dayNightRatio(animal, mask);
    const peaks = peakPhases(animal, mask);
    const oo = onsetOffset(animal, mask, settings);
    const antic = anticipation(animal, mask, settings);

    // acrophase: use the best periodogram tau if available, otherwise the
    // primary tau from settings / 24 h.
    let cos = null;
    const tau = circadianResult && C.isNum(circadianResult.tau) ? circadianResult.tau : (settings.primaryTau || 24);
    if (global.CircadianLab) {
      const vals = [], zts = [];
      for (let i = 0; i < animal.activity.length; i++) {
        if (mask[i] && C.isNum(animal.activity[i])) { vals.push(animal.activity[i]); zts.push(animal.zt[i]); }
      }
      cos = global.CircadianLab.cosinor(vals, zts, tau, settings.alpha ?? 0.05);
    }

    return {
      mask,
      IS: np.IS, IV: np.IV,
      M10: np.M10, M10center: np.M10center,
      L5: np.L5, L5center: np.L5center,
      RA: np.RA, COG: np.COG,
      dayActivity: dn.light, nightActivity: dn.dark, dayNightRatio: dn.ratio,
      morningPeak: peaks.morningPeak, eveningPeak: peaks.eveningPeak,
      lightsOnHour: peaks.lightsOnHour, lightsOffHour: peaks.lightsOffHour,
      acrophase: cos && !cos.error ? cos.acrophase : NaN,
      cosinor: cos,
      onset: oo.meanOnset, offset: oo.meanOffset,
      onsetSd: oo.sdOnset, offsetSd: oo.sdOffset,
      onsetEntries: oo.onsetEntries, offsetEntries: oo.offsetEntries,
      onsetPhase: C.isNum(oo.meanOnset) ? C.circularDiff(oo.meanOnset, 0) : NaN,
      offsetPhase: C.isNum(oo.meanOffset) && C.isNum(peaks.lightsOffHour) ? C.circularDiff(oo.meanOffset, peaks.lightsOffHour) : NaN,
      nOnsets: oo.nOnsets, nOffsets: oo.nOffsets,
      anticipation: antic,
      MAI: antic.MAI, EAI: antic.EAI,
      morningSlope: antic.morningSlope, eveningSlope: antic.eveningSlope,
      profile: np.profile
    };
  }

  function groupPhaseSummary(rows) {
    const groups = C.unique(rows.map((r) => r.animal.group));
    return groups.map((g) => {
      const rs = rows.filter((r) => r.animal.group === g);
      const m = (key) => C.mean(rs.map((r) => r[key]).filter(C.isNum));
      const s = (key) => rs.map((r) => r[key]).filter(C.isNum);
      return {
        group: g, n: rs.length,
        IS: m('IS'), IV: m('IV'), RA: m('RA'), COG: m('COG'),
        M10: m('M10'), L5: m('L5'), dayNightRatio: m('dayNightRatio'),
        acrophase: m('acrophase'), onset: m('onset'), offset: m('offset'),
        MAI: m('MAI'), EAI: m('EAI'),
        ISsem: C.sem(s('IS')), IVsem: C.sem(s('IV')), RAsem: C.sem(s('RA')),
        MAIsem: C.sem(s('MAI')), EAIsem: C.sem(s('EAI'))
      };
    });
  }

  global.PhaseLab = {
    aggregateToMinutes, hourlyProfile, interdailyStability, intradailyVariability,
    nonParametric, dayNightRatio, peakPhases, onsetOffset, anticipation,
    phaseMetrics, groupPhaseSummary, lightTransitions, bestWindow
  };
})(window);
