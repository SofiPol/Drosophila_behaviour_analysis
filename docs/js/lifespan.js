/* ============================================================================
 * lifespan.js — death scoring from prolonged immobility, Kaplan–Meier
 * survival curves and log-rank tests. Exposed as window.LifespanLab
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;

  /**
   * Score one animal as dead or censored from its activity trace.
   * Death time is the start of the immobility run (the last movement).
   * @param {object} animal assembled animal (activity, binMinutes)
   * @param {object} opts { deadHours, threshold, permanent, neverActiveDead }
   * @returns {{status:string, event:boolean, hours:number, recordedHours:number, note:string}}
   */
  function scoreAnimal(animal, opts = {}) {
    const deadHours = opts.deadHours > 0 ? opts.deadHours : 24;
    const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 0;
    const permanent = opts.permanent !== false;
    const act = animal.activity || [];
    const binH = (animal.binMinutes || 1) / 60;
    const still = (v) => C.isNum(v) && v <= threshold;

    let last = -1, anyMove = false;
    for (let i = 0; i < act.length; i++) {
      if (C.isNum(act[i])) {
        last = i;
        if (act[i] > threshold) anyMove = true;
      }
    }
    if (last < 0) return { status: 'excluded', event: false, hours: NaN, recordedHours: 0, note: 'no data' };
    const recordedHours = (last + 1) * binH;
    if (!anyMove) {
      if (opts.neverActiveDead !== false && recordedHours >= deadHours) {
        return { status: 'dead', event: true, hours: 0, recordedHours, note: 'no movement since the start of the recording' };
      }
      const why = recordedHours < deadHours ? `recording (${recordedHours.toFixed(1)} h) is shorter than ${deadHours} h` : 'no movement (not scored)';
      return { status: 'excluded', event: false, hours: NaN, recordedHours, note: why };
    }

    const deadBins = Math.max(1, Math.round(deadHours / binH));
    let deathIndex = -1;
    if (permanent) {
      let j = last;
      while (j >= 0 && still(act[j])) j--;
      if (last - j >= deadBins) deathIndex = j + 1;
    } else {
      let run = 0;
      for (let i = 0; i <= last; i++) {
        if (still(act[i])) {
          run++;
          if (run >= deadBins) { deathIndex = i - run + 1; break; }
        } else run = 0;
      }
    }
    if (deathIndex >= 0) {
      return { status: 'dead', event: true, hours: deathIndex * binH, recordedHours, note: `no movement for ≥ ${deadHours} h` };
    }
    return { status: 'censored', event: false, hours: recordedHours, recordedHours, note: 'alive at end of recording' };
  }

  /**
   * Kaplan–Meier estimate for one group.
   * @param {Array<{time:number,event:boolean}>} obs
   */
  function kaplanMeier(obs, z = 1.959964) {
    const data = obs.filter((o) => C.isNum(o.time)).sort((a, b) => a.time - b.time);
    const n = data.length;
    const steps = [{ t: 0, nRisk: n, nDead: 0, nCens: 0, S: 1, lo: 1, hi: 1 }];
    let S = 1, atRisk = n, varSum = 0, i = 0, area = 0, prevT = 0;
    while (i < n) {
      const t = data[i].time;
      let d = 0, c = 0;
      while (i < n && data[i].time === t) { if (data[i].event) d++; else c++; i++; }
      area += S * (t - prevT);
      prevT = t;
      if (d > 0) {
        S *= 1 - d / atRisk;
        if (atRisk > d) varSum += d / (atRisk * (atRisk - d));
        else varSum = Infinity;
      }
      let lo = S, hi = S;
      if (d > 0 && S > 0 && S < 1 && Number.isFinite(varSum) && varSum > 0) {
        const se = Math.sqrt(varSum) / Math.abs(Math.log(S));
        lo = Math.pow(S, Math.exp(z * se));
        hi = Math.pow(S, Math.exp(-z * se));
      } else if (steps.length) {
        const p = steps[steps.length - 1];
        if (d === 0) { lo = p.lo; hi = p.hi; }
      }
      steps.push({ t, nRisk: atRisk, nDead: d, nCens: c, S, lo, hi });
      atRisk -= d + c;
    }
    const deaths = data.filter((o) => o.event);
    const deathTimes = deaths.map((o) => o.time);
    let median = NaN;
    for (const s of steps) if (s.S <= 0.5) { median = s.t; break; }
    return {
      n, deaths: deaths.length, censored: n - deaths.length, steps,
      median, rmst: area, maxObserved: n ? data[n - 1].time : NaN,
      meanDeath: deathTimes.length ? C.mean(deathTimes) : NaN,
      semDeath: deathTimes.length > 1 ? C.sem(deathTimes) : NaN,
      maxLifespan: deathTimes.length ? Math.max(...deathTimes) : NaN
    };
  }

  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  /**
   * Log-rank test across k ≥ 2 groups.
   * @param {Array<Array<{time:number,event:boolean}>>} groups
   */
  function logRank(groups) {
    const k = groups.length;
    if (k < 2) return { chi2: NaN, df: 0, p: NaN };
    const all = [];
    groups.forEach((g, gi) => g.forEach((o) => { if (C.isNum(o.time)) all.push({ t: o.time, e: o.event ? 1 : 0, g: gi }); }));
    all.sort((a, b) => a.t - b.t);
    const nAt = groups.map((g) => g.filter((o) => C.isNum(o.time)).length);
    const O = new Array(k).fill(0), E = new Array(k).fill(0);
    const V = Array.from({ length: k }, () => new Array(k).fill(0));
    let i = 0;
    while (i < all.length) {
      const t = all[i].t;
      const dg = new Array(k).fill(0);
      let d = 0, leaving = new Array(k).fill(0);
      while (i < all.length && all[i].t === t) {
        leaving[all[i].g]++;
        if (all[i].e) { dg[all[i].g]++; d++; }
        i++;
      }
      const nTot = nAt.reduce((s, v) => s + v, 0);
      if (d > 0 && nTot > 1) {
        for (let a = 0; a < k; a++) {
          O[a] += dg[a];
          E[a] += d * nAt[a] / nTot;
          for (let b = 0; b < k; b++) {
            const delta = a === b ? 1 : 0;
            V[a][b] += d * (nAt[a] / nTot) * (delta - nAt[b] / nTot) * (nTot - d) / (nTot - 1);
          }
        }
      }
      for (let a = 0; a < k; a++) nAt[a] -= leaving[a];
    }
    const df = k - 1;
    const diff = O.slice(0, df).map((o, a) => o - E[a]);
    const Vr = V.slice(0, df).map((r) => r.slice(0, df));
    const x = solve(Vr, diff);
    if (!x) return { chi2: NaN, df, p: NaN, observed: O, expected: E };
    const chi2 = diff.reduce((s, v, a) => s + v * x[a], 0);
    return { chi2, df, p: C.chiSquareSf(chi2, df), observed: O, expected: E };
  }

  /**
   * Score all animals and summarise survival by a grouping variable.
   * @param {Array} animals
   * @param {object} opts { deadHours, threshold, permanent, startAgeDays, groupBy, correction }
   */
  function analyse(animals, opts = {}) {
    const groupBy = opts.groupBy || 'genotype';
    const startAge = Number.isFinite(opts.startAgeDays) ? opts.startAgeDays : 0;
    const labelOf = (a) => {
      let v = a[groupBy];
      if ((v === undefined || v === null || String(v).trim() === '') && groupBy === 'genotype') v = a.group;
      return v === undefined || v === null || String(v).trim() === '' ? 'Unassigned' : String(v).trim();
    };
    const rows = animals.map((a) => {
      const sc = scoreAnimal(a, opts);
      const toDays = (h) => C.isNum(h) ? h / 24 + startAge : NaN;
      return {
        animal: a, id: a.id, group: a.group, genotype: a.genotype || '', sex: a.sex || '', treatment: a.treatment || '',
        replicate: a.replicate || '', experiment: a.experiment || '', well: a.well, label: labelOf(a),
        status: sc.status, event: sc.event, note: sc.note,
        time: toDays(sc.hours), recorded: toDays(sc.recordedHours)
      };
    });
    const used = rows.filter((r) => r.status !== 'excluded');
    const labels = C.unique(used.map((r) => r.label));
    const curves = labels.map((label) => {
      const obs = used.filter((r) => r.label === label).map((r) => ({ time: r.time, event: r.event }));
      return Object.assign({ label }, kaplanMeier(obs));
    });
    const obsByLabel = labels.map((l) => used.filter((r) => r.label === l).map((r) => ({ time: r.time, event: r.event })));
    const overall = labels.length > 1 ? logRank(obsByLabel) : null;
    const pairwise = [];
    if (labels.length > 2) {
      for (let a = 0; a < labels.length; a++) {
        for (let b = a + 1; b < labels.length; b++) {
          const lr = logRank([obsByLabel[a], obsByLabel[b]]);
          pairwise.push({ a: labels[a], b: labels[b], chi2: lr.chi2, p: lr.p });
        }
      }
      const S = global.StatTests;
      const ps = pairwise.map((r) => r.p);
      const c = opts.correction || 'holm';
      const adj = !S ? ps : c === 'bh' ? S.bh(ps) : c === 'bonferroni' ? S.bonferroni(ps) : S.holm(ps);
      pairwise.forEach((r, i) => { r.pAdj = adj[i]; });
    }
    return { rows, curves, labels, overall, pairwise, groupBy, startAge };
  }

  global.LifespanLab = { scoreAnimal, kaplanMeier, logRank, analyse };
})(window);
