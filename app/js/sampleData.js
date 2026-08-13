/* ============================================================================
 * sampleData.js — synthetic demo dataset generator
 * Produces a realistic Zantiks CSV + metadata CSV so the app can be tested
 * without real experimental files.
 * Exposed globally as window.ZSampleData.
 * ==========================================================================*/
window.ZSampleData = (function () {
  'use strict';

  // deterministic RNG so the demo is reproducible
  let seed = 20250801;
  function rng() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const GENOTYPES = {
    CTRL: { amp: 32, night: 3, period: 24.0, frag: 0.0 },
    Axenic: { amp: 48, night: 5, period: 23.5, frag: 0.0 },
    hTauOE: { amp: 20, night: 4, period: 22.0, frag: 0.5 }
  };

  const WELLS = [];
  for (const row of ['A', 'B', 'C', 'D']) {
    for (let c = 1; c <= 6; c++) WELLS.push(row + c);
  }
  // A+B rows → CTRL, C row → Axenic, D row → hTauOE
  const WELL_GENOTYPE = (w) => (w[0] === 'A' || w[0] === 'B' ? 'CTRL' : w[0] === 'C' ? 'Axenic' : 'hTauOE');

  function gauss(x, mu, sd) {
    const d = (x - mu) / sd;
    return Math.exp(-0.5 * d * d);
  }

  // circadian drive function — subjective day with dawn/dusk peaks and a small
  // baseline. Kept tight so the "subjective night" stays below the sleep gate.
  function drive(x, amp) {
    return amp * (gauss(x, 11, 3.0) + 0.45 * gauss(x, 8, 1.5) + 0.45 * gauss(x, 20, 1.5) + 0.10);
  }

  /**
   * Generate one fly's 1-min activity series.
   * @param {string} genotype
   * @param {number} totalMin
   * @param {Array<number>} lightArr 1/0 per minute (real time)
   * @param {number} daysLD
   * @param {number} startOffsetMin offset of experiment start within the day (e.g. 480 = 08:00)
   */
  function genFlyActivity(genotype, totalMin, lightArr, daysLD, startOffsetMin) {
    const p = GENOTYPES[genotype] || GENOTYPES.CTRL;
    const act = new Array(totalMin);
    const gate = p.amp * 0.30; // below this rate the fly is asleep (hard gate)
    for (let i = 0; i < totalMin; i++) {
      const realTod = ((i + startOffsetMin) % 1440) / 60; // real time-of-day
      const day = Math.floor(i / 1440);
      let rate;
      if (day < daysLD) {
        // LD entrainment: light on 08:00–20:00 real time
        rate = lightArr[i] === 1 ? drive(realTod, p.amp) : p.night;
      } else {
        // DD free-run: the endogenous clock oscillates at the fly's intrinsic
        // period P, so the signal is periodic in REAL time with period P.
        // Subjective time-of-day: sTod(t) = (t * 24 / P) mod 24.
        const sTod = ((i * 24 * 60 / p.period) % 1440) / 60;
        rate = drive(sTod, p.amp) * 0.9 + p.night * 0.4;
      }
      // hard sleep gate: asleep when drive below threshold; awake otherwise
      let v = 0;
      if (rate >= gate) {
        v = Math.max(0, Math.round(rate * (0.7 + 0.6 * rng()) + randn() * Math.sqrt(rate + 1)));
      }
      // fragmentation for tauopathy flies: brief waking interruptions during sleep
      if (p.frag > 0 && v === 0 && rng() < p.frag * 0.08) {
        v = Math.round(p.amp * 0.25);
      }
      act[i] = v;
    }
    return act;
  }

  /**
   * Build the full demo dataset.
   * @returns {object} { zantiksCsv, metadataCsv, zantiksName, metadataName, startDt, totalMin, daysLD }
   */
  function generateSampleData() {
    seed = 20250801;
    const daysLD = 5;
    const totalDays = 14;
    const totalMin = totalDays * 1440;

    const start = new Date(2025, 7, 1, 8, 0, 0); // 01/08/2025 08:00:00
    const startStr = '01/08/2025 08:00:00';
    const startOffsetMin = start.getHours() * 60 + start.getMinutes(); // 480

    // light schedule (real time-of-day)
    const lightArr = new Array(totalMin);
    for (let i = 0; i < totalMin; i++) {
      const day = Math.floor(i / 1440);
      const tod = ((i + startOffsetMin) % 1440) / 60;
      lightArr[i] = day < daysLD && tod >= 8 && tod < 20 ? 1 : 0;
    }

    // per-well activity
    const flyActivity = {};
    for (const w of WELLS) {
      flyActivity[w] = genFlyActivity(WELL_GENOTYPE(w), totalMin, lightArr, daysLD, startOffsetMin);
    }

    // ---- build Zantiks CSV ----
    const lines = [];
    lines.push(`0,Info,${startStr},Service 'Zantiks MWP' : Execution start`);
    lines.push('0,Info,Subject Identification,Circadian Rhythms Glasgow');
    lines.push('0,Info,Apparatus,Zantiks MWP');
    lines.push('0,Info,Unit ID,MWP-01');
    lines.push('RUNTIME,UNIT,TEMPERATURE,L_OR_D,DAY,HOUR,TIME_BIN,' + WELLS.join(','));

    for (let i = 0; i < totalMin; i++) {
      const runtime = i * 60;
      const day = Math.floor(i / 1440) + 1;
      const hour = (i % 1440) / 60;
      const temp = 25.0 + 0.4 * Math.sin(i / 180) + randn() * 0.15;
      const ld = lightArr[i] === 1 ? 'LIGHT' : 'DARK';
      const cells = [String(runtime), 'MWP-01', temp.toFixed(2), ld, String(day), hour.toFixed(4), String(i + 1)];
      for (const w of WELLS) cells.push(String(flyActivity[w][i]));
      lines.push(cells.join(','));
    }
    const zantiksCsv = lines.join('\n');

    // ---- build metadata CSV ----
    const stopStr = '15/08/2025 07:59:00';
    const mhead = ['file', 'start_datetime', 'stop_datetime', 'region_id', 'well', 'genotype', 'sex', 'replicate', 'exp', 'observations'];
    const mrows = [];
    const repCount = {};
    for (let ci = 0; ci < WELLS.length; ci++) {
      const well = WELLS[ci];
      const g = WELL_GENOTYPE(well);
      const regionId = ci + 1;
      repCount[g] = (repCount[g] || 0) + 1;
      const sex = (repCount[g] % 2 === 1) ? 'female' : 'male';
      const replicate = Math.ceil(repCount[g] / 2);
      const obs = (g === 'hTauOE' && well === 'D6') ? 'dead' : 'alive';
      mrows.push(['DAM_file.txt', startStr, stopStr, String(regionId), well, g, sex, String(replicate), 'Circadian_Rhythms_Glasgow', obs]);
    }
    const metadataCsv = [mhead.join(',')].concat(mrows.map((r) => r.join(','))).join('\n');

    return {
      zantiksCsv,
      metadataCsv,
      zantiksName: 'circadian_rhythms_glasgow-20250801T141426.csv',
      metadataName: 'Metadata_150726_ebony.csv',
      startDt: start,
      totalMin,
      daysLD
    };
  }

  return { generateSampleData, WELLS, GENOTYPES };
})();
