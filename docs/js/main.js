/* ============================================================================
 * main.js — application state & wiring for the Zantiks-to-Rethomics analyzer
 * ==========================================================================*/
(function () {
  'use strict';

  const C = window.ZConverter;
  const MT = window.ZMetadata;
  const A = window.ZAnalysis;
  const S = window.ZStats;
  const CH = window.ZCharts;
  const M = window.ZMath;

  const $ = (id) => document.getElementById(id);

  /* ================= state ================= */
  const state = {
    zantiks: null,
    zantiksName: '',
    dam: null,
    damText: '',
    meta: null,
    metaName: '',
    flies: [],
    flyLevel: [],
    wholeSeries: null,
    darkIntervals: [],
    profiles: null,
    periodSummary: [],
    boxMetric: 'sleepMinDay',
    rendered: {} // tracks which figures exist: {whole-exp, sleep-profile, ...}
  };

  /* ================= helpers ================= */
  function toast(msg, type) {
    const root = $('toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3200);
    setTimeout(() => el.remove(), 3800);
  }

  function fmt(v, d) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return Number(v).toFixed(d === undefined ? 2 : d);
  }

  function fmtBin(binMin) {
    if (!binMin) return '—';
    if (binMin < 1) return (binMin * 60).toFixed(binMin * 60 < 10 ? 1 : 0) + ' s';
    return binMin + ' min';
  }

  function setActiveTab(name) {
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    $('tab-' + name.replace('tab-', '')).classList.add('active');
    document.querySelector('.tab-btn[data-tab="' + name + '"]').classList.add('active');
    // redraw plots after the tab becomes visible (Plotly needs layout size)
    setTimeout(() => {
      document.querySelectorAll('.tab-panel.active .js-plotly-plot').forEach((p) => {
        try { Plotly.Plots.resize(p); } catch (e) { /* noop */ }
      });
    }, 80);
  }

  function setWorkflow(step) {
    // step: 1..5
    for (let i = 1; i <= 5; i++) {
      const el = $('wf-' + i);
      el.classList.remove('active', 'done');
      if (i < step) el.classList.add('done');
      if (i === step) el.classList.add('active');
    }
  }

  function setupDropzone(dz, input, onFile) {
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (e) => onFile(e.target.result, f.name);
      reader.readAsText(f);
    });
    ['dragover', 'dragenter'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => onFile(ev.target.result, f.name);
      reader.readAsText(f);
    });
  }

  function infoGrid(el, items) {
    el.innerHTML = items.map((it) =>
      `<div class="info-item"><div class="k">${it.k}</div><div class="v">${it.v}</div></div>`).join('');
  }

  /* ================= Tab 1: Zantiks parsing ================= */
  function handleZantiksText(text, name) {
    try {
      const parsed = C.parseZantiksCsv(text, name);
      if (!parsed.rows.length) throw new Error('No data rows found in CSV.');
      state.zantiks = parsed;
      state.zantiksName = name;

      const lastRow = parsed.rows[parsed.rows.length - 1];
      const durH = lastRow ? lastRow.runtime / 3600 : 0; // cumulative elapsed seconds → hours
      infoGrid($('zantiks-info'), [
        { k: 'File', v: name },
        { k: 'Start datetime', v: parsed.info.startDatetime ? parsed.info.startDatetime.toLocaleString() : (parsed.info.startStr || 'unknown') },
        { k: 'Start source', v: parsed.info.startFromFilename ? 'filename (precise)' : 'header' },
        { k: 'Duration', v: fmt(durH, 1) + ' hours (' + parsed.rows.length + ' bins)' },
        { k: 'Experiment', v: parsed.info.expName || '—' },
        { k: 'Apparatus', v: parsed.info.apparatus || '—' },
        { k: 'Unit ID', v: parsed.info.unitId || '—' },
        { k: 'Temperature', v: fmt(M.mean(parsed.rows.map((r) => r.temperature)), 2) + ' °C' },
        { k: 'Channels', v: parsed.activityCols.length }
      ]);

      // channel overview table
      const wells = parsed.activityCols;
      const rows = wells.map((w) => {
        const vals = parsed.rows.map((r) => r.channels[wells.indexOf(w)]);
        const nonzero = vals.filter((v) => v > 0).length;
        return {
          well: w, ch: C.wellToChannel(w), min: M.min(vals), mean: M.mean(vals), max: M.max(vals),
          active: fmt(100 * nonzero / vals.length, 1) + '%'
        };
      });
      renderChannelTable(rows);

      $('zantiks-info-card').classList.remove('hidden');
      $('dam-result-card').classList.add('hidden');
      setWorkflow(1);
      toast('Zantiks CSV parsed: ' + parsed.rows.length + ' rows', 'success');
    } catch (err) {
      toast('Could not parse Zantiks CSV: ' + err.message, 'error');
    }
  }

  function renderChannelTable(rows) {
    const table = $('channel-table');
    table.innerHTML =
      '<thead><tr><th>Well</th><th>Channel</th><th class="num">Min</th><th class="num">Mean</th><th class="num">Max</th><th>Active bins</th></tr></thead>' +
      '<tbody>' + rows.map((r) =>
        `<tr><td>${r.well}</td><td>${r.ch}</td><td class="num">${fmt(r.min)}</td><td class="num">${fmt(r.mean, 1)}</td><td class="num">${fmt(r.max)}</td><td>${r.active}</td></tr>`).join('') +
      '</tbody>';
  }

  function doConvert() {
    if (!state.zantiks) { toast('Parse a Zantiks CSV first', 'error'); return; }
    try {
      state.damText = C.convertToDam(state.zantiks);
      state.dam = C.parseDam(state.damText, 'DAM_file.txt');
      // render preview (first 10 rows, cols: index/date/time/light + 24 channels)
      const lines = state.damText.trim().split('\n').slice(0, 10);
      const head = ['Index', 'Date', 'Time', 'Light', ...Array.from({ length: 24 }, (_, i) => 'Ch' + (i + 1))];
      const body = lines.map((l) => l.split('\t'));
      const tbl = $('dam-preview-table');
      tbl.innerHTML = '<thead><tr>' + head.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c, i) => `<td class="${i >= 4 ? 'num' : ''}">${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
      $('dam-badge').textContent = state.dam.nRows + ' rows × 24 channels';
      $('dam-summary').textContent = `Start ${state.dam.startDatetime ? state.dam.startDatetime.toLocaleString() : '—'} · End ${state.dam.endDatetime ? state.dam.endDatetime.toLocaleString() : '—'} · ${fmt((state.dam.endDatetime - state.dam.startDatetime) / 3600000, 1)} h · ${fmtBin(state.dam.binMinutes)} bins`;
      $('dam-result-card').classList.remove('hidden');
      setWorkflow(2);
      toast('DAM file generated', 'success');
    } catch (err) {
      toast('Conversion failed: ' + err.message, 'error');
    }
  }

  /* ================= Tab 2: Metadata ================= */
  function handleMetadataText(text, name) {
    try {
      const meta = MT.parseMetadataCsv(text);
      if (!meta.rows.length) throw new Error('No data rows found in metadata.');
      state.meta = meta;
      state.metaName = name;
      renderMetadata();
    } catch (err) {
      toast('Could not parse metadata: ' + err.message, 'error');
    }
  }

  function renderMetadata() {
    const issues = state.dam ? MT.validateMetadata(state.meta, state.dam) : MT.validateMetadata(state.meta, null);
    const errs = issues.filter((i) => i.severity === 'error').length;
    const warns = issues.filter((i) => i.severity === 'warning').length;
    const badge = $('meta-badge');
    badge.textContent = errs + ' errors · ' + warns + ' warnings';
    badge.className = 'badge ' + (errs ? 'warn' : 'ok');
    $('meta-issues').innerHTML = issues.length
      ? '<div class="issues">' + issues.map((i) =>
        `<div class="issue ${i.severity}">${i.severity === 'error' ? '⛔' : '⚠️'} <span>${i.msg}</span></div>`).join('') + '</div>'
      : '<div class="issue info">✅ Metadata looks consistent.</div>';

    // editable table
    const cols = state.meta.columns;
    const tbl = $('metadata-table');
    let html = '<thead><tr>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
    state.meta.rows.forEach((r, ri) => {
      html += '<tr>' + cols.map((c) => `<td><input data-r="${ri}" data-c="${c}" value="${escAttr(r[c] || '')}"></td>`).join('') + '</tr>';
    });
    html += '</tbody>';
    tbl.innerHTML = html;

    tbl.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const ri = +inp.dataset.r;
        const c = inp.dataset.c;
        state.meta.rows[ri][c] = MT.cleanValue(inp.value); // NA → ignored
      });
      inp.addEventListener('blur', () => {
        renderMetadata(); // re-validate
        const issues = state.dam ? MT.validateMetadata(state.meta, state.dam) : MT.validateMetadata(state.meta, null);
        const errs = issues.filter((i) => i.severity === 'error').length;
        const warns = issues.filter((i) => i.severity === 'warning').length;
        const badge = $('meta-badge');
        badge.textContent = errs + ' errors · ' + warns + ' warnings';
        badge.className = 'badge ' + (errs ? 'warn' : 'ok');
      });
    });

    $('metadata-result-card').classList.remove('hidden');
    setWorkflow(3);
    toast('Metadata parsed: ' + state.meta.rows.length + ' rows', 'success');
  }

  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /* ================= Link & analysis ================= */
  function linkAndAnalyze() {
    if (!state.dam) { toast('Convert a DAM file first', 'error'); return; }
    if (!state.meta) { toast('Load metadata first', 'error'); return; }

    const btn = $('btn-link-data');
    btn.disabled = true;
    btn.textContent = '⏳ Linking data…';
    // let the UI update before the heavy computation
    setTimeout(() => {
      try {
        const flies = MT.linkMetadata(state.dam, state.meta, '');
        if (!flies.length) {
          toast('No flies matched between metadata and DAM data. Check region_id/wells and datetime windows.', 'error');
          btn.disabled = false;
          btn.textContent = '🔗 Link data & Run Analysis';
          return;
        }
        A.aggregateSubMinute(flies); // sub-minute (e.g. 1-s) Zantiks → standard 1-min bins
        A.computeSleep(flies);
        state.flies = flies;
        state.flyLevel = A.flyLevelSummaries(flies);
        state.darkIntervals = computeDarkIntervals(flies);

        const genotypes = A.uniqueGenotypes(flies);
        const agg = flies.some((f) => f.aggregatedToMin);
        infoGrid($('linked-info'), [
          { k: 'Flies linked', v: flies.length },
          { k: 'Genotypes', v: genotypes.join(', ') },
          { k: 'Wells', v: flies.length + ' / 24 used' },
          { k: 'Sleep definition', v: '≥5 min inactivity' },
          { k: 'Bin size', v: fmtBin(flies[0].binMin) + (agg ? ' (aggregated)' : '') },
          { k: 'Recorded', v: fmt(flies[0].tHours[flies[0].tHours.length - 1] / 24, 1) + ' days' }
        ]);
        $('linked-card').classList.remove('hidden');
        setWorkflow(4);
        toast('Analysis dataset ready: ' + flies.length + ' flies', 'success');
      } catch (err) {
        toast('Linking failed: ' + err.message, 'error');
      }
      btn.disabled = false;
      btn.textContent = '🔗 Link data & Run Analysis';
    }, 30);
  }

  // dark intervals (in days) for whole-experiment shading
  function computeDarkIntervals(flies) {
    const binH = 0.5; // 30-min resolution
    let tMax = 0;
    for (const f of flies) if (f.tHours.length && f.tHours[f.tHours.length - 1] > tMax) tMax = f.tHours[f.tHours.length - 1];
    const n = Math.ceil(tMax / binH) + 1;
    const dark = new Array(n).fill(0);
    const cnt = new Array(n).fill(0);
    for (const f of flies) {
      for (let i = 0; i < f.light.length; i++) {
        const b = Math.min(n - 1, Math.floor(f.tHours[i] / binH));
        cnt[b]++;
        if (f.light[i] === 0) dark[b]++;
      }
    }
    const shapes = [];
    let start = null;
    for (let b = 0; b <= n; b++) {
      const isDark = b < n ? (cnt[b] > 0 && dark[b] / cnt[b] > 0.5) : false;
      if (isDark && start === null) start = b;
      if (!isDark && start !== null) {
        shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start * binH / 24, x1: b * binH / 24, y0: 0, y1: 1, fillcolor: '#0b1020', opacity: 0.16, line: { width: 0 } });
        start = null;
      }
    }
    return shapes;
  }

  /* ================= Tab 3: Actograms ================= */
  function renderActograms() {
    if (!state.flies.length) { toast('Link a dataset first (Tab 2)', 'error'); return; }
    const mode = $('act-mode').value;
    const bin = +$('act-bin').value;
    const cmap = $('act-colormap').value;
    const container = $('actogram-container');
    container.innerHTML = '<div class="empty-state">Rendering…</div>';
    // let UI update
    setTimeout(() => {
      if (mode === 'individual') {
        CH.actogramIndividual(state.flies, container, { binMin: bin, colormap: cmap });
      } else {
        CH.actogramGroup(state.flies, container, { binMin: bin, colormap: cmap });
      }
      state.rendered['act-' + mode] = true;
      setWorkflow(4);
    }, 30);
  }

  /* ================= Tab 4: Profiles ================= */
  // which phases (LD/DD/ALL) actually contain data for this dataset
  function availablePhases(flies) {
    const has = { LD: false, DD: false, ALL: false };
    for (const f of flies) {
      for (const d of A.classifyDays(f)) has[d.phase] = true;
      has.ALL = true;
    }
    return ['LD', 'DD', 'ALL'].filter((p) => has[p]);
  }

  function renderProfiles() {
    if (!state.flies.length) { toast('Link a dataset first (Tab 2)', 'error'); return; }
    let phase = $('prof-phase').value;
    const res = +$('prof-res').value;

    // if the selected phase has no days, fall back to an available phase
    const avail = availablePhases(state.flies);
    if (avail.length && !avail.includes(phase)) {
      const prev = phase;
      phase = avail.includes('LD') ? 'LD' : avail[0];
      $('prof-phase').value = phase;
      toast('No "' + prev + '" days in this dataset — showing "' + phase + '" phase', 'info');
    }

    state.wholeSeries = A.wholeExperiment(state.flies, 30);
    state.profiles = A.profiles24(state.flies, phase, res);
    const yMaxVal = parseFloat($('prof-ymax').value);
    const yMax = Number.isFinite(yMaxVal) && yMaxVal > 0 ? yMaxVal : 0;

    CH.wholeExpActivity(state.wholeSeries, $('chart-whole-exp'), { shapes: state.darkIntervals, yMax });
    state.rendered['whole-exp'] = true;

    const hasPhaseData = state.profiles.some((p) => p.n > 0);
    if (hasPhaseData) {
      CH.profile24Chart(state.profiles, state.flies, $('chart-sleep-profile'), 'sleep', phase, { yMax });
      CH.profile24Chart(state.profiles, state.flies, $('chart-activity-profile'), 'activity', phase, { yMax });
      state.rendered['sleep-profile'] = true;
      state.rendered['activity-profile'] = true;
    } else {
      const msg = 'No ' + phase + ' (free-running/entrainment) days found in this dataset. ' +
        (avail.length ? 'Available: ' + avail.join(', ') + '.' : 'No phase data available.') +
        ' Switch the phase selector above and re-render.';
      $('chart-sleep-profile').innerHTML = '<div class="empty-state">' + msg + '</div>';
      $('chart-activity-profile').innerHTML = '<div class="empty-state">' + msg + '</div>';
      state.rendered['sleep-profile'] = false;
      state.rendered['activity-profile'] = false;
    }
    toast('Profiles rendered (' + phase + ' phase)', 'success');
  }

  /* ================= Tab 5: Box plots & stats ================= */
  function renderBoxAndStats() {
    if (!state.flies.length) { toast('Link a dataset first (Tab 2)', 'error'); return; }
    const metric = $('box-metric').value;
    const cap = parseFloat($('box-cap').value);
    state.boxMetric = metric;

    const labels = {
      sleepMinDay: 'Total Daily Sleep (min/day)',
      activityDay: 'Total Daily Activity (counts/day)',
      boutCountDay: 'Sleep Bout Count (per day)',
      meanBoutLenDay: 'Mean Bout Duration (min)'
    };
    $('box-title').childNodes[0].textContent = labels[metric] + ' — ';
    CH.boxPlot(state.flyLevel, metric, $('chart-box'), { outlierCut: Number.isFinite(cap) && cap > 0 ? cap : 0 });
    state.rendered['box'] = true;

    // statistics
    const genotypes = A.uniqueGenotypes(state.flyLevel.map((r) => r.fly));
    const groups = genotypes.map((g) => state.flyLevel.filter((r) => r.genotype === g).map((r) => r[metric]));

    // Shapiro-Wilk
    const shapiroRows = genotypes.map((g, gi) => {
      const vals = groups[gi];
      const sw = S.shapiroWilk(vals);
      return { g, n: vals.length, W: sw.W, p: sw.p, normal: sw.p > 0.05 };
    });
    renderTable($('shapiro-table'),
      ['Genotype', 'n', 'W', 'p-value', 'Normal?'],
      shapiroRows.map((r) => [r.g, r.n, fmt(r.W, 4), fmt(r.p, 4), r.normal ? '✅ yes' : '⚠️ no']));

    // comparison
    const comp = $('comparison-table');
    if (genotypes.length === 2) {
      const wt = S.wilcoxonRankSum(groups[0], groups[1]);
      renderTable(comp,
        ['Test', 'Groups', 'U statistic', 'z', 'p-value', 'Significant (α=0.05)'],
        [['Wilcoxon rank-sum (Mann-Whitney U)', genotypes[0] + ' vs ' + genotypes[1], fmt(wt.U), fmt(wt.z, 3), fmt(wt.p, 4), wt.p < 0.05 ? '✅ yes' : '❌ no']]);
      $('dunn-section').classList.add('hidden');
    } else {
      const kw = S.kruskalWallis(groups);
      renderTable(comp,
        ['Test', 'Groups', 'H statistic', 'df', 'p-value', 'Significant (α=0.05)'],
        [['Kruskal-Wallis', genotypes.join(', '), fmt(kw.H, 3), kw.df, fmt(kw.p, 4), kw.p < 0.05 ? '✅ yes' : '❌ no']]);
      // Dunn post-hoc
      const dunn = S.dunnTest(groups, genotypes);
      const rows = dunn.comparisons.map((c) => {
        const sig = c.pAdj < 0.05 ? '✅' : '—';
        return [genotypes[c.a] + ' vs ' + genotypes[c.b], fmt(dunn.meanRanks[c.a], 2), fmt(dunn.meanRanks[c.b], 2), fmt(c.z, 3), fmt(c.pRaw, 4), fmt(c.pAdj, 4), sig];
      });
      renderTable($('dunn-table'),
        ['Comparison', 'Mean rank A', 'Mean rank B', 'z', 'p (raw)', 'p (Bonferroni)', 'Sig.'],
        rows);
      $('dunn-section').classList.remove('hidden');
    }
    toast('Statistics computed for ' + metric, 'success');
  }

  function renderTable(el, headers, rows) {
    el.innerHTML = '<thead><tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }

  /* ================= Tab 6: Periodogram ================= */
  function renderPeriodogram() {
    if (!state.flies.length) { toast('Link a dataset first (Tab 2)', 'error'); return; }
    const minP = parseFloat($('per-min').value) || 18;
    const maxP = parseFloat($('per-max').value) || 32;
    const step = parseFloat($('per-step').value) || 0.5;
    const alpha = parseFloat($('per-alpha').value) || 0.01;
    let phase = $('per-phase').value;

    // fall back to an available phase if the selected one has no days
    const avail = availablePhases(state.flies);
    if (avail.length && !avail.includes(phase)) {
      const prev = phase;
      phase = avail.includes('ALL') ? 'ALL' : avail[0];
      $('per-phase').value = phase;
      toast('No "' + prev + '" days in this dataset — using "' + phase + '"', 'info');
    }

    const container = $('chart-periodogram');
    container.innerHTML = '<div class="empty-state">Running periodogram analysis…</div>';
    setTimeout(() => {
      try {
        state.periodSummary = A.periodogramSummary(state.flies, { minPeriod: minP, maxPeriod: maxP, step, alpha, phase });
        CH.periodogramPlot(state.periodSummary, $('chart-periodogram'), {});
        CH.periodDistributionBox(state.periodSummary, $('chart-period-dist'), {});
        state.rendered['periodogram'] = true;
        state.rendered['period-dist'] = true;

        // rhythmicity table
        const rows = state.periodSummary.map((r) => [
          r.genotype, r.well, r.sex, fmt(r.period, 2), fmt(r.power, 1), fmt(r.threshold, 1),
          r.significant ? '✅ Rhythmic' : '❌ Arrhythmic'
        ]);
        renderTable($('rhythmicity-table'),
          ['Genotype', 'Well', 'Sex', 'Period (h)', 'Power (Qp)', 'Threshold', 'Classification'],
          rows);

        // summary stats per genotype
        const genotypes = A.uniqueGenotypes(state.flies);
        const summary = genotypes.map((g) => {
          const gs = state.periodSummary.filter((r) => r.genotype === g);
          const rhy = gs.filter((r) => r.significant);
          const periods = rhy.map((r) => r.period);
          return { g, n: gs.length, nRhy: rhy.length, pct: rhy.length / gs.length * 100, medPeriod: periods.length ? M.median(periods) : NaN };
        });
        const sRows = summary.map((s) => [
          s.g, s.n, s.nRhy, fmt(s.pct, 0) + '%', fmt(s.medPeriod, 2)
        ]);
        const table = $('rhythmicity-table');
        table.insertAdjacentHTML('afterend',
          '<h3 style="margin-top:16px">Rhythmicity summary</h3><div class="table-wrap"><table class="data-table" id="rhy-summary-table"><thead><tr><th>Genotype</th><th>n flies</th><th>Rhythmic</th><th>% rhythmic</th><th>Median period (h)</th></tr></thead><tbody>' +
          sRows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
        toast('Periodogram analysis complete', 'success');
      } catch (err) {
        toast('Periodogram failed: ' + err.message, 'error');
      }
    }, 30);
  }

  /* ================= Tab 7: Exports ================= */
  function exportFigure(name, format) {
    const containerId = {
      'whole-exp': 'chart-whole-exp',
      'sleep-profile': 'chart-sleep-profile',
      'activity-profile': 'chart-activity-profile',
      'box': 'chart-box',
      'periodogram': 'chart-periodogram',
      'period-dist': 'chart-period-dist'
    }[name];
    if (!containerId || !state.rendered[name]) { toast('Render this figure first', 'info'); return; }
    CH.exportFigure($(containerId), name + '.' + format, format, 3).then(() => toast('Exported ' + name + '.' + format, 'success')).catch((e) => toast('Export failed: ' + e.message, 'error'));
  }

  async function exportActograms(kind, format) {
    if (!state.flies.length) { toast('Link a dataset first', 'info'); return; }
    const bin = +$('act-bin').value;
    const cmap = $('act-colormap').value;
    try {
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:900px;';
      document.body.appendChild(container);
      if (kind === 'ind') CH.actogramIndividual(state.flies, container, { binMin: bin, colormap: cmap });
      else CH.actogramGroup(state.flies, container, { binMin: bin, colormap: cmap });
      // wait for plots to draw
      await new Promise((r) => setTimeout(r, 500));
      const url = await Plotly.toImage(container.querySelector('.js-plotly-plot') || container, { format, width: 1400, height: 900, scale: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = (kind === 'ind' ? 'actograms_individual' : 'actograms_group') + '.' + format;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      container.remove();
      toast('Actograms exported', 'success');
    } catch (e) {
      toast('Export failed: ' + e.message, 'error');
    }
  }

  function exportSummaryCsv(kind) {
    if (kind === 'sleep') {
      if (!state.flyLevel.length) { toast('Run analysis first', 'info'); return; }
      C.downloadCsv(
        ['id', 'genotype', 'well', 'sex', 'replicate', 'observations', 'days', 'sleep_min_day', 'activity_day', 'bout_count_day', 'mean_bout_len_day'],
        state.flyLevel.map((r) => [r.fly.id, r.genotype, r.well, r.sex, r.replicate, r.observations, r.days,
          fmt(r.sleepMinDay, 2), fmt(r.activityDay, 2), fmt(r.boutCountDay, 2), fmt(r.meanBoutLenDay, 2)]),
        'sleep_summary.csv');
    } else {
      if (!state.periodSummary.length) { toast('Run periodogram first', 'info'); return; }
      C.downloadCsv(
        ['id', 'genotype', 'well', 'sex', 'period_hours', 'power', 'threshold', 'significant'],
        state.periodSummary.map((r) => [r.fly.id, r.genotype, r.well, r.sex, fmt(r.period, 2), fmt(r.power, 2), fmt(r.threshold, 2), r.significant ? 'yes' : 'no']),
        'period_summary.csv');
    }
    toast('CSV exported', 'success');
  }

  /* ================= HTML report ================= */
  async function generateReport() {
    if (!state.flies.length) { toast('Link a dataset first', 'info'); return; }
    toast('Building report…', 'info');
    const parts = [];
    parts.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Zantiks-to-Rethomics Report</title>
      <style>body{font-family:'Segoe UI',Arial,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1e293b;line-height:1.5}
      h1{font-size:1.6rem}h2{border-bottom:2px solid #38bdf8;padding-bottom:4px;margin-top:2rem}img{max-width:100%;border:1px solid #ddd;border-radius:8px;margin:8px 0}
      table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}th{background:#f1f5f9}
      .meta{color:#64748b;font-size:.85rem}</style></head><body>`);
    parts.push(`<h1>Zantiks-to-Rethomics Analysis Report</h1>
      <p class="meta">Generated ${new Date().toLocaleString()} · ${state.flies.length} flies · ${A.uniqueGenotypes(state.flies).join(', ')}</p>`);

    async function addFigure(name, containerId) {
      if (!state.rendered[name] && !containerId) return;
      const el = containerId ? $(containerId) : null;
      if (!el) return;
      try {
        const url = await Plotly.toImage(el, { format: 'png', width: el.clientWidth || 900, height: el.clientHeight || 400, scale: 2 });
        parts.push(`<h2>${name.replace(/-/g, ' ')}</h2><img src="${url}" alt="${name}">`);
      } catch (e) { /* skip */ }
    }

    await addFigure('whole-exp', 'chart-whole-exp');
    await addFigure('sleep-profile', 'chart-sleep-profile');
    await addFigure('activity-profile', 'chart-activity-profile');
    await addFigure('box', 'chart-box');
    await addFigure('periodogram', 'chart-periodogram');
    await addFigure('period-dist', 'chart-period-dist');

    // tables
    if (state.flyLevel.length) {
      parts.push('<h2>Sleep summary</h2>');
      parts.push('<table><tr><th>id</th><th>genotype</th><th>well</th><th>sex</th><th>sleep_min_day</th><th>activity_day</th><th>bouts/day</th><th>mean bout (min)</th></tr>');
      state.flyLevel.slice(0, 100).forEach((r) => {
        parts.push(`<tr><td>${r.fly.id}</td><td>${r.genotype}</td><td>${r.well}</td><td>${r.sex}</td><td>${fmt(r.sleepMinDay, 1)}</td><td>${fmt(r.activityDay, 1)}</td><td>${fmt(r.boutCountDay, 1)}</td><td>${fmt(r.meanBoutLenDay, 1)}</td></tr>`);
      });
      parts.push('</table>');
    }
    if (state.periodSummary.length) {
      parts.push('<h2>Periodogram summary</h2>');
      parts.push('<table><tr><th>id</th><th>genotype</th><th>well</th><th>period (h)</th><th>power</th><th>threshold</th><th>rhythmic</th></tr>');
      state.periodSummary.forEach((r) => {
        parts.push(`<tr><td>${r.fly.id}</td><td>${r.genotype}</td><td>${r.well}</td><td>${fmt(r.period, 2)}</td><td>${fmt(r.power, 1)}</td><td>${fmt(r.threshold, 1)}</td><td>${r.significant ? 'yes' : 'no'}</td></tr>`);
      });
      parts.push('</table>');
    }
    parts.push('</body></html>');
    C.downloadText(parts.join('\n'), 'analysis_report.html', 'text/html;charset=utf-8');
    toast('Report downloaded', 'success');
  }

  /* ================= init ================= */
  function init() {
    // tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    // dropzones
    setupDropzone($('zantiks-drop'), $('zantiks-file'), handleZantiksText);
    setupDropzone($('metadata-drop'), $('metadata-file'), handleMetadataText);

    // sample data
    $('btn-sample-zantiks').addEventListener('click', (e) => {
      e.stopPropagation();
      const d = window.ZSampleData.generateSampleData();
      handleZantiksText(d.zantiksCsv, d.zantiksName);
    });
    $('btn-sample-metadata').addEventListener('click', (e) => {
      e.stopPropagation();
      const d = window.ZSampleData.generateSampleData();
      handleMetadataText(d.metadataCsv, d.metadataName);
    });

    // conversion
    $('btn-convert').addEventListener('click', doConvert);
    $('btn-download-dam').addEventListener('click', () => {
      if (!state.damText) { toast('Convert first', 'info'); return; }
      C.downloadText(state.damText, 'DAM_file.txt');
    });
    $('btn-goto-metadata').addEventListener('click', () => setActiveTab('tab-metadata'));

    // linking
    $('btn-link-data').addEventListener('click', linkAndAnalyze);
    $('btn-goto-actogram').addEventListener('click', () => setActiveTab('tab-actogram'));

    // renders
    $('btn-render-actogram').addEventListener('click', renderActograms);
    $('btn-render-profiles').addEventListener('click', renderProfiles);
    $('btn-render-box').addEventListener('click', renderBoxAndStats);
    $('btn-render-period').addEventListener('click', renderPeriodogram);

    // export buttons inside chart titles
    document.querySelectorAll('.export-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const format = $('export-format').value;
        exportFigure(btn.dataset.export, format);
      });
    });

    // tab 7 exports
    document.querySelectorAll('[data-fig]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fig = btn.dataset.fig;
        const format = $('export-format').value;
        if (fig === 'act-ind' || fig === 'act-group') {
          exportActograms(fig === 'act-ind' ? 'ind' : 'group', format);
        } else {
          exportFigure(fig, format);
        }
      });
    });
    $('btn-export-sleep-csv').addEventListener('click', () => exportSummaryCsv('sleep'));
    $('btn-export-period-csv').addEventListener('click', () => exportSummaryCsv('period'));
    $('btn-export-dam').addEventListener('click', () => {
      if (!state.damText) { toast('Convert first', 'info'); return; }
      C.downloadText(state.damText, 'DAM_file.txt');
    });
    $('btn-export-report').addEventListener('click', generateReport);

    // session info on tab 7
    const updateSession = () => {
      infoGrid($('session-info'), [
        { k: 'Zantiks source', v: state.zantiksName || '—' },
        { k: 'Metadata', v: state.metaName || '—' },
        { k: 'DAM rows', v: state.dam ? state.dam.nRows : '—' },
        { k: 'Flies linked', v: state.flies.length || '—' },
        { k: 'Genotypes', v: state.flies.length ? A.uniqueGenotypes(state.flies).join(', ') : '—' }
      ]);
    };
    setInterval(updateSession, 1500);
    updateSession();
    setWorkflow(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // expose internal state for debugging / console inspection
  window.ZAppState = state;
})();
