/* ============================================================================
 * sleep.js — immobility, sleep scoring, activity metrics, profiles
 * Exposed as window.SleepLab
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;
  const I = global.Importers;

  const STATE = { ACTIVE: 1, INACTIVE: 0, MISSING: 2 };

  /* ============================ immobility ============================ */
  function stateSeries(animal, settings = {}) {
    const n = animal.activity.length;
    const state = new Uint8Array(n);
    const threshold = settings.immobilityThreshold ?? 0;
    for (let i = 0; i < n; i++) {
      if (animal.moving) {
        if (!C.isNum(animal.activity[i]) && animal.movingSeen && !animal.movingSeen[i]) {
          state[i] = STATE.MISSING;
        } else if (animal.moving[i]) {
          state[i] = STATE.ACTIVE;
        } else {
          state[i] = STATE.INACTIVE;
        }
      } else {
        const v = animal.activity[i];
        if (!C.isNum(v)) state[i] = STATE.MISSING;
        else state[i] = v <= threshold ? STATE.INACTIVE : STATE.ACTIVE;
      }
    }
    return state;
  }

  function stateLabel(s) {
    return s === STATE.INACTIVE ? 'inactive' : s === STATE.ACTIVE ? 'active' : 'missing';
  }

  /* ============================ sleep scoring ============================ */
  /**
   * Mark sleep runs of at least `minSleepMinutes` of consecutive immobility.
   * Sleep is assigned retroactively from the start of the run (Hendricks 2000;
   * Shaw 2000). Runs touching an analysis-window edge are flagged truncated.
   *
   * @param {Uint8Array} state
   * @param {Uint8Array} mask
   * @param {number} binMinutes
   * @param {number} minSleepMinutes
   * @returns {{sleep:Uint8Array,boutId:Int32Array,bouts:Array}}
   */
  function scoreSleep(state, mask, binMinutes, minSleepMinutes) {
    const n = state.length;
    const sleep = new Uint8Array(n);
    const boutId = new Int32Array(n).fill(-1);
    const bouts = [];
    const minBins = Math.max(1, Math.ceil(minSleepMinutes / binMinutes - 1e-9));
    let runStart = -1;
    let runLen = 0;
    let runTruncatedStart = false;

    const closeRun = (endExclusive) => {
      if (runStart < 0) return;
      const len = endExclusive - runStart;
      if (len >= minBins) {
        const id = bouts.length;
        const start = runStart;
        const end = endExclusive - 1;
        const truncatedEnd = end === n - 1 || !mask[end + 1];
        const durationMin = len * binMinutes;
        const b = {
          id, start, end, durationMin,
          startTime: start * binMinutes / 60,
          endTime: (end + 1) * binMinutes / 60,
          truncatedStart: runTruncatedStart,
          truncatedEnd,
          truncated: runTruncatedStart || truncatedEnd
        };
        bouts.push(b);
        for (let i = start; i <= end; i++) { sleep[i] = 1; boutId[i] = id; }
      }
      runStart = -1;
      runLen = 0;
      runTruncatedStart = false;
    };

    for (let i = 0; i < n; i++) {
      const inWindow = mask[i] === 1;
      if (inWindow && state[i] === STATE.INACTIVE) {
        if (runStart < 0) {
          runStart = i;
          runLen = 0;
          runTruncatedStart = i === 0 || !mask[i - 1];
        }
        runLen++;
      } else {
        closeRun(i);
      }
    }
    closeRun(n);
    return { sleep, boutId, bouts, minBins };
  }

  function annotateBouts(bouts, animal, binMinutes, settings = {}) {
    const shortMax = settings.shortSleepMax ?? 30;
    const interMax = settings.interSleepMax ?? 60;
    for (const b of bouts) {
      const dayIdx = Math.min(animal.day.length - 1, b.start);
      b.day = animal.day[dayIdx];
      b.startZt = animal.zt[dayIdx];
      b.endZt = animal.zt[Math.min(animal.zt.length - 1, b.end)];
      b.startCt = animal.ct[dayIdx];
      b.endCt = animal.ct[Math.min(animal.ct.length - 1, b.end)];
      const lights = [];
      for (let i = b.start; i <= b.end; i++) if (animal.light[i] === 0 || animal.light[i] === 1) lights.push(animal.light[i]);
      b.lightPhase = lights.length ? (C.mean(lights) >= 0.5 ? 'light' : 'dark') : 'unknown';
      b.category = b.durationMin <= shortMax ? 'short' : b.durationMin <= interMax ? 'intermediate' : 'long';
      b.categoryLabel = b.category === 'short' ? `short (≤${shortMax} min)` :
        b.category === 'intermediate' ? `intermediate (${shortMax}–${interMax} min)` :
          `long (>${interMax} min)`;
    }
    return bouts;
  }

  /* ============================ transitions ============================ */
  function transitionProbabilities(state, mask, maxDayGapBins = 1) {
    let inactive = 0, wake = 0, active = 0, doze = 0;
    for (let i = 0; i < state.length - 1; i++) {
      if (!mask[i] || !mask[i + 1]) continue;
      const s = state[i], t = state[i + 1];
      if (s === STATE.MISSING || t === STATE.MISSING) continue;
      if (s === STATE.INACTIVE) { inactive++; if (t === STATE.ACTIVE) wake++; }
      if (s === STATE.ACTIVE) { active++; if (t === STATE.INACTIVE) doze++; }
    }
    return {
      pWake: inactive ? wake / inactive : NaN,
      pDoze: active ? doze / active : NaN,
      nInactive: inactive, nWake: wake, nActive: active, nDoze: doze
    };
  }

  /* ============================ daily summaries ============================ */
  function dayList(animal, mask) {
    const set = new Set();
    for (let i = 0; i < mask.length; i++) if (mask[i]) set.add(animal.day[i]);
    return [...set].sort((a, b) => a - b);
  }

  function dailyMetrics(animal, mask, state, sleepData, settings = {}) {
    const binMin = animal.binMinutes;
    const binsPerDay = Math.round(1440 / binMin);
    const completeFrac = settings.completeDayFraction ?? 0.9;
    const briefThreshold = settings.briefAwakeningMin ?? 2;
    const days = dayList(animal, mask);
    const out = [];
    for (const d of days) {
      const idx = [];
      for (let i = 0; i < mask.length; i++) if (mask[i] && animal.day[i] === d) idx.push(i);
      if (!idx.length) continue;
      let nValid = 0, nSleep = 0, act = 0;
      let dayAct = 0, nightAct = 0, daySleep = 0, nightSleep = 0;
      let lightN = 0, darkN = 0;
      for (const i of idx) {
        if (animal.light[i] === 1) lightN++;
        else if (animal.light[i] === 0) darkN++;
      }
      // In DD there is no light transition, so day/night is scored on the
      // projected subjective day (CT 0–12) rather than calling all of DD night.
      const phase = lightN > 0 && darkN > 0 ? 'LD' : darkN > 0 ? 'DD' : lightN > 0 ? 'LL' : 'unknown';
      const useSubjective = phase === 'DD' || phase === 'unknown';
      for (const i of idx) {
        const v = animal.activity[i];
        if (C.isNum(v)) { act += v; nValid++; }
        const asleep = sleepData.sleep[i] === 1;
        if (asleep) nSleep++;
        const isDay = useSubjective ? animal.ct[i] < 12 : animal.light[i] === 1;
        if (isDay) { dayAct += C.isNum(v) ? v : 0; if (asleep) daySleep++; }
        else { nightAct += C.isNum(v) ? v : 0; if (asleep) nightSleep++; }
      }
      const validMinutes = nValid * binMin;
      const sleepMin = nSleep * binMin;
      const awakeMin = validMinutes - sleepMin;
      const bouts = sleepData.bouts.filter((b) => b.day === d);
      const durations = bouts.map((b) => b.durationMin);
      const firstIdx = idx[0], lastIdx = idx[idx.length - 1];

      // Latency and WASO are phase-aware: lights-off in LD, projected
      // subjective dusk (CT 12) in DD, and no dark window in LL.
      let latency = NaN, latencyPhase = '—';
      let latencyStart = null, wasoStart = null, wasoEnd = null;
      if (phase === 'LD') {
        const firstDark = idx.find((i) => animal.light[i] === 0);
        const firstLight = idx.find((i) => animal.light[i] === 1);
        latencyStart = firstDark !== undefined ? firstDark : (firstLight !== undefined ? firstLight : null);
        latencyPhase = firstDark !== undefined ? 'lights-off' : 'lights-on';
        if (firstDark !== undefined) {
          wasoStart = firstDark;
          wasoEnd = [...idx].reverse().find((i) => animal.light[i] === 0);
        }
      } else if (phase === 'DD') {
        latencyStart = idx.find((i) => animal.ct[i] >= 12) ?? null;
        latencyPhase = 'subjective dusk';
        wasoStart = latencyStart;
        wasoEnd = lastIdx;
      } else if (phase === 'LL') {
        latencyStart = idx[0];
        latencyPhase = 'lights-on';
      }
      if (latencyStart !== null) {
        let firstSleep = null;
        for (const i of idx) if (i >= latencyStart && sleepData.sleep[i] === 1) { firstSleep = i; break; }
        if (firstSleep !== null) latency = (firstSleep - latencyStart) * binMin;
        else latency = (lastIdx - latencyStart + 1) * binMin;
      }
      let waso = NaN;
      if (wasoStart !== null && wasoEnd !== null) {
        let firstSleepDark = null;
        for (const i of idx) if (i >= wasoStart && i <= wasoEnd && sleepData.sleep[i] === 1) { firstSleepDark = i; break; }
        if (firstSleepDark !== null) {
          let awake = 0;
          for (const i of idx) {
            if (i >= firstSleepDark && i <= wasoEnd && sleepData.sleep[i] !== 1 && state[i] !== STATE.MISSING) awake++;
          }
          waso = awake * binMin;
        }
      }

      // brief awakenings between sleep bouts
      let brief = 0;
      let awakeRun = 0;
      for (const i of idx) {
        if (sleepData.sleep[i] === 1) {
          if (awakeRun > 0 && awakeRun * binMin < briefThreshold) brief++;
          awakeRun = 0;
        } else if (state[i] !== STATE.MISSING) {
          awakeRun++;
        }
      }

      const trans = transitionProbabilities(state, (() => {
        const m = new Uint8Array(mask.length);
        for (const i of idx) m[i] = 1;
        // only count transitions inside the day
        for (let i = 0; i < m.length; i++) if (m[i] && (i === 0 || animal.day[i - 1] !== d)) m[i] = 1;
        return m;
      })());

      const categories = { short: 0, intermediate: 0, long: 0 };
      for (const b of bouts) categories[b.category] = (categories[b.category] || 0) + b.durationMin;

      out.push({
        day: d,
        phase,
        nBins: idx.length,
        validMinutes,
        complete: idx.length >= binsPerDay * completeFrac,
        activity: act,
        activityPerDay: act,
        dayActivity: dayAct,
        nightActivity: nightAct,
        lightFraction: dayAct + nightAct > 0 ? dayAct / (dayAct + nightAct) : NaN,
        sleepMin,
        sleepPerDay: sleepMin,
        daySleepMin: daySleep * binMin,
        nightSleepMin: nightSleep * binMin,
        sleepPercent: validMinutes > 0 ? 100 * sleepMin / validMinutes : NaN,
        awakeMin,
        activityPerAwakeMin: awakeMin > 0 ? act / awakeMin : NaN,
        boutCount: bouts.length,
        meanBoutLen: durations.length ? C.mean(durations) : 0,
        medianBoutLen: durations.length ? C.median(durations) : 0,
        maxBoutLen: durations.length ? C.max(durations) : 0,
        briefAwakenings: brief,
        latency,
        latencyPhase,
        waso,
        fragmentation: sleepMin > 0 ? bouts.length / (sleepMin / 60) : NaN,
        pWake: trans.pWake,
        pDoze: trans.pDoze,
        nTransitions: trans.nInactive + trans.nActive,
        categorySleepMin: categories
      });
    }
    return out;
  }

  /* ============================ animal summary ============================ */
  function summarizeAnimal(animal, settings = {}, phaseMap) {
    const state = stateSeries(animal, settings);
    const mask = I.analysisMask(animal, settings, phaseMap);
    const sleepData = scoreSleep(state, mask, animal.binMinutes, settings.minSleepMinutes ?? 5);
    annotateBouts(sleepData.bouts, animal, animal.binMinutes, settings);
    const daily = dailyMetrics(animal, mask, state, sleepData, settings);
    const complete = daily.filter((d) => d.complete);
    const use = complete.length ? complete : daily;
    const mean = (key) => C.mean(use.map((d) => d[key]).filter(C.isNum));
    const total = (key) => C.sum(use.map((d) => d[key]).filter(C.isNum));
    const trans = transitionProbabilities(state, mask);
    // Separate transition probabilities for the light and dark phases. In DD
    // the projected subjective day/night (CT) is used.
    let lightN = 0, darkN = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      if (animal.light[i] === 1) lightN++;
      else if (animal.light[i] === 0) darkN++;
    }
    const phaseMode = lightN > 0 && darkN > 0 ? 'LD' : darkN > 0 ? 'DD' : lightN > 0 ? 'LL' : 'unknown';
    const dayMask = new Uint8Array(mask.length);
    const nightMask = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const isDay = phaseMode === 'LL' ? true : (phaseMode === 'DD' || phaseMode === 'unknown' ? animal.ct[i] < 12 : animal.light[i] === 1);
      if (isDay) dayMask[i] = 1; else nightMask[i] = 1;
    }
    const transDay = transitionProbabilities(state, dayMask);
    const transNight = transitionProbabilities(state, nightMask);
    const allBouts = sleepData.bouts;
    const durs = allBouts.map((b) => b.durationMin);
    const categories = { short: 0, intermediate: 0, long: 0 };
    for (const b of allBouts) categories[b.category] += b.durationMin;

    // activity totals over the whole mask; day/night totals come from the
    // daily records so DD subjective-day scoring is respected.
    let totalActivity = 0, totalSleep = 0;
    let nValid = 0, nAll = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      nAll++;
      const v = animal.activity[i];
      if (C.isNum(v)) { totalActivity += v; nValid++; }
      if (sleepData.sleep[i]) totalSleep += animal.binMinutes;
    }
    const dayAct = C.sum(daily.map((d) => d.dayActivity));
    const nightAct = C.sum(daily.map((d) => d.nightActivity));
    const daySleep = C.sum(daily.map((d) => d.daySleepMin));
    const nightSleep = C.sum(daily.map((d) => d.nightSleepMin));
    const useDays = complete.length ? complete : daily;
    const nDaysAnalysed = Math.max(1, useDays.length);
    const daySleepPerDay = C.mean(useDays.map((d) => d.daySleepMin).filter(C.isNum));
    const nightSleepPerDay = C.mean(useDays.map((d) => d.nightSleepMin).filter(C.isNum));
    const dayActivityPerDay = C.mean(useDays.map((d) => d.dayActivity).filter(C.isNum));
    const nightActivityPerDay = C.mean(useDays.map((d) => d.nightActivity).filter(C.isNum));

    return {
      animal,
      id: animal.id,
      group: animal.group,
      genotype: animal.genotype,
      sex: animal.sex,
      treatment: animal.treatment,
      well: animal.well,
      channel: animal.channel,
      format: animal.format,
      alive: animal.alive,
      flags: animal.flags.slice(),
      daysAnalyzed: daily.length,
      completeDays: complete.length,
      totalActivity,
      meanActivityPerDay: mean('activity'),
      dayActivity: dayAct,
      nightActivity: nightAct,
      lightFraction: dayAct + nightAct > 0 ? dayAct / (dayAct + nightAct) : NaN,
      totalSleepMin: totalSleep,
      meanSleepPerDay: mean('sleepMin'),
      daySleepMin: daySleep,
      nightSleepMin: nightSleep,
      daySleepPerDay,
      nightSleepPerDay,
      dayActivityPerDay,
      nightActivityPerDay,
      sleepPercent: nValid > 0 ? 100 * totalSleep / (nValid * animal.binMinutes) : NaN,
      meanBoutCountPerDay: mean('boutCount'),
      meanBoutLen: durs.length ? C.mean(durs) : 0,
      medianBoutLen: durs.length ? C.median(durs) : 0,
      maxBoutLen: durs.length ? C.max(durs) : 0,
      totalBouts: allBouts.length,
      boutDistribution: durs,
      meanLatency: mean('latency'),
      meanWaso: mean('waso'),
      meanBriefAwakenings: mean('briefAwakenings'),
      fragmentation: mean('fragmentation'),
      pWake: trans.pWake,
      pDoze: trans.pDoze,
      pWakeDay: transDay.pWake,
      pDozeDay: transDay.pDoze,
      pWakeNight: transNight.pWake,
      pDozeNight: transNight.pDoze,
      activityPerAwakeMin: mean('activityPerAwakeMin'),
      categorySleepMin: categories,
      categorySleepPerDay: {
        short: categories.short / nDaysAnalysed,
        intermediate: categories.intermediate / nDaysAnalysed,
        long: categories.long / nDaysAnalysed
      },
      sleepData,
      daily,
      state,
      mask,
      missingFraction: nAll ? 1 - nValid / nAll : NaN
    };
  }

  /* ============================ profiles ============================ */
  const VARIABLE_LABEL = {
    activity: 'Activity (counts/bin)',
    sleepMin: 'Sleep (min/bin)',
    sleepFrac: 'Fraction asleep',
    pWake: 'P(wake)',
    pDoze: 'P(doze)',
    boutCount: 'Sleep bouts initiated',
    boutLen: 'Mean bout length (min)',
    activityAwake: 'Activity per awake minute'
  };

  function timeValue(animal, i, base) {
    if (base === 'CT') return animal.ct[i];
    if (base === 'clock') return animal.clock[i];
    return animal.zt[i];
  }

  function perAnimalProfile(animal, mask, variable, resMin, base, settings = {}) {
    const nSlots = Math.round(24 * 60 / resMin);
    const slotSum = new Array(nSlots).fill(0);
    const slotN = new Array(nSlots).fill(0);
    const daySet = new Set();
    const daySlotSum = new Map(); // day -> array
    const daySlotN = new Map();
    const needsState = variable === 'pWake' || variable === 'pDoze' || variable === 'activityAwake';
    const transitionCache = needsState ? stateSeries(animal, settings) : null;
    const sleepData = (variable.startsWith('sleep') || variable === 'boutCount' || variable === 'boutLen')
      ? scoreSleep(transitionCache || stateSeries(animal, settings), mask, animal.binMinutes, settings.minSleepMinutes ?? 5)
      : null;
    if (sleepData) annotateBouts(sleepData.bouts, animal, animal.binMinutes, settings);
    const boutStarts = sleepData ? new Set(sleepData.bouts.map((b) => b.start)) : null;

    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const t = timeValue(animal, i, base);
      if (!C.isNum(t)) continue;
      const slot = Math.min(nSlots - 1, Math.floor((((t % 24) + 24) % 24) * 60 / resMin));
      const d = animal.day[i];
      daySet.add(d);
      if (!daySlotSum.has(d)) {
        daySlotSum.set(d, new Array(nSlots).fill(0));
        daySlotN.set(d, new Array(nSlots).fill(0));
      }
      const sums = daySlotSum.get(d);
      const counts = daySlotN.get(d);
      let v;
      switch (variable) {
        case 'activity': v = animal.activity[i]; break;
        case 'sleepMin': v = sleepData && sleepData.sleep[i] ? animal.binMinutes : 0; break;
        case 'sleepFrac': v = sleepData && sleepData.sleep[i] ? 1 : 0; break;
        case 'pWake':
        case 'pDoze': {
          v = NaN;
          if (i < mask.length - 1 && mask[i + 1] && animal.day[i + 1] === d) {
            const s = transitionCache[i], n = transitionCache[i + 1];
            if (s !== STATE.MISSING && n !== STATE.MISSING) {
              if (variable === 'pWake' && s === STATE.INACTIVE) v = n === STATE.ACTIVE ? 1 : 0;
              if (variable === 'pDoze' && s === STATE.ACTIVE) v = n === STATE.INACTIVE ? 1 : 0;
            }
          }
          break;
        }
        case 'boutCount': {
          // count bouts starting in this slot on this day
          v = boutStarts && boutStarts.has(i) ? 1 : 0;
          break;
        }
        case 'boutLen': {
          v = NaN;
          if (sleepData) {
            const bid = sleepData.boutId[i];
            if (bid >= 0) v = sleepData.bouts[bid].durationMin;
          }
          break;
        }
        case 'activityAwake': {
          const st = transitionCache ? transitionCache[i] : STATE.MISSING;
          if (st === STATE.ACTIVE && C.isNum(animal.activity[i])) v = animal.activity[i];
          break;
        }
        default: v = NaN;
      }
      if (C.isNum(v)) { sums[slot] += v; counts[slot]++; }
    }

    const profile = new Array(nSlots).fill(NaN);
    const binsPerSlot = Math.max(1, resMin / animal.binMinutes);
    for (let s = 0; s < nSlots; s++) {
      let sumD = 0, nD = 0;
      for (const d of daySet) {
        const sums = daySlotSum.get(d);
        const counts = daySlotN.get(d);
        if (counts[s] > 0) { sumD += sums[s] / counts[s]; nD++; }
      }
      profile[s] = nD ? sumD / nD : NaN;
      if (variable === 'boutCount') profile[s] *= binsPerSlot;
    }
    return { profile, nDays: daySet.size };
  }

  function normalizeProfile(profile, mode, dailyMean) {
    if (!mode || mode === 'none') return profile.slice();
    const vals = profile.filter(C.isNum);
    if (!vals.length) return profile.slice();
    if (mode === 'dailyMean') {
      const m = dailyMean || C.mean(vals);
      return profile.map((v) => C.isNum(v) && m > 0 ? v / m : NaN);
    }
    if (mode === 'max') {
      const m = C.max(vals);
      return profile.map((v) => C.isNum(v) && m > 0 ? v / m : NaN);
    }
    if (mode === 'zscore') {
      const m = C.mean(vals), s = C.sd(vals);
      return profile.map((v) => C.isNum(v) && s > 0 ? (v - m) / s : NaN);
    }
    if (mode === 'fraction') {
      const s = C.sum(vals);
      return profile.map((v) => C.isNum(v) && s > 0 ? v / s : NaN);
    }
    return profile.slice();
  }

  function groupProfiles(animals, settings, phaseMap, variable, resMin, base, opts = {}) {
    const nSlots = Math.round(24 * 60 / resMin);
    const groups = C.unique(animals.map((a) => a.group));
    const result = [];
    for (const g of groups) {
      const members = animals.filter((a) => a.group === g);
      const profiles = [];
      for (const a of members) {
        const mask = I.analysisMask(a, settings, phaseMap);
        if (!mask.some((v) => v)) continue;
        const p = perAnimalProfile(a, mask, variable, resMin, base, settings);
        let prof = p.profile;
        if (opts.normalise && opts.normalise !== 'none') {
          const dailyMean = variable === 'activity'
            ? C.mean(a.activity.filter((v, i) => mask[i] && C.isNum(v)))
            : undefined;
          prof = normalizeProfile(prof, opts.normalise, dailyMean);
        }
        profiles.push(prof);
      }
      const mean = new Array(nSlots).fill(NaN);
      const sdv = new Array(nSlots).fill(NaN);
      const semv = new Array(nSlots).fill(NaN);
      const nv = new Array(nSlots).fill(0);
      for (let s = 0; s < nSlots; s++) {
        const vals = profiles.map((p) => p[s]).filter(C.isNum);
        nv[s] = vals.length;
        if (vals.length) {
          mean[s] = C.mean(vals);
          if (vals.length > 1) { sdv[s] = C.sd(vals); semv[s] = C.sem(vals); }
        }
      }
      result.push({ group: g, mean, sd: sdv, sem: semv, n: nv, profiles, nAnimals: members.length });
    }
    const times = Array.from({ length: nSlots }, (_, i) => i * resMin / 60);
    return { variable, label: VARIABLE_LABEL[variable] || variable, times, resMin, base, groups: result };
  }

  /* ============================ architecture ============================ */
  function hourlyArchitecture(animal, mask, sleepData, settings = {}) {
    const hours = 24;
    const sleepMin = new Array(hours).fill(0);
    const bouts = new Array(hours).fill(0);
    const boutLenSum = new Array(hours).fill(0);
    const boutLenN = new Array(hours).fill(0);
    const days = new Set();
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const h = Math.min(hours - 1, Math.floor(animal.zt[i]));
      days.add(animal.day[i]);
      if (sleepData.sleep[i]) sleepMin[h] += animal.binMinutes;
    }
    for (const b of sleepData.bouts) {
      // longest overlap with each hour
      const hStart = Math.min(hours - 1, Math.floor(b.startZt));
      bouts[hStart]++;
      boutLenSum[hStart] += b.durationMin;
      boutLenN[hStart]++;
    }
    const nDays = Math.max(1, days.size);
    return {
      hours: Array.from({ length: hours }, (_, h) => h),
      sleepPerDay: sleepMin.map((v) => v / nDays),
      boutCountPerDay: bouts.map((v) => v / nDays),
      meanBoutLen: boutLenSum.map((v, i) => boutLenN[i] ? v / boutLenN[i] : NaN),
      nDays
    };
  }

  /* ============================ rebound ============================ */
  function sleepRebound(animals, summaries, settings = {}) {
    const baseline = settings.reboundBaseline || [];
    const deprivation = settings.reboundDeprivation || [];
    const recovery = settings.reboundRecovery || [];
    if (!baseline.length || !recovery.length) return null;
    const rows = [];
    for (const s of summaries) {
      const daily = s.daily.filter((d) => d.complete);
      const pick = (days) => C.mean(daily.filter((d) => days.includes(d.day)).map((d) => d.sleepMin));
      const base = pick(baseline);
      const dep = deprivation.length ? pick(deprivation) : NaN;
      const rec = pick(recovery);
      const lost = C.isNum(dep) ? base - dep : NaN;
      rows.push({
        id: s.id, group: s.group,
        baseline: base, deprivation: dep, recovery: rec,
        rebound: rec - base,
        lostSleep: lost,
        reboundPercent: lost > 0 ? 100 * (rec - base) / lost : NaN
      });
    }
    return rows;
  }

  /* ============================ whole timeline ============================ */
  function wholeTimeline(animals, settings, phaseMap, binMin = 30) {
    let maxT = 0;
    for (const a of animals) {
      const mask = I.analysisMask(a, settings, phaseMap);
      for (let i = mask.length - 1; i >= 0; i--) if (mask[i]) { maxT = Math.max(maxT, a.tHours[i]); break; }
    }
    const nBins = Math.max(1, Math.ceil(maxT / (binMin / 60)) + 1);
    const groups = C.unique(animals.map((a) => a.group));
    const out = [];
    for (const g of groups) {
      const members = animals.filter((a) => a.group === g);
      const perAnimal = [];
      for (const a of members) {
        const mask = I.analysisMask(a, settings, phaseMap);
        const sums = new Array(nBins).fill(0);
        const counts = new Array(nBins).fill(0);
        for (let i = 0; i < a.activity.length; i++) {
          if (!mask[i] || !C.isNum(a.activity[i])) continue;
          const b = Math.min(nBins - 1, Math.floor(a.tHours[i] / (binMin / 60)));
          sums[b] += a.activity[i];
          counts[b]++;
        }
        perAnimal.push(sums.map((s, b) => counts[b] ? s / counts[b] : NaN));
      }
      const mean = new Array(nBins).fill(NaN);
      const sem = new Array(nBins).fill(NaN);
      for (let b = 0; b < nBins; b++) {
        const vals = perAnimal.map((p) => p[b]).filter(C.isNum);
        if (vals.length) {
          mean[b] = C.mean(vals);
          if (vals.length > 1) sem[b] = C.sem(vals);
        }
      }
      out.push({ group: g, times: Array.from({ length: nBins }, (_, i) => i * binMin / 60), mean, sem });
    }
    return out;
  }

  /* ============================ raster ============================ */
  function stateRaster(animals, settings, phaseMap, binMin = 30) {
    let maxT = 0;
    for (const a of animals) maxT = Math.max(maxT, a.tHours[a.tHours.length - 1]);
    const nBins = Math.max(1, Math.ceil(maxT / (binMin / 60)) + 1);
    const rows = [];
    for (const a of animals) {
      const mask = I.analysisMask(a, settings, phaseMap);
      const state = stateSeries(a, settings);
      const sleepData = scoreSleep(state, mask, a.binMinutes, settings.minSleepMinutes ?? 5);
      const row = new Array(nBins).fill(NaN);
      const cover = new Array(nBins).fill(0);
      for (let i = 0; i < a.activity.length; i++) {
        if (!mask[i]) continue;
        const b = Math.min(nBins - 1, Math.floor(a.tHours[i] / (binMin / 60)));
        if (sleepData.sleep[i]) row[b] = 1;
        else if (C.isNum(a.activity[i]) || state[i] === STATE.ACTIVE) row[b] = 0;
        cover[b]++;
      }
      rows.push({ id: a.id, group: a.group, state: row, cover });
    }
    return { times: Array.from({ length: nBins }, (_, i) => i * binMin / 60), rows, binMin };
  }

  /* ============================ exports ============================ */
  function timeSeriesTable(animal, settings, phaseMap) {
    const mask = I.analysisMask(animal, settings, phaseMap);
    const state = stateSeries(animal, settings);
    const sleepData = scoreSleep(state, mask, animal.binMinutes, settings.minSleepMinutes ?? 5);
    const rows = [];
    for (let i = 0; i < animal.activity.length; i++) {
      if (!mask[i]) continue;
      rows.push([
        animal.id, animal.group, animal.genotype,
        (animal.tHours[i]).toFixed(4),
        animal.activity[i] === undefined || animal.activity[i] === null ? 'NA' : animal.activity[i],
        state[i] === STATE.MISSING ? 'NA' : (state[i] === STATE.ACTIVE ? '1' : '0'),
        sleepData.sleep[i],
        animal.light[i] === null ? 'NA' : animal.light[i],
        animal.zt[i].toFixed(3),
        animal.ct[i].toFixed(3),
        animal.day[i]
      ]);
    }
    return rows;
  }

  global.SleepLab = {
    STATE, stateSeries, stateLabel, scoreSleep, annotateBouts,
    transitionProbabilities, dailyMetrics, summarizeAnimal,
    perAnimalProfile, groupProfiles, normalizeProfile, hourlyArchitecture,
    sleepRebound, wholeTimeline, stateRaster, timeSeriesTable,
    VARIABLE_LABEL
  };
})(window);
