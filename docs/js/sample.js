/* ============================================================================
 * sample.js — deterministic synthetic datasets for the demo and validation
 * Exposed as window.SampleData
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;

  function rngFactory(seed) {
    let s = seed >>> 0;
    return () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function gauss(x, mu, sd) {
    const d = (x - mu) / sd;
    return Math.exp(-0.5 * d * d);
  }
  function randn(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(C.TAU * v);
  }

  const GROUPS = {
    Control: { tau: 24.0, amp: 1.0, night: 0.06, frag: 0.012, phase: 0 },
    'Short-period': { tau: 22.0, amp: 0.85, night: 0.08, frag: 0.02, phase: 0.4 },
    'Long-period': { tau: 26.0, amp: 0.72, night: 0.1, frag: 0.045, phase: -0.3 }
  };

  function drive(phase) {
    // Two activity peaks (morning and evening) plus a low daytime baseline.
    const morning = gauss(phase, 1.0, 1.6);
    const evening = gauss(phase, 11.2, 1.5);
    const midday = gauss(phase, 6.0, 2.6);
    return 0.95 * morning + 1.05 * evening + 0.32 * midday + 0.035;
  }

  function generateDemo(opts = {}) {
    const daysLD = opts.daysLD ?? 5;
    const daysDD = opts.daysDD ?? 9;
    const totalDays = daysLD + daysDD;
    const binMin = opts.binMin ?? 1;
    const perGroup = opts.perGroup ?? 6;
    const start = new Date(2026, 0, 5, 8, 0, 0);
    const totalBins = Math.round(totalDays * 1440 / binMin);
    const times = new Array(totalBins);
    const light = new Array(totalBins);
    const startClock = start.getHours() + start.getMinutes() / 60;
    for (let i = 0; i < totalBins; i++) {
      times[i] = new Date(start.getTime() + i * binMin * 60000);
      const t = i * binMin;
      const clock = (startClock + t / 60) % 24;
      const day = Math.floor(t / 1440);
      light[i] = day < daysLD && clock >= 8 && clock < 20 ? 1 : 0;
    }
    const series = {};
    const labels = {};
    const configs = [];
    let idx = 0;
    for (const [group, p] of Object.entries(GROUPS)) {
      for (let a = 0; a < perGroup; a++) {
        idx++;
        const key = `${group.replace(/\W+/g, '')}-${String(a + 1).padStart(2, '0')}`;
        const rng = rngFactory(1200 + idx * 97);
        const act = new Array(totalBins);
        const tau = p.tau + (rng() - 0.5) * 0.4;
        const amp = p.amp * (0.82 + rng() * 0.35);
        const frag = p.frag * (0.5 + rng());
        // last LD lights-on gives the DD phase reference
        const lastOnBin = Math.floor((daysLD * 1440 - 12 * 60) / binMin); // 08:00 on last LD day
        for (let i = 0; i < totalBins; i++) {
          const tMin = i * binMin;
          const clock = (startClock + tMin / 60) % 24;
          const day = Math.floor(tMin / 1440);
          let phase;
          if (day < daysLD) {
            // LD: use ZT (time since lights-on at 08:00) so the morning and
            // evening peaks sit at the transitions, as in a real LD cycle.
            phase = ((clock - 8) % 24 + 24) % 24;
          } else {
            // subjective time in hours, free-running at tau
            const hoursSinceOn = (tMin - (daysLD - 1) * 1440 - 480) / 60;
            phase = (((hoursSinceOn * 24 / tau) % 24) + 24) % 24;
          }
          const d = drive((phase + p.phase + 24) % 24);
          const isDark = day < daysLD && (clock < 8 || clock >= 20);
          const nightFactor = isDark ? p.night : 0.01;
          let rate = amp * d + nightFactor;
          // sleep gate: below ~0.16 the animal is inactive
          let v = 0;
          if (rate > 0.16) {
            v = Math.max(0, Math.round(rate * 28 * (0.6 + rng() * 0.8) + randn(rng) * Math.sqrt(rate * 6 + 0.2)));
          }
          // brief awakenings during sleep
          if (v === 0 && rng() < frag) v = Math.round(2 + rng() * 5);
          act[i] = v;
        }
        // one animal with a short gap demonstrates NA handling
        if (group === 'Long-period' && a === perGroup - 1) {
          const gapStart = Math.floor((daysDD * 0.55 * 1440) / binMin);
          for (let i = gapStart; i < gapStart + Math.round(90 / binMin); i++) act[i] = NaN;
        }
        series[key] = act;
        labels[key] = key;
        configs.push({
          key, id: key, channel: idx, well: key, group,
          sex: a % 2 === 0 ? 'female' : 'male',
          treatment: group === 'Control' ? 'wild-type' : 'mutant',
          include: true,
          file: 'Synthetic demo'
        });
      }
    }
    return {
      dataset: {
        kind: 'wide', format: 'demo', name: 'Synthetic demo (LD→DD)',
        times, start, startClockHour: startClock, light, series, keys: Object.keys(series),
        labels, binMinutes: binMin,
        meta: { daysLD, daysDD, groups: Object.keys(GROUPS), note: 'Deterministic synthetic data for demonstration only.' }
      },
      configs
    };
  }

  /**
   * A clean synthetic signal with a known period, for the in-app validation
   * panel. The signal is a noisy cosine at `tau` hours plus optional gaps.
   */
  function syntheticSignal(tau, days = 14, binMin = 30, noise = 0.35, seed = 7, gaps = 0) {
    const rng = rngFactory(seed);
    const n = Math.round(days * 1440 / binMin);
    const times = new Array(n);
    const values = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * binMin / 60;
      times[i] = t;
      values[i] = 5 + 3 * Math.cos(C.TAU * (t - 2) / tau) + noise * randn(rng);
    }
    for (let g = 0; g < gaps; g++) {
      const start = Math.floor(rng() * (n - 20));
      const len = 4 + Math.floor(rng() * 12);
      for (let i = start; i < start + len; i++) values[i] = NaN;
    }
    return { values, times, binMin, tau };
  }

  function runValidation() {
    const cases = [23.5, 24.0, 25.0, 26.0];
    const out = [];
    for (const tau of cases) {
      const sig = syntheticSignal(tau, 14, 30, 0.25, Math.round(tau * 100));
      const cs = global.CircadianLab.chiSquare(sig.values, sig.binMin, { minPeriod: 16, maxPeriod: 32, step: 0.1, alpha: 0.05, powerMin: 10, widthMin: 2 });
      const ls = global.CircadianLab.lombScargle(sig.values, sig.times, { minPeriod: 16, maxPeriod: 32, step: 0.1, alpha: 0.05 });
      const ac = global.CircadianLab.autocorrelation(sig.values, sig.binMin, { maxLagHours: 120, smoothBins: 3, rippleMin: 0.3 });
      const ff = global.CircadianLab.fftPeriodogram(sig.values, sig.binMin, { minPeriod: 16, maxPeriod: 32 });
      const cos = global.CircadianLab.cosinorBest(sig.values, sig.times, { minPeriod: 16, maxPeriod: 32, step: 0.25 });
      out.push({
        expected: tau,
        chiSquare: cs.tau,
        lombScargle: ls.tau,
        autocorrelation: ac.tau,
        fft: ff.tau,
        cosinor: cos.tau,
        chiSquareError: cs.tau - tau,
        lombScargleError: ls.tau - tau,
        autocorrelationError: ac.tau - tau,
        fftError: ff.tau - tau,
        cosinorError: cos.tau - tau,
        rhythmic: cs.rhythmic
      });
    }
    return out;
  }

  function runPropertyTests() {
    // Sleep scoring properties: every bout must be >= the threshold and the
    // sum of sleep bins must equal the total sleep.
    const binMin = 1;
    const n = 5000;
    const rng = rngFactory(99);
    const state = new Uint8Array(n);
    for (let i = 0; i < n; i++) state[i] = rng() < 0.35 ? 0 : 1;
    const mask = new Uint8Array(n).fill(1);
    const res = global.SleepLab.scoreSleep(state, mask, binMin, 5);
    const minBout = C.min(res.bouts.map((b) => b.durationMin));
    const sumSleep = res.sleep.reduce((s, v) => s + v, 0) * binMin;
    const boutSum = res.bouts.reduce((s, b) => s + b.durationMin, 0);
    return [
      { test: 'Every sleep bout ≥ 5 min', pass: !res.bouts.length || minBout >= 5, detail: `${res.bouts.length} bouts; minimum ${C.isNum(minBout) ? minBout.toFixed(1) : '—'} min` },
      { test: 'Σ sleep bins = Σ bout durations', pass: Math.abs(sumSleep - boutSum) < 1e-9, detail: `${sumSleep.toFixed(1)} vs ${boutSum.toFixed(1)} min` },
      { test: 'Sleep is assigned retroactively from run start', pass: res.bouts.every((b) => res.sleep[b.start] === 1), detail: 'start bins flagged asleep' }
    ];
  }

  global.SampleData = { generateDemo, syntheticSignal, runValidation, runPropertyTests, GROUPS };
})(window);
