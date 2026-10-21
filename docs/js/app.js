/* ============================================================================
 * app.js — application state, UI wiring, rendering and exports
 * ==========================================================================*/
(function () {
  'use strict';

  const C = window.Core;
  const S = window.StatTests;
  const I = window.Importers;
  const SL = window.SleepLab;
  const CL = window.CircadianLab;
  const PL = window.PhaseLab;
  const CH = window.Charts;
  const SM = window.SampleData;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (v, d = 2) => C.fmtNum(v, d);
  const pct = (v, d = 1) => C.isNum(v) ? `${v.toFixed(d)}%` : '—';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const SECTION_NAMES = {
    import: ['01', 'Import'], settings: ['02', 'Settings'], overview: ['03', 'Overview'],
    actograms: ['04', 'Actograms'], profiles: ['05', 'Profiles'], sleep: ['06', 'Sleep'],
    circadian: ['07', 'Circadian'], phase: ['08', 'Phase'], stats: ['09', 'Statistics'], export: ['10', 'Export']
  };

  const state = {
    files: [],
    parsed: null,
    parsedWide: null,
    dataset: null,
    configs: [],
    animals: [],
    phaseMap: new Map(),
    metadata: null,
    metadataFile: null,
    metadataStats: null,
    metaMapping: null,
    summaries: [],
    circadian: [],
    phaseRows: [],
    metricsRows: [],
    statsResult: null,
    profileTest: null,
    validation: null,
    properties: null,
    settings: null,
    busy: false,
    section: 'import',
    actogramPage: 0,
    actogramAnimals: [],
    dirty: { overview: true, actograms: true, profiles: true, sleep: true, circadian: true, phase: true, stats: true },
    rendered: {},
    figures: {}
  };

  /* ============================ settings ============================ */
  function defaultSettings() {
    return {
      binMin: 1, cycleLength: 24, lightsOn: '08:00', phase: 'ALL', startDay: 1, endDay: 999,
      immobilityThreshold: 0, minSleepMinutes: 5, shortSleepMax: 30, interSleepMax: 60, briefAwakeningMin: 2,
      completeDayFraction: 0.9, deadHours: 24, maxMissing: 0.1, lowActivity: 1,
      primaryMethod: 'chi-square', periodogramBinMin: 30, minPeriod: 16, maxPeriod: 32, step: 0.1,
      alpha: 0.05, powerMin: 10, widthMin: 2, riThreshold: 0.3, consensusTolerance: 0.5,
      maxGapMin: 120, autoMaxLagHours: 120, autoSmoothBins: 3, autoMinPeakLagHours: 8,
      onsetThresholdFrac: 0.2, onsetMinDurationMin: 30,
      reboundBaseline: '', reboundDeprivation: '', reboundRecovery: '',
      errorBars: 'sem', normalise: 'none', timeBase: 'ZT', actogramBin: 30,
      actogramScale: 'percentile', doubleActogram: true
    };
  }

  function loadSettings() {
    state.settings = defaultSettings();
    try {
      const raw = localStorage.getItem('csa_settings_v2');
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (e) { /* ignore corrupt settings */ }
  }
  function saveSettings() {
    try { localStorage.setItem('csa_settings_v2', JSON.stringify(state.settings)); } catch (e) { /* ignore */ }
  }
  function readSettingsUI() {
    const s = state.settings;
    s.binMin = +$('set-bin').value || 1;
    s.cycleLength = +$('set-cycle').value || 24;
    s.lightsOn = $('set-lights-on').value || '08:00';
    s.phase = $('set-phase').value;
    s.startDay = +$('set-start-day').value || 1;
    s.endDay = +$('set-end-day').value || 999;
    s.immobilityThreshold = +$('set-threshold').value || 0;
    s.minSleepMinutes = +$('set-min-sleep').value || 5;
    s.shortSleepMax = +$('set-short-max').value || 30;
    s.interSleepMax = +$('set-inter-max').value || 60;
    s.briefAwakeningMin = +$('set-brief').value || 2;
    s.completeDayFraction = +$('set-complete').value || 0.9;
    s.deadHours = +$('set-dead-hours').value || 24;
    s.maxMissing = +$('set-max-missing').value || 0.1;
    s.lowActivity = +$('set-low-activity').value || 0;
    s.primaryMethod = $('set-primary').value;
    s.periodogramBinMin = +$('set-per-bin').value || 30;
    s.minPeriod = +$('set-per-min').value || 16;
    s.maxPeriod = +$('set-per-max').value || 32;
    s.step = +$('set-per-step').value || 0.1;
    s.alpha = +$('set-alpha').value || 0.05;
    s.powerMin = +$('set-power-min').value || 10;
    s.widthMin = +$('set-width-min').value || 2;
    s.riThreshold = +$('set-ri').value || 0.3;
    s.consensusTolerance = +$('set-consensus').value || 0.5;
    s.maxGapMin = +$('set-max-gap').value || 60;
    s.autoMaxLagHours = +$('set-auto-lag').value || 120;
    s.onsetThresholdFrac = (+$('set-onset-frac').value || 20) / 100;
    s.onsetMinDurationMin = +$('set-onset-duration').value || 30;
    s.reboundBaseline = $('set-rebound-baseline').value.trim();
    s.reboundDeprivation = $('set-rebound-dep').value.trim();
    s.reboundRecovery = $('set-rebound-rec').value.trim();
    s.errorBars = $('set-error').value;
    s.normalise = $('set-normalise').value;
    s.timeBase = $('set-timebase').value;
    s.actogramBin = +$('set-act-bin').value || 30;
    s.actogramScale = $('set-act-scale').value;
    s.doubleActogram = $('set-double').checked;
    saveSettings();
    updateSettingsSummary();
  }
  function syncSettingsUI() {
    const s = state.settings;
    $('set-bin').value = String(s.binMin);
    $('set-cycle').value = s.cycleLength;
    $('set-lights-on').value = s.lightsOn;
    $('set-phase').value = s.phase;
    $('set-start-day').value = s.startDay;
    $('set-end-day').value = s.endDay;
    $('set-threshold').value = s.immobilityThreshold;
    $('set-min-sleep').value = s.minSleepMinutes;
    $('set-short-max').value = s.shortSleepMax;
    $('set-inter-max').value = s.interSleepMax;
    $('set-brief').value = s.briefAwakeningMin;
    $('set-complete').value = s.completeDayFraction;
    $('set-dead-hours').value = s.deadHours;
    $('set-max-missing').value = s.maxMissing;
    $('set-low-activity').value = s.lowActivity;
    $('set-primary').value = s.primaryMethod;
    $('circ-primary').value = s.primaryMethod;
    $('set-per-bin').value = String(s.periodogramBinMin);
    $('set-per-min').value = s.minPeriod;
    $('set-per-max').value = s.maxPeriod;
    $('set-per-step').value = s.step;
    $('set-alpha').value = String(s.alpha);
    $('set-power-min').value = s.powerMin;
    $('set-width-min').value = s.widthMin;
    $('set-ri').value = s.riThreshold;
    $('set-consensus').value = s.consensusTolerance;
    $('set-max-gap').value = s.maxGapMin;
    $('set-auto-lag').value = s.autoMaxLagHours;
    $('set-onset-frac').value = Math.round(s.onsetThresholdFrac * 100);
    $('set-onset-duration').value = s.onsetMinDurationMin;
    $('set-rebound-baseline').value = s.reboundBaseline;
    $('set-rebound-dep').value = s.reboundDeprivation;
    $('set-rebound-rec').value = s.reboundRecovery;
    $('set-error').value = s.errorBars;
    $('set-normalise').value = s.normalise;
    $('set-timebase').value = s.timeBase;
    $('set-act-bin').value = String(s.actogramBin);
    $('set-act-scale').value = s.actogramScale;
    $('set-double').checked = !!s.doubleActogram;
    updateSettingsSummary();
  }
  function updateSettingsSummary() {
    const s = state.settings;
    const items = [
      ['Bin', `${s.binMin} min`],
      ['Window', `day ${s.startDay} – ${s.endDay === 999 ? 'last' : s.endDay}`],
      ['Phase', s.phase],
      ['ZT0', s.lightsOn],
      ['Sleep rule', `≥ ${s.minSleepMinutes} min immobile`],
      ['Immobility', `≤ ${s.immobilityThreshold}`],
      ['Period search', `${s.minPeriod}–${s.maxPeriod} h · ${s.step} h`],
      ['Primary τ', s.primaryMethod],
      ['Bin for periodogram', `${s.periodogramBinMin} min`],
      ['Alpha', s.alpha],
      ['Rhythmic', `power ≥ ${s.powerMin}, width ≥ ${s.widthMin} h`],
      ['Error bars', s.errorBars.toUpperCase()],
      ['Time base', s.timeBase]
    ];
    $('settings-summary').innerHTML = items.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  }

  /* ============================ UI helpers ============================ */
  function toast(message, type = 'info') {
    const root = $('toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .35s'; }, 3600);
    setTimeout(() => el.remove(), 4200);
  }
  function setStatus(text, ready) {
    $('dataset-status').textContent = text;
    $('status-dot').classList.toggle('ready', !!ready);
  }
  function setBusy(isBusy, text) {
    state.busy = isBusy;
    if (text) setStatus(text, false);
    $$('button').forEach((b) => { if (b.id !== 'btn-help') b.disabled = isBusy; });
  }
  function kpiGrid(id, items) {
    $(id).innerHTML = items.map((it) => `<div class="kpi"><div class="k">${esc(it.k)}</div><div class="v">${it.v}</div><div class="s">${esc(it.s || '')}</div></div>`).join('');
  }
  function table(id, headers, rows, opts = {}) {
    const el = $(id);
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="table-empty">No data yet.</div>';
      return;
    }
    let html = '<table><thead><tr>' + headers.map((h, i) => `<th class="${opts.numeric && opts.numeric.includes(i) ? 'num' : ''}">${esc(h)}</th>`).join('') + '</tr></thead><tbody>';
    for (const r of rows) {
      html += '<tr>' + r.map((c, i) => `<td class="${opts.numeric && opts.numeric.includes(i) ? 'num' : ''}">${c}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }
  function meanOf(rows, key) { return C.mean(rows.map((r) => r[key]).filter(C.isNum)); }
  function semOf(rows, key) { return C.sem(rows.map((r) => r[key]).filter(C.isNum)); }
  function groupRowsBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
      const k = r[key] || 'NA';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }
  function renderKpisFromRows(id, rows, items) {
    kpiGrid(id, items.map((it) => {
      if (it.fn) {
        const v = it.fn(rows);
        return { k: it.k, v: v, s: it.s };
      }
      return it;
    }));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function guard(fn) {
    return async function (ev) {
      try { await fn(ev); } catch (e) { console.error(e); toast(e && e.message ? e.message : String(e), 'error'); }
    };
  }

  /* ============================ navigation ============================ */
  function setSection(name, opts = {}) {
    if (!SECTION_NAMES[name]) name = 'import';
    state.section = name;
    $$('.panel').forEach((p) => p.classList.remove('active'));
    const panel = $('sec-' + name);
    if (panel) panel.classList.add('active');
    $$('.step').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
    $('section-number').textContent = SECTION_NAMES[name][0];
    $('section-name').textContent = SECTION_NAMES[name][1];
    if (location.hash !== '#' + name && !opts.silent) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0, behavior: opts.instant ? 'auto' : 'smooth' });
    // Render lazily so Plotly gets a laid-out container. Renderers are
    // idempotent; re-running them on section entry also recovers from a
    // previously hidden (zero-width) chart container.
    setTimeout(() => {
      try {
        if (name === 'overview' && state.metricsRows.length) renderOverview();
        else if (name === 'actograms' && state.animals.length) renderActograms();
        else if (name === 'profiles' && state.animals.length) renderProfiles();
        else if (name === 'sleep' && state.summaries.length) renderSleep();
        else if (name === 'circadian' && state.circadian.length) renderCircadian();
        else if (name === 'phase' && state.phaseRows.length) renderPhase();
        else if (name === 'stats' && state.metricsRows.length) renderStats();
        else if (name === 'export') updateManifest();
        else CH.resizeAll(panel);
      } catch (e) { console.error(e); toast(e.message || String(e), 'error'); }
    }, 80);
  }
  function initNav() {
    $$('.step').forEach((b) => b.addEventListener('click', () => setSection(b.dataset.section)));
    $$('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setSection(a.dataset.goto); }));
    window.addEventListener('hashchange', () => setSection((location.hash || '#import').slice(1), { silent: true }));
    $('btn-help').addEventListener('click', () => $('help-modal').classList.add('open'));
    $('btn-close-help').addEventListener('click', () => $('help-modal').classList.remove('open'));
    $('help-modal').addEventListener('click', (e) => { if (e.target === $('help-modal')) $('help-modal').classList.remove('open'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('help-modal').classList.remove('open'); });
  }

  /* ============================ import ============================ */
  function showFileList(items) {
    $('file-list').innerHTML = items.map((f) => `<div class="file-item"><strong>${esc(f.name)}</strong><span>${esc(f.status || '')}</span></div>`).join('');
  }
  function setupImport() {
    const input = $('file-input');
    const dz = $('dropzone');
    $('btn-choose-files').addEventListener('click', () => input.click());
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
    input.addEventListener('change', () => { if (input.files.length) handleFiles(input.files); });
    $('btn-demo').addEventListener('click', guard(loadDemo));
    $('btn-clear-import').addEventListener('click', () => {
      state.parsed = null; state.parsedWide = null; state.dataset = null; state.configs = [];
      state.animals = []; state.summaries = []; state.circadian = []; state.phaseRows = []; state.metricsRows = [];
      state.phaseMap = new Map(); state.actogramPage = 0;
      $('parser-card').classList.add('hidden');
      $('dataset-card').classList.add('hidden');
      $('file-list').innerHTML = '';
      setStatus('No dataset loaded', false);
      updateManifest();
      toast('Import cleared.');
    });
    $('btn-use-parsed').addEventListener('click', guard(useParsed));
    $('btn-download-dam').addEventListener('click', guard(() => {
      if (!state.parsed || state.parsed.kind !== 'wide' || state.parsed.format !== 'zantiks') return;
      C.downloadText(I.zantiksToDam(state.parsed), 'DAM_file.txt');
      toast('Standard DAM file downloaded.');
    }));
    $('btn-build-dataset').addEventListener('click', guard(buildDataset));
    $('btn-include-all').addEventListener('click', () => { state.configs.forEach((c) => { c.include = true; }); renderAnimalTable(); });
    $('btn-exclude-all').addEventListener('click', () => { state.configs.forEach((c) => { c.include = false; }); renderAnimalTable(); });
    $('btn-exclude-empty').addEventListener('click', () => {
      if (!state.dataset) return;
      state.configs.forEach((c) => {
        const vals = state.dataset.series[c.key] || [];
        const total = vals.filter(C.isNum).reduce((s, v) => s + v, 0);
        if (!(total > 0)) c.include = false;
      });
      renderAnimalTable();
      toast('Channels with zero total activity excluded.', 'info');
    });
    $('btn-meta-template-global').addEventListener('click', () => {
      const headers = ['file', 'start_datetime', 'stop_datetime', 'region_id', 'sex', 'genotype', 'replicate', 'well', 'exp', 'observations'];
      const example = ['DAM-like.txt', '2026-10-08 08:00:00', '2026-10-17 08:00:00', '1', 'male', 'CTRL-7D', '', 'A1', '', ''];
      C.downloadText(C.csvStringify(headers, [example]), 'metadata_template.csv', 'text/csv;charset=utf-8');
      toast('Metadata template downloaded.', 'success');
    });
    $('meta-file').addEventListener('change', guard(async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const text = await I.readFileAsText(f);
      state.metadata = I.parseMetadata(text);
      state.metadataFile = { name: f.name, size: f.size };
      state.metadataStats = null;
      state.metaMapping = I.suggestMetadataMapping(state.metadata);
      renderMetaMapping();
      linkMetadata({ notify: true });
    }));
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length || state.busy) return;
    state.files = files;
    state.dataset = null;
    state.configs = [];
    state.animals = [];
    state.summaries = [];
    state.circadian = [];
    state.phaseRows = [];
    state.metricsRows = [];
    state.metadataStats = null;
    updateMetadataStatus();
    $('dataset-card').classList.add('hidden');
    $('meta-mapping').classList.toggle('hidden', !state.metadata);
    const statuses = files.map((f) => ({ name: f.name, status: 'queued' }));
    showFileList(statuses);
    setStatus('Reading files…', false);
    const parsedList = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      statuses[i].status = 'reading…';
      showFileList(statuses);
      try {
        const parsed = await I.parseFile(f, {
          onProgress: (frac) => { statuses[i].status = `reading ${(frac * 100).toFixed(0)}%`; showFileList(statuses); }
        });
        parsedList.push(parsed);
        statuses[i].status = 'ok';
      } catch (e) {
        console.error(e);
        statuses[i].status = 'error: ' + e.message;
      }
      showFileList(statuses);
    }
    if (!parsedList.length) {
      setStatus('Import failed', false);
      toast('No file could be parsed. Check the format or try the demo.', 'error');
      return;
    }
    try {
      const merged = mergeParsed(parsedList);
      state.parsed = merged;
      state.parsedWide = normalizeToWide(merged);
      renderParserPanel();
      setStatus(`${parsedList.length} file${parsedList.length > 1 ? 's' : ''} parsed`, false);
      toast('File parsed. Review the mapping and choose “Use this dataset”.', 'success');
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error');
    }
  }

  function mergeParsed(list) {
    if (list.length === 1) return list[0];
    const wides = list.map(normalizeToWide);
    const merged = mergeWideDatasets(wides);
    merged.name = list.map((p) => p.name || p.file || 'file').join(' + ');
    return merged;
  }

  function mergeWideDatasets(list) {
    if (list.length === 1) return list[0];
    const base = list[0];
    const compatible = list.every((d) =>
      d.times && base.times && d.times.length === base.times.length &&
      d.times[0] instanceof Date && base.times[0] instanceof Date &&
      Math.abs(d.times[0] - base.times[0]) < 1000 &&
      Math.abs((d.binMinutes || 1) - (base.binMinutes || 1)) < 1e-6
    );
    if (!compatible) {
      toast('Files have different time grids; using the first file only. Convert them to a common grid before merging.', 'error');
      return base;
    }
    const out = Object.assign({}, base, { series: {}, labels: {}, keys: [] });
    const prefixCounts = new Map();
    list.forEach((d) => {
      let basePrefix = list.length > 1 ? (d.name || 'file').replace(/\.[^.]+$/, '') : '';
      const n = prefixCounts.get(basePrefix) || 0;
      prefixCounts.set(basePrefix, n + 1);
      if (n > 0) basePrefix += ' (' + (n + 1) + ')';
      const prefix = basePrefix ? basePrefix + ':' : '';
      (d.keys || Object.keys(d.series)).forEach((key) => {
        const newKey = prefix + key;
        out.series[newKey] = d.series[key];
        out.labels[newKey] = prefix + (d.labels && d.labels[key] ? d.labels[key] : key);
        out.keys.push(newKey);
      });
    });
    return out;
  }

  function normalizeToWide(parsed) {
    if (!parsed) throw new Error('No parsed dataset.');
    if (parsed.kind === 'dam') return damToWide(parsed);
    if (parsed.kind === 'wide') return parsed;
    throw new Error('Unsupported dataset type: ' + parsed.kind);
  }

  function damToWide(dam) {
    const rows = dam.rows.filter((r) => r.timestamp);
    if (!rows.length) throw new Error('No timestamped DAM rows.');
    const times = rows.map((r) => r.timestamp);
    const light = rows.map((r) => r.light);
    const keys = [], labels = [], series = {};
    for (let ch = 1; ch <= dam.nChannels; ch++) {
      const key = 'Ch' + ch;
      keys.push(key);
      labels.push('Channel ' + ch);
      series[key] = rows.map((r) => (r.channels && ch - 1 < r.channels.length ? r.channels[ch - 1] : NaN));
    }
    const start = times[0];
    return {
      kind: 'wide', format: 'dam', name: dam.file || 'DAM.txt',
      times, start, startClockHour: start.getHours() + start.getMinutes() / 60 + start.getSeconds() / 3600,
      light, series, keys, labels, binMinutes: dam.binMinutes || 1,
      meta: { nChannels: dam.nChannels, metaCols: dam.metaCols, lightIndex: dam.lightIndex, parseErrors: dam.parseErrors }
    };
  }

  function renderParserPanel() {
    const w = state.parsedWide;
    if (!w) return;
    $('parser-card').classList.remove('hidden');
    $('parser-title').textContent = w.name || 'Parsed dataset';
    $('parser-subtitle').textContent = `${w.format || w.kind} · ${(w.keys || []).length} series · ${w.binMinutes ? w.binMinutes.toFixed(w.binMinutes < 1 ? 2 : 0) + ' min' : '—'} bins`;
    const start = w.start ? C.formatDateTime(w.start) : '—';
    const end = w.times && w.times.length ? (w.times[0] instanceof Date ? C.formatDateTime(w.times[w.times.length - 1]) : `${w.times[w.times.length - 1].toFixed(2)} h elapsed`) : '—';
    const hasLight = Array.isArray(w.light) && w.light.some((v) => v === 1) && w.light.some((v) => v === 0);
    $('parser-info').innerHTML = [
      ['Format', w.format || w.kind], ['Start', start], ['End', end],
      ['Series', (w.keys || []).length], ['Bin', w.binMinutes ? `${w.binMinutes} min` : '—'],
      ['Light column', hasLight ? 'yes (LD)' : 'no / constant'],
      ['Rows', w.times ? w.times.length : '—']
    ].map(([k, v]) => `<div class="info-item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');

    // Mapping controls
    let html = '';
    if (w.format === 'generic' && w.genericMap) {
      const map = w.genericMap;
      const header = map.header || [];
      const opts = header.map((h, i) => `<option value="${i}" ${i === map.timeIdx ? 'selected' : ''}>${esc(h)}</option>`).join('');
      const lightOpts = '<option value="-1">none</option>' + header.map((h, i) => `<option value="${i}" ${i === map.lightIdx ? 'selected' : ''}>${esc(h)}</option>`).join('');
      const idOpts = '<option value="-1">none</option>' + header.map((h, i) => `<option value="${i}" ${i === map.idIdx ? 'selected' : ''}>${esc(h)}</option>`).join('');
      const valueOpts = '<option value="-1">none</option>' + header.map((h, i) => `<option value="${i}" ${i === map.valueIdx ? 'selected' : ''}>${esc(h)}</option>`).join('');
      const wideOpts = header.map((h, i) => `<option value="${i}" ${(map.wideCols || []).includes(i) ? 'selected' : ''}>${esc(h)}</option>`).join('');
      html += `<div class="mapping-row">
        <label>Mode<select id="map-mode"><option value="wide" ${map.mode === 'wide' ? 'selected' : ''}>Wide (one column per animal)</option><option value="long" ${map.mode === 'long' ? 'selected' : ''}>Long (ID + value)</option></select></label>
        <label>Time / timestamp column<select id="map-time">${opts}</select></label>
        <label>Time unit<select id="map-time-unit"><option value="auto">auto</option><option value="seconds">seconds</option><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select></label>
        <label>Light column<select id="map-light">${lightOpts}</select></label>
        <label>Animal ID column (long)<select id="map-id">${idOpts}</select></label>
        <label>Value column (long)<select id="map-value">${valueOpts}</select></label>
        <label>Start clock hour (elapsed data)<input type="number" id="map-start-clock" value="${w.startClockHour || 0}" min="0" max="24" step="0.5"></label>
      </div>
      <div class="mapping-row"><label style="grid-column:1/-1">Animal columns (wide; use Ctrl/Cmd to select multiple)<select id="map-wide" multiple class="multi-select">${wideOpts}</select></label></div>
      <button class="btn ghost small" id="btn-apply-mapping" type="button">Apply mapping</button>`;
    } else if (w.format === 'zantiks') {
      html += `<p class="preview-note">Detected Zantiks wells: ${esc((w.keys || []).join(', '))}. The original values are displayed; conversion to standard DAM multiplies distance by 1000 and writes 32 channels.</p>`;
      $('btn-download-dam').classList.remove('hidden');
    } else if (w.format === 'dam') {
      html += `<p class="preview-note">Detected ${w.keys.length} channels. The light column is read automatically; empty channels can be excluded on the next step.</p>`;
    } else if (w.format === 'ethoscope' || w.format === 'ethoscope-csv') {
      html += `<p class="preview-note">Detected ${w.keys.length} ROIs. Movement is classified from the maximum velocity in 10 s windows; adjust the threshold in Import if needed (currently 1.0 relative units).</p>`;
    }
    $('mapping-controls').innerHTML = html;
    if ($('btn-apply-mapping')) $('btn-apply-mapping').addEventListener('click', guard(applyGenericMapping));

    // Preview
    const keys = (w.keys || []).slice(0, 6);
    const rows = [];
    const n = Math.min(8, w.times ? w.times.length : 0);
    for (let i = 0; i < n; i++) {
      const t = w.times[i] instanceof Date ? C.formatDateTime(w.times[i]) : `${w.times[i].toFixed(3)} h`;
      rows.push([t, w.light ? (w.light[i] === null ? 'NA' : w.light[i]) : '—'].concat(keys.map((k) => {
        const v = w.series[k][i];
        return C.isNum(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : 'NA';
      })));
    }
    table('parser-preview', ['Time', 'Light'].concat(keys), rows);
  }

  function applyGenericMapping() {
    const w = state.parsedWide;
    if (!w.genericMap) return;
    const map = w.genericMap;
    const mode = $('map-mode').value;
    const timeIdx = +$('map-time').value;
    const lightIdx = +$('map-light').value;
    const idIdx = +$('map-id').value;
    const valueIdx = +$('map-value').value;
    const wideSel = $('map-wide');
    const wideCols = wideSel ? Array.from(wideSel.selectedOptions).map((o) => +o.value) : map.wideCols;
    const opts = {
      name: w.name, timeIdx, lightIdx: lightIdx >= 0 ? lightIdx : -1,
      idIdx: idIdx >= 0 ? idIdx : -1, valueIdx: valueIdx >= 0 ? valueIdx : -1,
      mode, wideCols, timeUnit: $('map-time-unit').value,
      startClockHour: +$('map-start-clock').value || 0
    };
    const newWide = I.buildGeneric(map, opts);
    newWide.genericMap = map;
    newWide.format = 'generic';
    state.parsedWide = newWide;
    renderParserPanel();
    toast(`Remapped: ${newWide.keys.length} animal series.`, 'success');
  }

  function useParsed() {
    const w = state.parsedWide;
    if (!w) return;
    readSettingsUI();
    const reg = I.regularise(w, { binMin: state.settings.binMin });
    if (Math.abs(reg.binMinutes - state.settings.binMin) > 1e-9) {
      toast(`Source resolution is ${reg.binMinutes} min; analysis will use that rather than upsampling.`, 'info');
      state.settings.binMin = reg.binMinutes;
      syncSettingsUI();
    }
    I.addCircadianTime(reg, state.settings);
    state.dataset = reg;
    state.animals = [];
    state.summaries = [];
    state.circadian = [];
    state.phaseRows = [];
    state.metricsRows = [];
    state.phaseMap = new Map();
    state.configs = I.configsFromWide(reg).map((c, i) => {
      const parts = String(c.key).split(':');
      const chPart = parts.length > 1 ? parts[1] : '';
      c.file = parts.length > 1 ? parts[0] : (w.name || '');
      c.channel = /^Ch\d+$/i.test(chPart) ? parseInt(chPart.slice(2), 10) : (c.channel || i + 1);
      c.well = (w.labels && w.labels[c.key]) || c.key;
      return c;
    });
    if (state.metadata) {
      linkMetadata({ notify: false });
      renderMetaMapping();
    }
    // default analysis window
    const phases = I.classifyDayPhases(reg);
    const minDay = C.min(phases.map((d) => d.day));
    const maxDay = C.max(phases.map((d) => d.day));
    // Skip the first two acclimation days only on recordings long enough to
    // leave at least five days of data.
    state.settings.startDay = phases.some((d) => d.phase === 'LD') && maxDay >= 7 ? Math.min(3, maxDay) : Math.max(1, minDay);
    state.settings.endDay = maxDay;
    syncSettingsUI();
    renderAnimalTable();
    $('parser-card').classList.add('hidden');
    $('dataset-card').classList.remove('hidden');
    updateManifest();
    setStatus(`${state.configs.length} animals detected`, false);
    $('dataset-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Review groups and press “Build & analyse dataset”.', 'success');
  }

  function renderAnimalTable() {
    if (!state.dataset || !state.configs.length) return;
    const reg = state.dataset;
    const rows = state.configs.map((c, i) => {
      let flags = [];
      let meanDay = NaN, miss = NaN;
      const series = reg.series[c.key];
      if (series) {
        const valid = series.filter(C.isNum);
        miss = series.length ? 1 - valid.length / series.length : NaN;
        meanDay = C.mean(valid) * (1440 / reg.binMinutes);
        const dead = I.detectDeadRun(series, Math.round((state.settings.deadHours || 24) * 60 / reg.binMinutes));
        if (dead) flags.push(`dead from day ${reg.day ? reg.day[dead.start] : '?'}`);
        if (C.isNum(miss) && miss > state.settings.maxMissing) flags.push(`${(miss * 100).toFixed(1)}% missing`);
        if (C.isNum(meanDay) && meanDay < state.settings.lowActivity) flags.push('low activity');
      }
      const meta = state.animals.find((a) => a.key === c.key);
      if (meta && meta.flags) flags = meta.flags;
      return { c, i, flags, meanDay, miss };
    });
    let html = '<table><thead><tr><th>Use</th><th>Animal ID</th><th>Source</th><th>Channel / well</th><th>Genotype</th><th>Group</th><th>Sex</th><th>Treatment</th><th class="num">Act./day</th><th class="num">Missing</th><th>Flags</th></tr></thead><tbody>';
    for (const r of rows) {
      const c = r.c;
      html += `<tr>
        <td><input type="checkbox" data-key="${esc(c.key)}" data-field="include" ${c.include !== false ? 'checked' : ''}></td>
        <td><input type="text" data-key="${esc(c.key)}" data-field="id" value="${esc(c.id)}"></td>
        <td class="muted">${esc(c.key)}</td>
        <td>${esc(c.well || '')}</td>
        <td><input type="text" data-key="${esc(c.key)}" data-field="genotype" value="${esc(c.genotype || '')}"></td>
        <td><input type="text" data-key="${esc(c.key)}" data-field="group" value="${esc(c.group || 'All')}"></td>
        <td><input type="text" data-key="${esc(c.key)}" data-field="sex" value="${esc(c.sex || '')}"></td>
        <td><input type="text" data-key="${esc(c.key)}" data-field="treatment" value="${esc(c.treatment || '')}"></td>
        <td class="num">${C.isNum(r.meanDay) ? fmt(r.meanDay, 1) : '—'}</td>
        <td class="num">${C.isNum(r.miss) ? pct(r.miss * 100) : '—'}</td>
        <td class="small muted">${esc(r.flags.join('; '))}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    $('animal-table').innerHTML = html;
    $('animal-table').querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const cfg = state.configs.find((c) => c.key === inp.dataset.key);
        if (!cfg) return;
        if (inp.dataset.field === 'include') cfg.include = inp.checked;
        else cfg[inp.dataset.field] = inp.value;
        updateAnimalBadge();
        updateManifest();
      });
    });
    updateAnimalBadge();
  }

  function updateAnimalBadge() {
    const n = state.configs.filter((c) => c.include !== false).length;
    $('animal-badge').textContent = `${n} / ${state.configs.length} included`;
    const flags = [];
    let dead = 0, missing = 0, low = 0;
    for (const c of state.configs) {
      if (c.include === false) continue;
      const series = state.dataset.series[c.key];
      if (series) {
        const valid = series.filter(C.isNum);
        const miss = series.length ? 1 - valid.length / series.length : 0;
        if (miss > state.settings.maxMissing) missing++;
        if (C.mean(valid) * (1440 / state.dataset.binMinutes) < state.settings.lowActivity) low++;
        if (I.detectDeadRun(series, Math.round(state.settings.deadHours * 60 / state.dataset.binMinutes))) dead++;
      }
    }
    $('qc-summary').innerHTML = [
      `<span class="qc-pill ok">${n} included</span>`,
      dead ? `<span class="qc-pill bad">${dead} dead-flagged</span>` : '',
      missing ? `<span class="qc-pill warn">${missing} missing &gt; ${(state.settings.maxMissing * 100).toFixed(0)}%</span>` : '',
      low ? `<span class="qc-pill warn">${low} low activity</span>` : ''
    ].filter(Boolean).join('');
  }

  function metadataMappingFromUI() {
    return {
      file: $('meta-file-col')?.value || null,
      channel: $('meta-channel-col')?.value || null,
      id: $('meta-id-col')?.value || null,
      group: $('meta-group-col')?.value || null,
      genotype: $('meta-genotype-col')?.value || null,
      sex: $('meta-sex-col')?.value || null,
      treatment: $('meta-treat-col')?.value || null,
      well: $('meta-well-col')?.value || null,
      replicate: $('meta-replicate-col')?.value || null,
      experiment: $('meta-exp-col')?.value || null,
      start: state.metaMapping?.start || null,
      stop: state.metaMapping?.stop || null
    };
  }

  function metadataStatusText() {
    if (!state.metadata) return '';
    const nRows = state.metadata.rows.length;
    if (!state.configs.length) {
      return `${nRows} metadata rows loaded. They will be linked automatically when a dataset is used.`;
    }
    const st = state.metadataStats;
    if (!st) return `${nRows} metadata rows loaded.`;
    if (!st.matched) {
      return `No animals matched. Check the file, region/channel, well or animal ID join columns; set File / monitor to “none” to match across file names.`;
    }
    const suffix = st.unmatched ? ` ${st.unmatched} animal${st.unmatched === 1 ? '' : 's'} unmatched.` : '';
    const missing = st.missingGenotype ? ` ${st.missingGenotype} have no genotype in the metadata.` : '';
    return `Linked ${st.matched} of ${st.total} animals to ${st.matchedRows} metadata rows. Genotype is added automatically.${suffix}${missing}`;
  }

  function updateMetadataStatus() {
    const el = $('meta-status');
    if (el) el.textContent = metadataStatusText();
  }

  function linkMetadata({ notify = true } = {}) {
    if (!state.metadata) return null;
    if (!state.metaMapping) state.metaMapping = I.suggestMetadataMapping(state.metadata);
    if (!state.configs.length) {
      state.metadataStats = null;
      updateMetadataStatus();
      updateManifest();
      if (notify) toast('Metadata loaded; it will be linked automatically when a dataset is used.', 'info');
      return null;
    }
    state.configs = I.applyMetadata(state.configs, state.metadata, state.metaMapping);
    state.metadataStats = state.configs.metaStats || null;
    renderAnimalTable();
    updateManifest();
    updateMetadataStatus();
    if (notify) {
      const st = state.metadataStats;
      if (st && st.matched) {
        toast(`Metadata linked to ${st.matched} of ${st.total} animals. Genotype added automatically.`, 'success');
      } else {
        toast('Metadata loaded but no animals matched. Check the file/channel/animal ID columns.', 'error');
      }
    }
    return state.metadataStats;
  }

  function renderMetaMapping() {
    if (!state.metadata) return;
    const meta = state.metadata;
    const mapping = state.metaMapping || meta.suggested;
    const cols = meta.header;
    const mk = (id, label, suggested) => `<label>${label}<select id="${id}"><option value="">— none —</option>${cols.map((c) => `<option value="${esc(c)}" ${c === suggested ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`;
    $('meta-mapping').classList.remove('hidden');
    $('meta-mapping').innerHTML = `<div class="mapping-row">
      ${mk('meta-file-col', 'File / monitor', mapping.file)}
      ${mk('meta-channel-col', 'Channel / ROI', mapping.channel)}
      ${mk('meta-id-col', 'Animal ID', mapping.id)}
      ${mk('meta-genotype-col', 'Genotype', mapping.genotype)}
      ${mk('meta-group-col', 'Experimental group', mapping.group)}
      ${mk('meta-sex-col', 'Sex', mapping.sex)}
      ${mk('meta-treat-col', 'Treatment', mapping.treatment)}
      ${mk('meta-well-col', 'Well / arena', mapping.well)}
      ${mk('meta-replicate-col', 'Replicate', mapping.replicate)}
      ${mk('meta-exp-col', 'Experiment', mapping.experiment)}
    </div>
    <p class="hint" id="meta-status">${esc(metadataStatusText())}</p>
    <div class="row-buttons">
      <button class="btn ghost small" id="btn-apply-meta" type="button">Apply metadata</button>
      <button class="btn ghost small" id="btn-meta-template" type="button">Download template</button>
    </div>`;
    $('btn-meta-template').addEventListener('click', () => {
      const headers = ['file', 'start_datetime', 'stop_datetime', 'region_id', 'sex', 'genotype', 'replicate', 'well', 'exp', 'observations'];
      const example = ['DAM-like.txt', '2026-10-08 08:00:00', '2026-10-17 08:00:00', '1', 'male', 'CTRL-7D', '', 'A1', '', ''];
      C.downloadText(C.csvStringify(headers, [example]), 'metadata_template.csv', 'text/csv;charset=utf-8');
      toast('Metadata template downloaded.', 'success');
    });
    $('btn-apply-meta').addEventListener('click', guard(() => {
      state.metaMapping = metadataMappingFromUI();
      if (!state.metaMapping.file && !state.metaMapping.channel && !state.metaMapping.id) {
        toast('Choose at least one join column: file, channel/well or animal ID.', 'error');
        return;
      }
      linkMetadata({ notify: true });
    }));
    $('meta-mapping').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
      state.metaMapping = metadataMappingFromUI();
      if (state.configs.length) linkMetadata({ notify: false });
    }));
  }

  async function loadDemo() {
    const demo = SM.generateDemo({ perGroup: 6, daysLD: 5, daysDD: 9, binMin: 1 });
    state.parsed = demo.dataset;
    state.parsedWide = demo.dataset;
    state.configs = demo.configs;
    $('meta-mapping').classList.toggle('hidden', !state.metadata);
    $('file-list').innerHTML = '<div class="file-item"><strong>Synthetic demo (LD→DD)</strong><span>generated locally</span></div>';
    // regularise and configure
    readSettingsUI();
    state.settings.binMin = 1;
    state.settings.phase = 'ALL';
    state.settings.startDay = 3;
    state.settings.endDay = 14;
    syncSettingsUI();
    const reg = I.regularise(demo.dataset, { binMin: 1 });
    I.addCircadianTime(reg, state.settings);
    state.dataset = reg;
    state.animals = [];
    state.configs = demo.configs.map((c, i) => ({ ...c, file: 'Synthetic demo', channel: i + 1 }));
    if (state.metadata) linkMetadata({ notify: false }); else renderAnimalTable();
    $('parser-card').classList.add('hidden');
    $('dataset-card').classList.remove('hidden');
    setStatus('Synthetic demo loaded', true);
    $('dataset-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Demo generated: 3 groups × 6 animals, 5 LD + 9 DD days.', 'success');
  }

  /* ============================ build & analyse ============================ */
  async function buildDataset() {
    if (!state.dataset) throw new Error('Load and use a dataset first.');
    readSettingsUI();
    state.animals = I.assembleAnimals(state.dataset, state.configs, state.settings);
    if (!state.animals.length) throw new Error('No animals are included. Tick at least one animal in the table.');
    state.phaseMap = I.dayPhaseMap(state.animals);
    const allDays = state.animals.flatMap((a) => a.day).filter(C.isNum);
    const maxDay = C.max(allDays);
    if (state.settings.endDay === 999 || state.settings.endDay > maxDay) state.settings.endDay = maxDay;
    if (state.settings.startDay < 1) state.settings.startDay = 1;
    syncSettingsUI();
    setStatus(`Building ${state.animals.length} animals…`, false);
    await runAll();
    setSection('overview', { instant: true });
    toast(`Analysis complete: ${state.animals.length} animals.`, 'success');
  }

  async function runAll() {
    if (!state.animals.length) throw new Error('No animals to analyse.');
    setBusy(true, 'Computing metrics…');
    const summaries = [], circs = [], phases = [];
    const n = state.animals.length;
    for (let i = 0; i < n; i++) {
      const a = state.animals[i];
      try {
        const sum = SL.summarizeAnimal(a, state.settings, state.phaseMap);
        const cr = CL.analyseAnimal(a, state.settings, state.phaseMap);
        const ph = PL.phaseMetrics(a, state.settings, state.phaseMap, cr);
        ph.animal = a;
        summaries.push(sum);
        circs.push(cr);
        phases.push(ph);
      } catch (e) {
        console.error('Animal failed:', a.id, e);
        summaries.push({ animal: a, id: a.id, group: a.group, genotype: a.genotype, sex: a.sex, treatment: a.treatment, replicate: a.replicate, experiment: a.experiment, error: e.message, daily: [], sleepData: { bouts: [] } });
        circs.push({ animal: a, error: e.message, tau: NaN, rhythmic: false });
        phases.push({ animal: a, IS: NaN, IV: NaN, RA: NaN, COG: NaN, MAI: NaN, EAI: NaN });
      }
      if (i % 3 === 0) {
        setStatus(`Analysing ${i + 1} / ${n} …`, false);
        await sleep(0);
      }
    }
    state.summaries = summaries;
    state.circadian = circs;
    state.phaseRows = phases;
    buildMetricRows();
    state.dirty = { overview: true, actograms: true, profiles: true, sleep: true, circadian: true, phase: true, stats: true };
    populateGroupSelects();
    populateStatsMetrics();
    populateProfileTestGroups();
    renderOverview();
    updateManifest();
    setBusy(false);
    setStatus('Ready', true);
  }

  async function recomputeCircadian() {
    if (state.busy) return;
    if (!state.animals.length) throw new Error('Build a dataset first.');
    state.settings.primaryMethod = $('circ-primary').value || state.settings.primaryMethod;
    setBusy(true, 'Recomputing periodograms…');
    state.circadian = [];
    state.phaseRows = [];
    for (let i = 0; i < state.animals.length; i++) {
      const a = state.animals[i];
      try {
        const cr = CL.analyseAnimal(a, state.settings, state.phaseMap);
        state.circadian.push(cr);
        const ph = PL.phaseMetrics(a, state.settings, state.phaseMap, cr);
        ph.animal = a;
        state.phaseRows.push(ph);
      } catch (e) {
        console.error('Circadian recompute failed:', a.id, e);
        state.circadian.push({ animal: a, error: e.message, tau: NaN, rhythmic: false });
        state.phaseRows.push({ animal: a, IS: NaN, IV: NaN, RA: NaN, COG: NaN, MAI: NaN, EAI: NaN });
      }
      if (i % 4 === 0) await sleep(0);
    }
    state.dirty.circadian = true;
    state.dirty.phase = true;
    buildMetricRows();
    syncSettingsUI();
    renderCircadian();
    setBusy(false);
    setStatus('Ready', true);
    toast('Periodograms recomputed.', 'success');
  }

  function buildMetricRows() {
    state.metricsRows = state.summaries.map((s, i) => {
      const cr = state.circadian[i] || {};
      const ph = state.phaseRows[i] || {};
      const a = s.animal || {};
      return {
        id: s.id || a.id, group: s.group || a.group, genotype: s.genotype || a.genotype || '',
        sex: s.sex || a.sex, treatment: s.treatment || a.treatment,
        replicate: s.replicate || a.replicate || '', experiment: s.experiment || a.experiment || '',
        startDateTime: s.startDateTime || a.startDateTime || '', stopDateTime: s.stopDateTime || a.stopDateTime || '',
        well: s.well || a.well, channel: s.channel, format: s.format,
        alive: s.alive, flags: (s.flags || []).join('; '),
        daysAnalyzed: s.daysAnalyzed, completeDays: s.completeDays,
        totalActivity: s.totalActivity, meanActivityPerDay: s.meanActivityPerDay,
        dayActivity: s.dayActivity, nightActivity: s.nightActivity, lightFraction: s.lightFraction,
        totalSleepMin: s.totalSleepMin, meanSleepPerDay: s.meanSleepPerDay,
        daySleepMin: s.daySleepMin, nightSleepMin: s.nightSleepMin,
        daySleepPerDay: s.daySleepPerDay, nightSleepPerDay: s.nightSleepPerDay,
        dayActivityPerDay: s.dayActivityPerDay, nightActivityPerDay: s.nightActivityPerDay,
        sleepPercent: s.sleepPercent,
        meanBoutCountPerDay: s.meanBoutCountPerDay, meanBoutLen: s.meanBoutLen,
        medianBoutLen: s.medianBoutLen, maxBoutLen: s.maxBoutLen, totalBouts: s.totalBouts,
        meanLatency: s.meanLatency, meanWaso: s.meanWaso, meanBriefAwakenings: s.meanBriefAwakenings,
        fragmentation: s.fragmentation, pWake: s.pWake, pDoze: s.pDoze,
        pWakeDay: s.pWakeDay, pDozeDay: s.pDozeDay, pWakeNight: s.pWakeNight, pDozeNight: s.pDozeNight,
        activityPerAwakeMin: s.activityPerAwakeMin,
        tau: cr.tau, rhythmic: cr.rhythmic, power: cr.chiSquare && cr.chiSquare.peakPower,
        width: cr.chiSquare && cr.chiSquare.peakWidth, ri: cr.autocorrelation && cr.autocorrelation.RI,
        rs: cr.autocorrelation && cr.autocorrelation.RS,
        tauChi: cr.chiSquare && cr.chiSquare.tau, tauLS: cr.lombScargle && cr.lombScargle.tau,
        tauAC: cr.autocorrelation && cr.autocorrelation.tau, tauFFT: cr.fft && cr.fft.tau,
        tauCos: cr.cosinor && cr.cosinor.tau, tauOnset: cr.onset && cr.onset.tau,
        consensusFlag: cr.consensusFlag, consensusMedian: cr.consensusMedian, consensusRange: cr.consensusRange,
        cosinorMesor: cr.cosinor && cr.cosinor.mesor,
        cosinorAmplitude: cr.cosinor && cr.cosinor.amplitude,
        cosinorPercentRhythm: cr.cosinor && cr.cosinor.percentRhythm,
        cosinorP: cr.cosinor && cr.cosinor.p,
        onsetR2: cr.onset && cr.onset.r2, onsetSd: cr.onset && cr.onset.sdOnset,
        IS: ph.IS, IV: ph.IV, RA: ph.RA, COG: ph.COG, M10: ph.M10, L5: ph.L5,
        acrophase: ph.acrophase, onset: ph.onset, offset: ph.offset,
        onsetPhase: ph.onsetPhase, offsetPhase: ph.offsetPhase,
        morningPeak: ph.morningPeak, eveningPeak: ph.eveningPeak,
        MAI: ph.MAI, EAI: ph.EAI, morningSlope: ph.morningSlope, eveningSlope: ph.eveningSlope,
        dayNightRatio: ph.dayNightRatio
      };
    });
  }

  function populateGroupSelects() {
    const groups = C.unique(state.animals.map((a) => a.group));
    const opts = groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    ['act-group-filter', 'prof-group', 'circ-group'].forEach((id) => {
      $(id).innerHTML = '<option value="__all">All groups</option>' + opts;
    });
    const animals = state.animals.map((a) => `<option value="${esc(a.id)}">${esc(a.id)} · ${esc(a.group)}</option>`).join('');
    $('act-animal-select').innerHTML = animals;
    $('act-group-filter').value = '__all';
    $('prof-group').value = '__all';
    $('circ-group').value = '__all';
  }

  const METRIC_LABELS = [
    ['meanSleepPerDay', 'Total daily sleep (min/day)'],
    ['daySleepMin', 'Day sleep (min/day)'],
    ['nightSleepMin', 'Night sleep (min/day)'],
    ['sleepPercent', 'Sleep (% of recording)'],
    ['meanBoutCountPerDay', 'Sleep bouts (per day)'],
    ['meanBoutLen', 'Mean bout length (min)'],
    ['maxBoutLen', 'Maximum bout length (min)'],
    ['meanLatency', 'Sleep latency (min)'],
    ['meanWaso', 'WASO (min)'],
    ['fragmentation', 'Fragmentation (bouts/h sleep)'],
    ['pWake', 'P(wake)'],
    ['pDoze', 'P(doze)'],
    ['meanActivityPerDay', 'Total daily activity'],
    ['dayActivity', 'Day activity'],
    ['nightActivity', 'Night activity'],
    ['activityPerAwakeMin', 'Activity per awake minute'],
    ['tau', 'Circadian period τ (h)'],
    ['power', 'Periodogram power'],
    ['width', 'Peak width (h)'],
    ['ri', 'Autocorrelation RI'],
    ['IS', 'Interdaily stability (IS)'],
    ['IV', 'Intradaily variability (IV)'],
    ['RA', 'Relative amplitude (RA)'],
    ['COG', 'Centre of gravity (h)'],
    ['MAI', 'Morning anticipation index'],
    ['EAI', 'Evening anticipation index'],
    ['acrophase', 'Cosinor acrophase (h)']
  ];
  function populateStatsMetrics() {
    $('stat-metric').innerHTML = METRIC_LABELS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    $('stat-metric').value = 'meanSleepPerDay';
  }
  function populateProfileTestGroups() {
    const groups = C.unique(state.animals.map((a) => a.group));
    ['profile-test-group-a', 'profile-test-group-b'].forEach((id, i) => {
      $(id).innerHTML = groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
      if (groups[i]) $(id).value = groups[i];
    });
  }

  /* ============================ render: overview ============================ */
  function renderOverview() {
    if (!state.metricsRows.length) { state.dirty.overview = false; return; }
    const rows = state.metricsRows;
    const groups = C.unique(rows.map((r) => r.group));
    const rhythmic = rows.filter((r) => r.rhythmic);
    const taus = rhythmic.map((r) => r.tau).filter(C.isNum);
    const nDays = C.max(rows.map((r) => r.daysAnalyzed).filter(C.isNum));
    renderKpisFromRows('overview-kpis', rows, [
      { k: 'Animals', v: rows.length, s: `${groups.length} groups` },
      { k: 'Recording', v: C.isNum(nDays) ? `${nDays} d` : '—', s: `${state.settings.binMin}-min bins` },
      { k: 'Rhythmic', v: pct(rows.length ? 100 * rhythmic.length / rows.length : NaN), s: `${rhythmic.length} animals` },
      { k: 'Mean τ', v: taus.length ? `${fmt(C.mean(taus), 2)} h` : '—', s: taus.length > 1 ? `SEM ${fmt(C.sem(taus), 2)}` : 'rhythmic only' },
      { k: 'Sleep / day', v: `${fmt(meanOf(rows, 'meanSleepPerDay'), 0)} min`, s: `${fmt(meanOf(rows, 'meanBoutCountPerDay'), 1)} bouts/day` },
      { k: 'Missing data', v: pct(100 * C.mean(state.summaries.map((s) => s.missingFraction).filter(C.isNum))), s: 'bins in analysis window' }
    ]);

    const gRows = groups.map((g) => {
      const rs = rows.filter((r) => r.group === g);
      const rhy = rs.filter((r) => r.rhythmic);
      const tau = rhy.map((r) => r.tau).filter(C.isNum);
      return [
        esc(g), rs.length, fmt(meanOf(rs, 'meanSleepPerDay'), 0), fmt(meanOf(rs, 'daySleepPerDay'), 0), fmt(meanOf(rs, 'nightSleepPerDay'), 0),
        fmt(meanOf(rs, 'meanActivityPerDay'), 0), fmt(meanOf(rs, 'meanBoutCountPerDay'), 1), fmt(meanOf(rs, 'meanBoutLen'), 1),
        tau.length ? fmt(C.mean(tau), 2) : '—', pct(rs.length ? 100 * rhy.length / rs.length : NaN),
        fmt(meanOf(rs, 'IS'), 2), fmt(meanOf(rs, 'IV'), 2), fmt(meanOf(rs, 'RA'), 2),
        fmt(meanOf(rs, 'MAI'), 2), fmt(meanOf(rs, 'EAI'), 2)
      ];
    });
    table('overview-group-table',
      ['Group', 'n', 'Sleep/day', 'Day sleep', 'Night sleep', 'Activity/day', 'Bouts/day', 'Bout len', 'τ (h)', '% rhythmic', 'IS', 'IV', 'RA', 'MAI', 'EAI'],
      gRows, { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });

    const flagged = state.summaries.filter((s) => s.flags && s.flags.length);
    table('overview-qc-table', ['Animal', 'Genotype', 'Group', 'Alive', 'Days', 'Complete', 'Flags'],
      flagged.map((s) => [esc(s.id), esc(s.genotype || ''), esc(s.group), s.alive ? 'yes' : 'no', s.daysAnalyzed, s.completeDays, esc(s.flags.join('; '))]),
      { numeric: [4, 5] });

    const animals = state.animals;
    try {
      const timeline = SL.wholeTimeline(animals, state.settings, state.phaseMap, 30);
      CH.plot($('overview-timeline'), timeline.map((s) => ({
        x: s.times.map((t) => t / 24), y: s.mean, name: s.group, mode: 'lines', line: { color: C.groupColor(timeline.indexOf(s)), width: 1.6 }
      })), (() => {
        const l = CH.baseLayout('', { showlegend: true });
        l.xaxis.title.text = 'Days'; l.yaxis.title.text = 'Activity / bin'; return l;
      })());
    } catch (e) { CH.clear($('overview-timeline'), 'Timeline unavailable.'); }
    try {
      const prof = SL.groupProfiles(animals, state.settings, state.phaseMap, 'activity', 30, state.settings.timeBase, {});
      const shapes = CH.darkIntervalShapes(CH.darkFractions(animals, state.settings, state.phaseMap, prof.times.length, 30, state.settings.timeBase), prof.times.length, 30, { double: false });
      CH.profileChart($('overview-profile'), prof, { title: '', style: 'lines', shapes });
    } catch (e) { CH.clear($('overview-profile'), 'Profile unavailable.'); }
    state.dirty.overview = false;
  }

  /* ============================ render: actograms ============================ */
  function renderActograms() {
    if (!state.animals.length) { state.dirty.actograms = false; return; }
    const groupFilter = $('act-group-filter').value;
    let animals = state.animals.filter((a) => groupFilter === '__all' || a.group === groupFilter);
    if (!animals.length) animals = state.animals;
    const mode = $('act-mode').value;
    const binMin = +$('act-bin').value || 30;
    const double = $('act-double').checked;
    const scaleMode = $('act-scale').value;
    const sleepMode = $('act-sleep').checked;
    const tauInput = parseFloat($('act-period-tau').value);
    const tau = C.isNum(tauInput) ? tauInput : null;
    const showOverlay = $('act-overlay').checked;
    const grid = $('actogram-grid');
    grid.innerHTML = '';
    grid.classList.toggle('single', mode !== 'average');
    if (mode === 'average') {
      const groups = C.unique(animals.map((a) => a.group));
      grid.classList.toggle('single', groups.length === 1);
      groups.forEach((g) => {
        const cell = document.createElement('div');
        cell.className = 'actogram-cell';
        grid.appendChild(cell);
        const members = animals.filter((a) => a.group === g);
        const tauForGroup = tau || C.mean(members.map((a) => {
          const c = state.circadian.find((r) => r.animal && r.animal.id === a.id);
          return c && C.isNum(c.tau) ? c.tau : NaN;
        }).filter(C.isNum));
        let ddDay = null;
        if (showOverlay && members.length) {
          const pm = state.phaseMap.get(members[0].id);
          if (pm) for (const [d, p] of pm) if (p === 'DD') { ddDay = d; break; }
        }
        CH.averageActogram(cell, members, { binMin, double, scaleMode, title: `${g} · average (n=${members.length})`, periodTau: C.isNum(tauForGroup) ? tauForGroup : null, ddDay });
      });
      $('act-page-label').textContent = `${groups.length} group${groups.length > 1 ? 's' : ''}`;
    } else {
      const selected = $('act-animal-select').value;
      let idx = animals.findIndex((a) => a.id === selected);
      if (idx < 0) idx = 0;
      state.actogramPage = C.clamp(state.actogramPage, 0, Math.max(0, animals.length - 1));
      const a = animals[state.actogramPage] || animals[0];
      const cell = document.createElement('div');
      cell.className = 'actogram-cell';
      grid.appendChild(cell);
      const c = state.circadian.find((r) => r.animal && r.animal.id === a.id);
      const tauForAnimal = tau || (c && C.isNum(c.tau) ? c.tau : null);
      let markers = null, ddDay = null;
      if (showOverlay) {
        const mask = I.analysisMask(a, state.settings, state.phaseMap);
        const oo = PL.onsetOffset(a, mask, state.settings);
        markers = (oo.onsetEntries || []).map((e) => ({ ...e, type: 'onset' }))
          .concat((oo.offsetEntries || []).map((e) => ({ ...e, type: 'offset' })));
        const pm = state.phaseMap.get(a.id);
        if (pm) for (const [d, p] of pm) if (p === 'DD') { ddDay = d; break; }
      }
      if (sleepMode) CH.sleepActogram(cell, a, state.settings, state.phaseMap, { binMin, double, title: `Sleep · ${a.id} · ${a.group}`, periodTau: tauForAnimal, ddDay });
      else CH.actogram(cell, a, { binMin, double, scaleMode, title: `${a.id} · ${a.group}`, periodTau: tauForAnimal, markers, ddDay });
      $('act-page-label').textContent = `${state.actogramPage + 1} / ${animals.length} · ${a.id}`;
      $('act-animal-select').value = a.id;
    }
    state.dirty.actograms = false;
  }

  /* ============================ render: profiles ============================ */
  function applyErrorBars(profile, mode) {
    profile.groups.forEach((g) => {
      g.sem = g.sem.map((v, i) => {
        if (!C.isNum(v)) return v;
        if (mode === 'sd') return g.sd[i];
        if (mode === 'ci') return 1.96 * v;
        return v;
      });
    });
    return profile;
  }
  function averageArchitecture(animals, settings, phaseMap) {
    const hours = 24;
    const sleep = new Array(hours).fill(0), bouts = new Array(hours).fill(0), lens = new Array(hours).fill(0);
    let n = 0;
    for (const a of animals) {
      const mask = I.analysisMask(a, settings, phaseMap);
      const state = SL.stateSeries(a, settings);
      const sd = SL.scoreSleep(state, mask, a.binMinutes, settings.minSleepMinutes);
      const arch = SL.hourlyArchitecture(a, mask, sd, settings);
      for (let h = 0; h < hours; h++) {
        sleep[h] += arch.sleepPerDay[h] || 0;
        bouts[h] += arch.boutCountPerDay[h] || 0;
        lens[h] += arch.meanBoutLen[h] || 0;
      }
      n++;
    }
    return {
      hours: Array.from({ length: hours }, (_, h) => h),
      sleepPerDay: sleep.map((v) => v / Math.max(1, n)),
      boutCountPerDay: bouts.map((v) => v / Math.max(1, n)),
      meanBoutLen: lens.map((v) => v / Math.max(1, n)),
      nDays: 1
    };
  }
  function renderProfiles() {
    if (!state.animals.length) { state.dirty.profiles = false; return; }
    const groupFilter = $('prof-group').value;
    let animals = state.animals.filter((a) => groupFilter === '__all' || a.group === groupFilter);
    if (!animals.length) animals = state.animals;
    const variable = $('prof-variable').value;
    const res = +$('prof-res').value || 30;
    const base = $('prof-timebase').value;
    const normalise = $('prof-normalise').value;
    const style = $('prof-style').value;
    const errMode = $('prof-error').value;
    const double = $('prof-double').checked;
    const polar = $('prof-polar').checked;
    const prof = applyErrorBars(SL.groupProfiles(animals, state.settings, state.phaseMap, variable, res, base, { normalise }), errMode);
    const dark = CH.darkFractions(animals, state.settings, state.phaseMap, prof.times.length, res, base);
    const shapes = CH.darkIntervalShapes(dark, prof.times.length, res, { double });
    $('profile-title').textContent = `${prof.label} · ${base} · ${res}-min bins`;
    if (polar) CH.circularChart($('profile-main'), prof, { title: `` });
    else CH.profileChart($('profile-main'), prof, { title: '', style, double, shapes, yTitle: prof.label });

    // architecture
    const sleepProf = applyErrorBars(SL.groupProfiles(animals, state.settings, state.phaseMap, 'sleepMin', res, base, {}), errMode);
    CH.sleepArchitectureChart($('profile-architecture'), sleepProf, averageArchitecture(animals, state.settings, state.phaseMap), { title: '' });
    // transitions
    const wake = applyErrorBars(SL.groupProfiles(animals, state.settings, state.phaseMap, 'pWake', res, base, {}), errMode);
    const doze = applyErrorBars(SL.groupProfiles(animals, state.settings, state.phaseMap, 'pDoze', res, base, {}), errMode);
    CH.transitionChart($('profile-transition'), wake, doze, { title: '', shapes: CH.darkIntervalShapes(dark, prof.times.length, res, { double: false }) });
    // circular
    const circProf = SL.groupProfiles(animals, state.settings, state.phaseMap, 'activity', 60, base, {});
    CH.circularChart($('profile-circular'), circProf, { title: '' });
    // raster
    const raster = SL.stateRaster(animals, state.settings, state.phaseMap, 30);
    CH.rasterChart($('profile-raster'), raster, { title: '', maxRows: 40 });
    state.dirty.profiles = false;
  }

  /* ============================ render: sleep ============================ */
  function categoryByHour(animals, summaries) {
    const short = new Array(24).fill(0), inter = new Array(24).fill(0), long = new Array(24).fill(0);
    let totalDays = 0;
    for (const s of summaries) {
      if (!s.sleepData) continue;
      totalDays += Math.max(1, s.daysAnalyzed || 1);
      for (const b of s.sleepData.bouts) {
        const h = C.clamp(Math.floor(b.startZt || 0), 0, 23);
        if (b.category === 'short') short[h] += b.durationMin;
        else if (b.category === 'intermediate') inter[h] += b.durationMin;
        else long[h] += b.durationMin;
      }
    }
    return {
      hours: Array.from({ length: 24 }, (_, h) => h),
      short: short.map((v) => v / Math.max(1, totalDays)),
      intermediate: inter.map((v) => v / Math.max(1, totalDays)),
      long: long.map((v) => v / Math.max(1, totalDays))
    };
  }
  function renderSleep() {
    if (!state.summaries.length) { state.dirty.sleep = false; return; }
    const rows = state.metricsRows;
    kpiGrid('sleep-kpis', [
      { k: 'Sleep / day', v: `${fmt(meanOf(rows, 'meanSleepPerDay'), 0)} min`, s: `${fmt(meanOf(rows, 'sleepPercent'), 1)}% of time` },
      { k: 'Day sleep', v: `${fmt(meanOf(rows, 'daySleepPerDay'), 0)} min`, s: 'per day · subjective day in DD' },
      { k: 'Night sleep', v: `${fmt(meanOf(rows, 'nightSleepPerDay'), 0)} min`, s: 'per day · subjective night in DD' },
      { k: 'Bouts / day', v: fmt(meanOf(rows, 'meanBoutCountPerDay'), 1), s: `mean ${fmt(meanOf(rows, 'meanBoutLen'), 1)} min` },
      { k: 'Latency', v: `${fmt(meanOf(rows, 'meanLatency'), 0)} min`, s: 'to first bout' },
      { k: 'WASO', v: `${fmt(meanOf(rows, 'meanWaso'), 0)} min`, s: 'wake after sleep onset' },
      { k: 'P(wake)', v: fmt(meanOf(rows, 'pWake'), 3), s: 'inactive → active' },
      { k: 'P(doze)', v: fmt(meanOf(rows, 'pDoze'), 3), s: 'active → inactive' }
    ]);

    const sleepRows = state.summaries.map((s) => [
      esc(s.id), esc(s.group), s.daysAnalyzed, fmt(s.meanSleepPerDay, 0), fmt(s.daySleepPerDay, 0), fmt(s.nightSleepPerDay, 0),
      fmt(s.sleepPercent, 1), fmt(s.meanBoutCountPerDay, 1), fmt(s.meanBoutLen, 1), fmt(s.maxBoutLen, 1),
      fmt(s.meanLatency, 0), fmt(s.meanWaso, 0), fmt(s.fragmentation, 2), fmt(s.pWake, 3), fmt(s.pDoze, 3),
      fmt(s.pWakeDay, 3), fmt(s.pDozeDay, 3), fmt(s.pWakeNight, 3), fmt(s.pDozeNight, 3),
      fmt(s.categorySleepPerDay.short, 0), fmt(s.categorySleepPerDay.intermediate, 0), fmt(s.categorySleepPerDay.long, 0),
      fmt(s.meanBriefAwakenings, 1), fmt(s.activityPerAwakeMin, 2)
    ]);
    table('sleep-table', ['Animal', 'Group', 'Days', 'Sleep/day', 'Day', 'Night', '% sleep', 'Bouts/day', 'Mean bout', 'Max bout', 'Latency', 'WASO', 'Frag.', 'P(wake)', 'P(doze)', 'Pw day', 'Pz day', 'Pw night', 'Pz night', 'Short/day', 'Inter/day', 'Long/day', 'Brief wake', 'Act/awake'], sleepRows, { numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] });

    const animals = state.animals;
    const prof = applyErrorBars(SL.groupProfiles(animals, state.settings, state.phaseMap, 'sleepMin', 30, state.settings.timeBase, {}), $('prof-error').value);
    CH.profileChart($('sleep-profile-chart'), prof, { title: '', style: 'lines', shapes: CH.darkIntervalShapes(CH.darkFractions(animals, state.settings, state.phaseMap, prof.times.length, 30, state.settings.timeBase), prof.times.length, 30, { double: false }), yTitle: 'Sleep (min/bin)' });
    const allBouts = state.summaries.flatMap((s) => s.sleepData ? s.sleepData.bouts : []);
    CH.histogramChart($('sleep-bout-chart'), allBouts.map((b) => b.durationMin), { title: '' });
    CH.sleepCategoryChart($('sleep-category-chart'), categoryByHour(animals, state.summaries), { title: '' });

    const rebound = SL.sleepRebound(animals, state.summaries, {
      reboundBaseline: parseDayList(state.settings.reboundBaseline),
      reboundDeprivation: parseDayList(state.settings.reboundDeprivation),
      reboundRecovery: parseDayList(state.settings.reboundRecovery)
    });
    if (rebound && rebound.length) {
      CH.boxPlot($('sleep-rebound-chart'), rebound, 'rebound', { label: 'Sleep rebound (min)', title: '' });
    } else {
      CH.clear($('sleep-rebound-chart'), 'Set baseline / deprivation / recovery days in Settings to compute rebound.');
    }

    const boutRows = [];
    for (const s of state.summaries) {
      if (!s.sleepData) continue;
      for (const b of s.sleepData.bouts.slice(0, 300)) {
        boutRows.push([esc(s.id), esc(s.group), b.day, fmt(b.startZt, 2), fmt(b.startTime, 2), fmt(b.durationMin, 1), esc(b.category), esc(b.lightPhase), b.truncated ? 'yes' : 'no']);
      }
    }
    table('sleep-bout-table', ['Animal', 'Group', 'Day', 'ZT start', 'Start (h)', 'Duration (min)', 'Category', 'Phase', 'Truncated'], boutRows, { numeric: [2, 3, 4, 5] });
    state.dirty.sleep = false;
    state.reboundRows = rebound;
  }

  function parseDayList(str) {
    if (!str) return [];
    const out = [];
    for (const token of String(str).split(/[,; ]+/).filter(Boolean)) {
      const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(token);
      if (m) {
        const a = +m[1], b = +m[2];
        for (let d = Math.min(a, b); d <= Math.max(a, b); d++) out.push(d);
      } else {
        const n = parseInt(token, 10);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    return [...new Set(out)];
  }

  /* ============================ render: circadian ============================ */
  function renderCircadian() {
    if (!state.circadian.length) { state.dirty.circadian = false; return; }
    if ($('circ-primary').value !== state.settings.primaryMethod) $('circ-primary').value = state.settings.primaryMethod;
    if ($('set-primary').value !== state.settings.primaryMethod) $('set-primary').value = state.settings.primaryMethod;
    const groupFilter = $('circ-group').value;
    const results = state.circadian.filter((r) => groupFilter === '__all' || (r.animal && r.animal.group === groupFilter));
    const valid = results.filter((r) => r && !r.error);
    const rhythmic = valid.filter((r) => r.rhythmic);
    const taus = rhythmic.map((r) => r.tau).filter(C.isNum);
    const powers = valid.map((r) => r.chiSquare && r.chiSquare.peakPower).filter(C.isNum);
    const ris = valid.map((r) => r.autocorrelation && r.autocorrelation.RI).filter(C.isNum);
    const significant = valid.filter((r) => r.chiSquare && C.isNum(r.chiSquare.peakPower) && r.chiSquare.peakPower >= 0);
    kpiGrid('circ-kpis', [
      { k: 'Animals', v: valid.length, s: `${rhythmic.length} meet strict criteria` },
      { k: 'Mean τ', v: taus.length ? `${fmt(C.mean(taus), 2)} h` : '—', s: taus.length > 1 ? `SEM ${fmt(C.sem(taus), 2)}` : '' },
      { k: 'Peak significant', v: pct(valid.length ? 100 * significant.length / valid.length : NaN), s: 'Qp above threshold' },
      { k: '% rhythmic', v: pct(valid.length ? 100 * rhythmic.length / valid.length : NaN), s: `power ≥ ${state.settings.powerMin} & width ≥ ${state.settings.widthMin} h` },
      { k: 'Mean power', v: fmt(C.mean(powers), 1), s: 'Qp − threshold' },
      { k: 'Mean RI', v: fmt(C.mean(ris), 2), s: 'autocorrelation' },
      { k: 'Consensus flags', v: valid.filter((r) => r.consensusFlag).length, s: 'methods differ > tolerance' }
    ]);
    const method = $('circ-method').value;
    CH.periodogramChart($('circ-periodogram'), results, { method, showIndividuals: $('circ-show-individuals').checked, minPeriod: state.settings.minPeriod, maxPeriod: state.settings.maxPeriod, title: '' });
    CH.periodDistributionChart($('circ-distribution'), results, { minPeriod: state.settings.minPeriod, maxPeriod: state.settings.maxPeriod, title: '' });
    CH.autocorrelationChart($('circ-autocorr'), results, { title: '' });
    const pop = CL.populationPeriodogram(results, 'chi-square');
    CH.populationChart($('circ-population'), pop, { title: '', yTitle: 'Mean Qp − threshold' });

    const gs = CL.groupSummary(results);
    table('circ-summary-table', ['Group', 'n', 'Significant', '% significant', 'Rhythmic', '% rhythmic', 'Mean τ', 'SEM τ', 'Median τ', 'Mean power', 'Mean RI', 'Flags'],
      gs.map((g) => [esc(g.group), g.n, g.nSignificant, pct(g.percentSignificant), g.nRhythmic, pct(g.percentRhythmic), fmt(g.meanTau, 2), fmt(g.semTau, 2), fmt(g.medianTau, 2), fmt(g.meanPower, 1), fmt(g.meanRI, 2), g.nFlagged]),
      { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });

    const rows = results.map((r) => [
      esc(r.animal ? r.animal.id : '—'), esc(r.animal ? r.animal.group : '—'),
      fmt(r.tau, 2), fmt(r.chiSquare && r.chiSquare.tau, 2), fmt(r.lombScargle && r.lombScargle.tau, 2),
      fmt(r.autocorrelation && r.autocorrelation.tau, 2), fmt(r.fft && r.fft.tau, 2),
      fmt(r.cosinor && r.cosinor.tau, 2), fmt(r.onset && r.onset.tau, 2),
      fmt(r.cosinor && r.cosinor.amplitude, 2), fmt(r.cosinor && r.cosinor.percentRhythm, 1),
      fmt(r.chiSquare && r.chiSquare.peakPower, 1), fmt(r.chiSquare && r.chiSquare.peakWidth, 2),
      fmt(r.autocorrelation && r.autocorrelation.RI, 2), fmt(r.autocorrelation && r.autocorrelation.RS, 2),
      r.chiSquare && r.chiSquare.peakPower >= 0 ? 'yes' : 'no', r.rhythmic ? 'yes' : 'no', r.consensusFlag ? 'flag' : ''
    ]);
    table('circ-results-table', ['Animal', 'Group', 'τ primary', 'τ χ²', 'τ LS', 'τ AC', 'τ FFT', 'τ cosinor', 'τ onset', 'A', '%R', 'Power', 'Width', 'RI', 'RS', 'Significant', 'Rhythmic', 'Consensus'], rows, { numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] });
    state.dirty.circadian = false;
  }

  /* ============================ render: phase ============================ */
  function renderPhase() {
    if (!state.phaseRows.length) { state.dirty.phase = false; return; }
    const rows = state.metricsRows;
    kpiGrid('phase-kpis', [
      { k: 'IS', v: fmt(meanOf(rows, 'IS'), 2), s: 'interdaily stability' },
      { k: 'IV', v: fmt(meanOf(rows, 'IV'), 2), s: 'intradaily variability' },
      { k: 'RA', v: fmt(meanOf(rows, 'RA'), 2), s: 'relative amplitude' },
      { k: 'COG', v: `${fmt(meanOf(rows, 'COG'), 1)} h`, s: 'centre of gravity' },
      { k: 'MAI', v: fmt(meanOf(rows, 'MAI'), 2), s: 'morning anticipation' },
      { k: 'EAI', v: fmt(meanOf(rows, 'EAI'), 2), s: 'evening anticipation' }
    ]);
    const groups = C.unique(rows.map((r) => r.group));
    const summary = groups.map((g) => {
      const rs = rows.filter((r) => r.group === g);
      return [esc(g), rs.length, fmt(meanOf(rs, 'IS'), 2), fmt(meanOf(rs, 'IV'), 2), fmt(meanOf(rs, 'RA'), 2), fmt(meanOf(rs, 'COG'), 1), fmt(meanOf(rs, 'M10'), 1), fmt(meanOf(rs, 'L5'), 1), fmt(meanOf(rs, 'acrophase'), 1), fmt(meanOf(rs, 'onset'), 1), fmt(meanOf(rs, 'offset'), 1), fmt(meanOf(rs, 'MAI'), 2), fmt(meanOf(rs, 'EAI'), 2)];
    });
    table('phase-summary-table', ['Group', 'n', 'IS', 'IV', 'RA', 'COG', 'M10', 'L5', 'Acrophase', 'Onset', 'Offset', 'MAI', 'EAI'], summary, { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
    const per = rows.map((r) => [esc(r.id), esc(r.group), fmt(r.IS, 2), fmt(r.IV, 2), fmt(r.RA, 2), fmt(r.COG, 1), fmt(r.M10, 1), fmt(r.L5, 1), fmt(r.acrophase, 1), fmt(r.onset, 1), fmt(r.offset, 1), fmt(r.MAI, 2), fmt(r.EAI, 2), fmt(r.dayNightRatio, 2), fmt(r.morningPeak, 1), fmt(r.eveningPeak, 1), fmt(r.morningSlope, 3), fmt(r.eveningSlope, 3)]);
    table('phase-table', ['Animal', 'Group', 'IS', 'IV', 'RA', 'COG', 'M10', 'L5', 'Acrophase', 'Onset', 'Offset', 'MAI', 'EAI', 'Day/night', 'M peak', 'E peak', 'M slope', 'E slope'], per, { numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] });
    const prof = SL.groupProfiles(state.animals, state.settings, state.phaseMap, 'activity', 60, state.settings.timeBase, {});
    CH.circularChart($('phase-circular'), prof, { title: '' });
    if (rows.some((r) => C.isNum(r.MAI) || C.isNum(r.EAI))) {
      CH.multiBoxPlot($('phase-anticipation-chart'), rows, ['MAI', 'EAI'], ['MAI', 'EAI'], { title: '', yTitle: 'Anticipation index' });
    } else {
      CH.clear($('phase-anticipation-chart'), 'Anticipation requires LD light transitions. Switch the phase window to ALL or LD.');
    }
    state.dirty.phase = false;
  }

  /* ============================ render: statistics ============================ */
  function renderStats() {
    if (!state.metricsRows.length) { state.dirty.stats = false; return; }
    runStats(false);
    state.dirty.stats = false;
  }
  function runStats(notify = true) {
    const metric = $('stat-metric').value;
    const groupvar = $('stat-groupvar').value;
    const correction = $('stat-correction').value;
    const rows = state.metricsRows;
    const groups = C.unique(rows.map((r) => r[groupvar] || 'NA'));
    const values = {};
    groups.forEach((g) => { values[g] = rows.filter((r) => (r[groupvar] || 'NA') === g).map((r) => r[metric]).filter(C.isNum); });
    const res = S.compareGroups(values, groups, { dunnCorrection: correction, tCorrection: correction });
    state.statsResult = { metric, groupvar, groups, values, res };
    const label = (METRIC_LABELS.find(([k]) => k === metric) || [metric, metric])[1];
    $('stat-box-title').textContent = `${label} by ${groupvar}`;
    const plotRows = rows.map((r) => ({ group: r[groupvar] || 'NA', value: r[metric] })).filter((r) => C.isNum(r.value));
    const annotations = [];
    if (res.welch && C.isNum(res.welch.p)) {
      annotations.push({ text: `Welch p = ${C.fmtP(res.welch.p)}`, xref: 'paper', yref: 'paper', x: 0.98, y: 0.97, xanchor: 'right', showarrow: false, font: { family: 'DM Mono, monospace', size: 10, color: CH.THEME.ink } });
    }
    CH.boxPlot($('stat-box'), plotRows, 'value', {
      label, title: '', annotations,
      yMin: parseFloat($('stat-ymin').value), yMax: parseFloat($('stat-ymax').value)
    });
    table('stat-descriptive', ['Group', 'n', 'Mean', 'SD', 'SEM', 'Median', 'IQR', 'Min', 'Max'],
      res.descriptive.map((d) => [esc(d.group), d.n, fmt(d.mean, 3), fmt(d.sd, 3), fmt(d.sem, 3), fmt(d.median, 3), fmt(d.iqr, 3), fmt(d.min, 3), fmt(d.max, 3)]),
      { numeric: [1, 2, 3, 4, 5, 6, 7, 8] });
    table('stat-shapiro', ['Group', 'n', 'W', 'p', 'Normal?'],
      res.shapiro.map((d) => [esc(d.group), d.n, fmt(d.W, 4), C.fmtP(d.p), C.isNum(d.p) ? (d.p > 0.05 ? 'yes' : 'no') : '—']),
      { numeric: [1, 2, 3] });
    const testRows = [];
    if (res.welch) {
      testRows.push(['Welch t', `${groups[0]} vs ${groups[1]}`, fmt(res.welch.t, 3), fmt(res.welch.df, 1), C.fmtP(res.welch.p), fmt(res.welch.d, 2), `95% CI ${fmt(res.welch.ciLow, 2)} to ${fmt(res.welch.ciHigh, 2)}`]);
      testRows.push(['Mann–Whitney U', `${groups[0]} vs ${groups[1]}`, fmt(res.mannWhitney.U, 1), '—', C.fmtP(res.mannWhitney.p), fmt(res.mannWhitney.rankBiserial, 2), 'rank-biserial']);
    }
    if (res.anova) {
      testRows.push(['One-way ANOVA', groups.join(', '), fmt(res.anova.F, 3), `${res.anova.df1}, ${res.anova.df2}`, C.fmtP(res.anova.p), fmt(res.anova.eta2, 3), 'η²']);
      testRows.push(['Kruskal–Wallis', groups.join(', '), fmt(res.kruskal.H, 3), res.kruskal.df, C.fmtP(res.kruskal.p), '—', 'rank-based']);
    }
    table('stat-tests', ['Test', 'Groups', 'Statistic', 'df', 'p', 'Effect size', 'Notes'], testRows, { numeric: [2, 3, 4, 5] });
    const post = [];
    if (res.pairwiseWelch) {
      res.pairwiseWelch.forEach((p) => post.push(['Welch t', `${p.a} vs ${p.b}`, fmt(p.diff, 2), fmt(p.t, 3), C.fmtP(p.p), C.fmtP(p.pAdj), fmt(p.d, 2)]));
    }
    if (res.dunn) {
      res.dunn.comparisons.forEach((c) => post.push(['Dunn', `${c.labelA} vs ${c.labelB}`, fmt(c.meanRankA - c.meanRankB, 1), fmt(c.z, 3), C.fmtP(c.pRaw), C.fmtP(c.pAdj), '—']));
    }
    table('stat-posthoc', ['Test', 'Comparison', 'Difference', 'Statistic', 'p raw', 'p adjusted', 'Effect size'], post, { numeric: [2, 3, 4, 5, 6] });

    // proportions
    const rhy = groups.map((g) => {
      const rs = rows.filter((r) => (r[groupvar] || 'NA') === g);
      const n = rs.length, k = rs.filter((r) => r.rhythmic).length;
      return { g, n, k, non: n - k };
    });
    let propRows = rhy.map((r) => [esc(r.g), r.k, r.non, pct(r.n ? 100 * r.k / r.n : NaN)]);
    let propNote = '';
    if (rhy.length === 2) {
      const f = S.fisherExact(rhy[0].k, rhy[0].non, rhy[1].k, rhy[1].non);
      propNote = `Fisher exact p = ${C.fmtP(f.p)}; odds ratio = ${fmt(f.oddsRatio, 3)}`;
    } else if (rhy.length > 2) {
      const chi = S.chiSquareTest(rhy.map((r) => [r.k, r.non]));
      propNote = `Chi-square p = ${C.fmtP(chi.p)}; Cramér's V = ${fmt(chi.cramersV, 3)}${chi.warning ? ' · ' + chi.warning : ''}`;
    }
    table('stat-proportion', ['Group', 'Rhythmic', 'Non-rhythmic', '% rhythmic'], propRows, { numeric: [1, 2, 3] });
    $('stat-proportion').querySelectorAll('.preview-note').forEach((n) => n.remove());
    if (propNote) $('stat-proportion').insertAdjacentHTML('beforeend', `<p class="preview-note">${esc(propNote)}</p>`);
    if (notify) toast('Statistics computed.', 'success');
  }

  function runProfileTest() {
    if (!state.animals.length) throw new Error('No animals.');
    const variable = $('profile-test-variable').value;
    const ga = $('profile-test-group-a').value;
    const gb = $('profile-test-group-b').value;
    if (ga === gb) throw new Error('Choose two different groups.');
    const A = state.animals.filter((a) => a.group === ga);
    const B = state.animals.filter((a) => a.group === gb);
    if (!A.length || !B.length) throw new Error('Both groups need at least one animal.');
    const matrix = (animals) => animals.map((a) => SL.perAnimalProfile(a, I.analysisMask(a, state.settings, state.phaseMap), variable, 30, 'ZT', state.settings).profile);
    const mA = matrix(A), mB = matrix(B);
    const test = S.profilePermutationTest(mA, mB, 1000);
    const bins = S.profileBinTests(mA, mB);
    const mean = (rows) => {
      const n = rows[0].length;
      const m = new Array(n).fill(NaN), sem = new Array(n).fill(NaN);
      for (let i = 0; i < n; i++) {
        const vals = rows.map((r) => r[i]).filter(C.isNum);
        if (vals.length) { m[i] = C.mean(vals); if (vals.length > 1) sem[i] = C.sem(vals); }
      }
      return { mean: m, sem };
    };
    const a = mean(mA), b = mean(mB);
    const times = Array.from({ length: a.mean.length }, (_, i) => i * 0.5);
    CH.profileComparisonChart($('profile-test-chart'), { times, a, b, groupA: ga, groupB: gb, binTests: bins }, { title: '', yTitle: variable });
    const sig = bins.filter((x) => x.pAdj < 0.05);
    table('profile-test-result', ['Test', 'Statistic', 'p', 'Note'], [
      ['Permutation (1000 shuffles)', fmt(test.observed, 2), C.fmtP(test.p), `${test.nA} vs ${test.nB} animals`],
      ['Bins with BH p < 0.05', sig.length, '—', sig.length ? sig.map((x) => `${x.bin * 0.5} h`).join(', ') : 'none']
    ]);
    state.profileTest = { test, bins };
    toast(`Profile comparison: permutation p = ${C.fmtP(test.p)}.`, 'success');
  }

  /* ============================ validation ============================ */
  function runValidation() {
    state.validation = SM.runValidation();
    state.properties = SM.runPropertyTests();
    table('validation-table', ['Expected τ', 'χ²', 'LS', 'AC', 'FFT', 'Cosinor', 'χ² error'],
      state.validation.map((r) => [fmt(r.expected, 1), fmt(r.chiSquare, 2), fmt(r.lombScargle, 2), fmt(r.autocorrelation, 2), fmt(r.fft, 2), fmt(r.cosinor, 2), fmt(r.chiSquareError, 2)]),
      { numeric: [0, 1, 2, 3, 4, 5, 6] });
    table('property-table', ['Property', 'Pass', 'Detail'],
      state.properties.map((r) => [esc(r.test), r.pass ? 'yes' : 'no', esc(r.detail)]));
    toast('Validation complete.', 'success');
  }

  /* ============================ export ============================ */
  function metricsCsv() {
    const headers = ['animal_id', 'group', 'genotype', 'sex', 'treatment', 'replicate', 'experiment', 'start_datetime', 'stop_datetime', 'well', 'channel', 'format', 'alive', 'flags',
      'days_analyzed', 'complete_days', 'total_activity', 'mean_activity_day', 'day_activity', 'night_activity', 'day_activity_per_day', 'night_activity_per_day', 'light_fraction',
      'total_sleep_min', 'mean_sleep_day', 'day_sleep_min', 'night_sleep_min', 'day_sleep_per_day', 'night_sleep_per_day', 'sleep_percent',
      'mean_bout_count_day', 'mean_bout_len', 'median_bout_len', 'max_bout_len', 'total_bouts',
      'mean_latency', 'mean_waso', 'mean_brief_awakenings', 'fragmentation', 'p_wake', 'p_doze', 'p_wake_day', 'p_doze_day', 'p_wake_night', 'p_doze_night', 'activity_per_awake_min',
      'tau', 'rhythmic', 'power', 'width', 'ri', 'rs', 'is', 'iv', 'ra', 'cog', 'm10', 'l5', 'acrophase', 'onset', 'offset', 'mai', 'eai',
      'cosinor_amplitude', 'cosinor_percent_rhythm', 'onset_r2', 'onset_sd', 'onset_phase', 'offset_phase', 'morning_peak', 'evening_peak', 'day_night_ratio'];
    const rows = state.metricsRows.map((r) => [
      r.id, r.group, r.genotype, r.sex, r.treatment, r.replicate, r.experiment, r.startDateTime, r.stopDateTime, r.well, r.channel, r.format, r.alive, r.flags,
      r.daysAnalyzed, r.completeDays, r.totalActivity, r.meanActivityPerDay, r.dayActivity, r.nightActivity, r.dayActivityPerDay, r.nightActivityPerDay, r.lightFraction,
      r.totalSleepMin, r.meanSleepPerDay, r.daySleepMin, r.nightSleepMin, r.daySleepPerDay, r.nightSleepPerDay, r.sleepPercent,
      r.meanBoutCountPerDay, r.meanBoutLen, r.medianBoutLen, r.maxBoutLen, r.totalBouts,
      r.meanLatency, r.meanWaso, r.meanBriefAwakenings, r.fragmentation, r.pWake, r.pDoze, r.pWakeDay, r.pDozeDay, r.pWakeNight, r.pDozeNight, r.activityPerAwakeMin,
      r.tau, r.rhythmic ? 'yes' : 'no', r.power, r.width, r.ri, r.rs, r.IS, r.IV, r.RA, r.COG, r.M10, r.L5, r.acrophase, r.onset, r.offset, r.MAI, r.EAI,
      r.cosinorAmplitude, r.cosinorPercentRhythm, r.onsetR2, r.onsetSd, r.onsetPhase, r.offsetPhase, r.morningPeak, r.eveningPeak, r.dayNightRatio
    ]);
    return { filename: 'animals_summary.csv', content: C.csvStringify(headers, rows) };
  }
  function timeSeriesCsv() {
    const headers = ['animal_id', 'group', 'genotype', 't_hours', 'activity', 'moving', 'asleep', 'light', 'zt', 'ct', 'day'];
    const rows = [];
    for (const a of state.animals) rows.push(...SL.timeSeriesTable(a, state.settings, state.phaseMap));
    return { filename: 'time_series.csv', content: C.csvStringify(headers, rows) };
  }
  function boutsCsv() {
    const headers = ['animal_id', 'group', 'genotype', 'bout_id', 'day', 'start_index', 'end_index', 'start_hours', 'duration_min', 'start_zt', 'end_zt', 'light_phase', 'category', 'truncated'];
    const rows = [];
    for (const s of state.summaries) {
      if (!s.sleepData) continue;
      for (const b of s.sleepData.bouts) {
        rows.push([s.id, s.group, s.genotype, b.id, b.day, b.start, b.end, b.startTime, b.durationMin, b.startZt, b.endZt, b.lightPhase, b.category, b.truncated ? 'yes' : 'no']);
      }
    }
    return { filename: 'bouts.csv', content: C.csvStringify(headers, rows) };
  }
  function periodogramsCsv() {
    const headers = ['animal_id', 'group', 'genotype', 'method', 'period_h', 'power', 'threshold', 'power_above_threshold'];
    const rows = [];
    for (const r of state.circadian) {
      if (!r || r.error) continue;
      const add = (method, s) => {
        if (!s || !s.periods) return;
        s.periods.forEach((p, i) => {
          const power = method === 'chi-square' ? s.qp[i] : s.power[i];
          const thr = method === 'chi-square' ? s.threshold[i] : (s.threshold ?? NaN);
          rows.push([r.animal.id, r.animal.group, r.animal.genotype, method, p, power, thr, method === 'chi-square' ? s.power[i] : (C.isNum(power) && C.isNum(thr) ? power - thr : NaN)]);
        });
      };
      add('chi-square', r.chiSquare);
      add('lomb-scargle', r.lombScargle);
      add('fft', r.fft);
      if (r.autocorrelation && r.autocorrelation.lags) {
        r.autocorrelation.lags.forEach((lag, i) => {
          rows.push([r.animal.id, r.animal.group, r.animal.genotype, 'autocorrelation', lag, r.autocorrelation.smoothed[i], 0.3, r.autocorrelation.smoothed[i] - 0.3]);
        });
      }
    }
    return { filename: 'periodograms.csv', content: C.csvStringify(headers, rows) };
  }
  function profilesCsv() {
    const prof = SL.groupProfiles(state.animals, state.settings, state.phaseMap, 'activity', 30, state.settings.timeBase, {});
    const headers = ['variable', 'group', 'time_h', 'mean', 'sem', 'n'];
    const rows = [];
    for (const g of prof.groups) g.mean.forEach((m, i) => rows.push(['activity', g.group, prof.times[i], m, g.sem[i], g.n[i]]));
    const sp = SL.groupProfiles(state.animals, state.settings, state.phaseMap, 'sleepMin', 30, state.settings.timeBase, {});
    for (const g of sp.groups) g.mean.forEach((m, i) => rows.push(['sleep', g.group, sp.times[i], m, g.sem[i], g.n[i]]));
    return { filename: 'profiles.csv', content: C.csvStringify(headers, rows) };
  }
  function groupStatsCsv() {
    const res = state.statsResult;
    if (!res) return { filename: 'group_stats.csv', content: 'metric,group,n,mean,sd,sem,median\n' };
    const headers = ['metric', 'group', 'n', 'mean', 'sd', 'sem', 'median', 'iqr', 'min', 'max'];
    const rows = res.res.descriptive.map((d) => [res.metric, d.group, d.n, d.mean, d.sd, d.sem, d.median, d.iqr, d.min, d.max]);
    return { filename: 'group_stats.csv', content: C.csvStringify(headers, rows) };
  }
  function phaseCsv() {
    const headers = ['animal_id', 'group', 'genotype', 'IS', 'IV', 'RA', 'COG', 'M10', 'L5', 'acrophase', 'onset', 'offset', 'onset_phase', 'offset_phase', 'morning_peak', 'evening_peak', 'MAI', 'EAI', 'day_night_ratio', 'cosinor_amplitude', 'cosinor_percent_rhythm'];
    const rows = state.metricsRows.map((r) => [r.id, r.group, r.genotype, r.IS, r.IV, r.RA, r.COG, r.M10, r.L5, r.acrophase, r.onset, r.offset, r.onsetPhase, r.offsetPhase, r.morningPeak, r.eveningPeak, r.MAI, r.EAI, r.dayNightRatio, r.cosinorAmplitude, r.cosinorPercentRhythm]);
    return { filename: 'phase_metrics.csv', content: C.csvStringify(headers, rows) };
  }
  function exportCsv(kind) {
    const map = { animals: metricsCsv, timeseries: timeSeriesCsv, bouts: boutsCsv, periodograms: periodogramsCsv, profiles: profilesCsv, groupstats: groupStatsCsv, phase: phaseCsv };
    const fn = map[kind];
    if (!fn) return;
    if (!state.metricsRows.length) { toast('Build a dataset first.', 'error'); return; }
    const out = fn();
    C.downloadText(out.content, out.filename, 'text/csv;charset=utf-8');
    toast(`${out.filename} exported.`, 'success');
  }
  function manifest() {
    return {
      app: 'Chronobiology Workbench', version: C.VERSION,
      generated: new Date().toISOString(),
      files: state.files.map((f) => ({ name: f.name, size: f.size })),
      dataset: state.parsedWide ? { name: state.parsedWide.name, format: state.parsedWide.format, binMinutes: state.parsedWide.binMinutes } : null,
      metadata: state.metadata ? {
        file: state.metadataFile,
        rows: state.metadata.rows.length,
        mapping: state.metaMapping,
        matched: state.metadataStats ? state.metadataStats.matched : null,
        total: state.metadataStats ? state.metadataStats.total : null
      } : null,
      animals: state.animals.length,
      groups: C.unique(state.animals.map((a) => a.group)),
      genotypes: C.unique(state.animals.map((a) => a.genotype).filter(Boolean)),
      settings: state.settings,
      references: [
        'Sokolove & Bushell 1978', 'Lomb 1976', 'Scargle 1982', 'Levine et al. 2002',
        'Hendricks et al. 2000', 'Shaw et al. 2000', 'Harrisingh et al. 2007',
        'Wiggin et al. 2020', 'van Someren et al. 1999', 'Geissmann et al. 2019', 'Cichewicz & Hirsh 2018'
      ]
    };
  }
  function updateManifest() {
    const m = manifest();
    const el = $('manifest-pre');
    if (el) el.textContent = JSON.stringify(m, null, 2);
  }
  function exportWorkbook() {
    if (!state.metricsRows.length) throw new Error('Build a dataset first.');
    if (typeof XLSX === 'undefined') throw new Error('Excel export is unavailable; use the CSV tables.');
    const wb = XLSX.utils.book_new();
    const tables = [
      ['animals_summary', metricsCsv()],
      ['bouts', boutsCsv()],
      ['periodograms', periodogramsCsv()],
      ['profiles', profilesCsv()],
      ['phase_metrics', phaseCsv()]
    ];
    for (const [name, table] of tables) {
      const rows = C.csvParse(table.content).rows;
      const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => {
        const n = Number(v);
        return v !== '' && Number.isFinite(n) ? n : v;
      })));
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    }
    XLSX.writeFile(wb, 'chronobiology_workbench.xlsx');
    toast('Excel workbook downloaded.', 'success');
  }

  async function exportZip() {
    if (!state.metricsRows.length) throw new Error('Build a dataset first.');
    const zip = new JSZip();
    const files = [metricsCsv(), timeSeriesCsv(), boutsCsv(), periodogramsCsv(), profilesCsv(), groupStatsCsv(), phaseCsv()];
    files.forEach((f) => zip.file(f.filename, f.content));
    zip.file('manifest.json', JSON.stringify(manifest(), null, 2));
    // figures
    const figMap = {
      'figures/profile.png': 'profile-main',
      'figures/boxplot.png': 'stat-box',
      'figures/periodogram.png': 'circ-periodogram',
      'figures/sleep_profile.png': 'sleep-profile-chart',
      'figures/phase_circular.png': 'phase-circular'
    };
    for (const [name, id] of Object.entries(figMap)) {
      const el = $(id);
      if (!hasPlot(el)) continue;
      try {
        const url = await CH.figureToDataURL(el, 'png', 2);
        zip.file(name, url.split(',')[1], { base64: true });
      } catch (e) { console.warn('Figure export skipped:', id, e); }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    C.downloadBlob(blob, 'chronobiology_workbench_export.zip');
    toast('Export package downloaded.', 'success');
  }
  async function generateReport() {
    if (!state.metricsRows.length) throw new Error('Build a dataset first.');
    toast('Building report…', 'info');
    const figures = {};
    for (const [key, id] of Object.entries({ profile: 'profile-main', box: 'stat-box', periodogram: 'circ-periodogram', sleep: 'sleep-profile-chart', phase: 'phase-circular' })) {
      const el = $(id);
      if (hasPlot(el)) {
        try { figures[key] = await CH.figureToDataURL(el, 'png', 2); } catch (e) { /* skip */ }
      }
    }
    const gs = state.metricsRows;
    const groups = C.unique(gs.map((r) => r.group));
    const summaryRows = groups.map((g) => {
      const rs = gs.filter((r) => r.group === g);
      return `<tr><td>${esc(g)}</td><td>${rs.length}</td><td>${fmt(meanOf(rs, 'meanSleepPerDay'), 0)}</td><td>${fmt(meanOf(rs, 'meanBoutCountPerDay'), 1)}</td><td>${fmt(meanOf(rs, 'tau'), 2)}</td><td>${pct(rs.length ? 100 * rs.filter((r) => r.rhythmic).length / rs.length : NaN)}</td><td>${fmt(meanOf(rs, 'MAI'), 2)}</td><td>${fmt(meanOf(rs, 'EAI'), 2)}</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Chronobiology Workbench report</title>
      <style>
      body{font-family:Inter,Arial,sans-serif;max-width:1000px;margin:40px auto;padding:0 24px;color:#2b3440;line-height:1.55}
      h1{font-family:Georgia,serif;font-weight:500;font-size:34px;margin-bottom:4px}h2{font-family:Georgia,serif;font-weight:500;margin-top:36px;border-bottom:1px solid #ddd;padding-bottom:6px}
      .meta{color:#68737d;font-size:13px;margin-bottom:24px}img{max-width:100%;border:1px solid #e2ded5;margin:10px 0}
      table{border-collapse:collapse;width:100%;font-size:12px;margin:10px 0}th,td{border-bottom:1px solid #e2ded5;padding:6px 8px;text-align:left}th{background:#f4f1ea;font-family:DM Mono,monospace;font-size:10px;text-transform:uppercase}
      pre{background:#f4f1ea;padding:14px;font-size:10px;overflow:auto}footer{margin-top:40px;color:#68737d;font-size:11px}
      </style></head><body>
      <h1>Chronobiology Workbench report</h1>
      <p class="meta">Generated ${new Date().toLocaleString()} · ${state.animals.length} animals · ${groups.length} groups · ${state.settings.binMin}-min bins</p>
      <h2>Group summary</h2>
      <table><thead><tr><th>Group</th><th>n</th><th>Sleep/day (min)</th><th>Bouts/day</th><th>τ (h)</th><th>% rhythmic</th><th>MAI</th><th>EAI</th></tr></thead><tbody>${summaryRows}</tbody></table>
      ${figures.profile ? `<h2>24-hour activity profile</h2><img src="${figures.profile}" alt="Activity profile">` : ''}
      ${figures.sleep ? `<h2>Sleep profile</h2><img src="${figures.sleep}" alt="Sleep profile">` : ''}
      ${figures.periodogram ? `<h2>Periodogram</h2><img src="${figures.periodogram}" alt="Periodogram">` : ''}
      ${figures.box ? `<h2>Group comparison</h2><img src="${figures.box}" alt="Box plot">` : ''}
      ${figures.phase ? `<h2>Circular phase profile</h2><img src="${figures.phase}" alt="Circular profile">` : ''}
      <h2>Methods and settings</h2><pre>${esc(JSON.stringify(manifest().settings, null, 2))}</pre>
      <footer>Chronobiology Workbench v${C.VERSION} · client-side analysis. Verify methods against the original references before publication.</footer>
      </body></html>`;
    C.downloadText(html, 'chronobiology_report.html', 'text/html;charset=utf-8');
    toast('HTML report downloaded. Open it and print to PDF if needed.', 'success');
  }

  /* ============================ export figure ============================ */
  function hasPlot(el) { return !!el && (el.classList.contains('js-plotly-plot') || !!el.querySelector('.js-plotly-plot')); }
  async function exportSelectedFigure() {
    const id = $('export-figure-select').value;
    const format = $('export-format').value;
    const scale = +$('export-scale').value || 3;
    const el = $(id);
    if (!el) throw new Error('Figure not found.');
    if (!hasPlot(el)) throw new Error('Render that figure first.');
    await CH.exportFigure(el, `${id}.${format}`, format, scale);
    toast('Figure exported.', 'success');
  }
  async function exportNamedFigure(id) {
    const el = $(id);
    if (!hasPlot(el)) { toast('Render the figure first.', 'error'); return; }
    await CH.exportFigure(el, `${id}.png`, 'png', 3);
    toast('Figure exported.', 'success');
  }

  /* ============================ settings events ============================ */
  function setupSettings() {
    $('btn-apply-settings').addEventListener('click', guard(async () => {
      readSettingsUI();
      if (!state.parsedWide) { toast('Settings saved. Load a dataset to apply them.', 'info'); return; }
      const reg = I.regularise(state.parsedWide, { binMin: state.settings.binMin });
      if (Math.abs(reg.binMinutes - state.settings.binMin) > 1e-9) {
        state.settings.binMin = reg.binMinutes;
        syncSettingsUI();
        toast(`Source resolution is ${reg.binMinutes} min; the analysis bin was adjusted.`, 'info');
      }
      I.addCircadianTime(reg, state.settings);
      state.dataset = reg;
      if (state.animals.length) {
        state.animals = I.assembleAnimals(reg, state.configs, state.settings);
        state.phaseMap = I.dayPhaseMap(state.animals);
        await runAll();
      } else {
        renderAnimalTable();
      }
      toast('Settings applied.', 'success');
    }));
    $('btn-save-settings').addEventListener('click', () => { readSettingsUI(); toast('Settings saved in this browser.', 'success'); });
    $('btn-reset-settings').addEventListener('click', guard(async () => {
      state.settings = defaultSettings();
      syncSettingsUI();
      toast('Defaults restored. Press “Apply settings” to recompute.', 'info');
    }));
  }

  /* ============================ chart events ============================ */
  function setupCharts() {
    $('btn-run-all').addEventListener('click', guard(async () => { if (!state.animals.length) throw new Error('Build a dataset first.'); await runAll(); toast('All analyses complete.', 'success'); }));
    $('btn-render-actograms').addEventListener('click', guard(renderActograms));
    $('act-mode').addEventListener('change', guard(renderActograms));
    $('act-group-filter').addEventListener('change', guard(renderActograms));
    $('act-animal-select').addEventListener('change', guard(() => {
      const animals = state.animals.filter((a) => $('act-group-filter').value === '__all' || a.group === $('act-group-filter').value);
      state.actogramPage = Math.max(0, animals.findIndex((a) => a.id === $('act-animal-select').value));
      renderActograms();
    }));
    $('act-prev').addEventListener('click', () => {
      const animals = state.animals.filter((a) => $('act-group-filter').value === '__all' || a.group === $('act-group-filter').value);
      state.actogramPage = (state.actogramPage - 1 + animals.length) % Math.max(1, animals.length);
      renderActograms();
    });
    $('act-next').addEventListener('click', () => {
      const animals = state.animals.filter((a) => $('act-group-filter').value === '__all' || a.group === $('act-group-filter').value);
      state.actogramPage = (state.actogramPage + 1) % Math.max(1, animals.length);
      renderActograms();
    });
    $('btn-export-actogram').addEventListener('click', guard(() => exportNamedFigure('actogram-grid')));
    $('btn-render-profiles').addEventListener('click', guard(renderProfiles));
    $('prof-variable').addEventListener('change', guard(() => { state.dirty.profiles = true; renderProfiles(); }));
    $('btn-render-sleep').addEventListener('click', guard(renderSleep));
    $('btn-run-circadian').addEventListener('click', guard(recomputeCircadian));
    $('btn-render-periodogram').addEventListener('click', guard(async () => {
      const chosen = $('circ-primary').value;
      if (chosen !== state.settings.primaryMethod) {
        state.settings.primaryMethod = chosen;
        saveSettings();
        await recomputeCircadian();
      } else renderCircadian();
    }));
    $('circ-primary').addEventListener('change', guard(async () => {
      state.settings.primaryMethod = $('circ-primary').value;
      $('set-primary').value = state.settings.primaryMethod;
      saveSettings();
      updateSettingsSummary();
      if (state.animals.length) await recomputeCircadian();
    }));
    $('circ-method').addEventListener('change', guard(renderCircadian));
    $('btn-render-phase').addEventListener('click', guard(renderPhase));
    $('btn-run-stats').addEventListener('click', guard(() => runStats(true)));
    $('btn-profile-test').addEventListener('click', guard(runProfileTest));
    $('btn-run-validation').addEventListener('click', guard(runValidation));
    $('btn-report').addEventListener('click', guard(generateReport));
    $('btn-print').addEventListener('click', () => window.print());
    $('btn-export-zip').addEventListener('click', guard(exportZip));
    $('btn-export-xlsx').addEventListener('click', guard(exportWorkbook));
    $('btn-export-figure').addEventListener('click', guard(exportSelectedFigure));
    $$('[data-export]').forEach((b) => b.addEventListener('click', guard(() => exportNamedFigure(b.dataset.export))));
    $$('[data-export-csv]').forEach((b) => b.addEventListener('click', () => exportCsv(b.dataset.exportCsv)));
    $('btn-export-sleep').addEventListener('click', () => exportCsv('animals'));
    $('btn-export-bouts').addEventListener('click', () => exportCsv('bouts'));
    $('btn-export-period').addEventListener('click', () => exportCsv('periodograms'));
    $('btn-export-phase').addEventListener('click', () => exportCsv('phase'));
  }

  /* ============================ init ============================ */
  function init() {
    loadSettings();
    syncSettingsUI();
    initNav();
    setupImport();
    setupSettings();
    setupCharts();
    updateManifest();
    const hash = (location.hash || '#import').slice(1);
    setSection(SECTION_NAMES[hash] ? hash : 'import', { silent: true, instant: true });
    // Ensure the file input value resets so the same file can be re-selected.
    $('file-input').addEventListener('click', (e) => { e.target.value = ''; });
    $('meta-file').addEventListener('click', (e) => { e.target.value = ''; });
  }

  // Public, read-friendly API for debugging and scripted use.
  window.CSA = {
    state,
    modules: { Core: C, Stats: S, Importers: I, Sleep: SL, Circadian: CL, Phase: PL, Charts: CH, Sample: SM },
    analyse: runAll, render: { overview: renderOverview, actograms: renderActograms, profiles: renderProfiles, sleep: renderSleep, circadian: renderCircadian, phase: renderPhase, stats: runStats },
    exportCsv, exportWorkbook, exportZip, generateReport, runValidation, setSection
  };

  document.addEventListener('DOMContentLoaded', init);
})();
