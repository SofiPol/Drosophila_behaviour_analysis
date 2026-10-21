/* ============================================================================
 * charts.js — Plotly figure builders with the editorial paper theme
 * Exposed as window.Charts
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;
  const I = global.Importers;

  const LIGHT_THEME = {
    paper: '#FFFFFF',
    ink: '#111111',
    muted: '#666666',
    grid: 'rgba(17,17,17,0.08)',
    axis: 'rgba(17,17,17,0.32)',
    bar: '#111111',
    sleep: '#00B8E6',
    wake: '#FFC400',
    dark: 'rgba(17,17,17,0.07)',
    missing: '#D9D9D9',
    accent: '#C1121F',
    green: '#00B86B',
    blue: '#0066FF',
    orange: '#FF8A00',
    vermillion: '#E6194B',
    purple: '#B23AFF',
    sky: '#00B8E6'
  };
  const DARK_THEME = Object.assign({}, LIGHT_THEME, {
    paper: '#0D0D0D',
    ink: '#F5F5F5',
    muted: '#A8A8A8',
    grid: 'rgba(255,255,255,0.12)',
    axis: 'rgba(255,255,255,0.38)',
    bar: '#F5F5F5',
    dark: 'rgba(255,255,255,0.08)',
    missing: '#555555',
    accent: '#FF4D6D'
  });
  const THEME = Object.assign({}, LIGHT_THEME);
  function setTheme(mode) {
    Object.assign(THEME, mode === 'dark' ? DARK_THEME : LIGHT_THEME);
    return THEME;
  }
  const MONO = 'Bricolage Grotesque, Helvetica Neue, Arial, sans-serif';
  const SERIF = 'Bricolage Grotesque, Helvetica Neue, Arial, sans-serif';
  const SANS = 'Source Serif 4, Georgia, serif';
  const CONFIG = { displayModeBar: true, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'], displaylogo: false };

  function baseLayout(title, opts = {}) {
    const layout = {
      title: title ? {
        text: title,
        font: { family: SERIF, size: 20, color: THEME.ink },
        x: 0.02, xanchor: 'left', y: 0.97, yanchor: 'top'
      } : undefined,
      paper_bgcolor: THEME.paper,
      plot_bgcolor: THEME.paper,
      font: { family: SANS, size: 12, color: THEME.ink },
      height: opts.height || 500,
      margin: { l: 68, r: 28, t: title ? 58 : 26, b: 58 },
      xaxis: {
        gridcolor: THEME.grid, zerolinecolor: THEME.axis, linecolor: THEME.axis,
        tickfont: { family: MONO, size: 11, color: THEME.muted },
        title: { font: { family: MONO, size: 11, color: THEME.muted } }
      },
      yaxis: {
        gridcolor: THEME.grid, zerolinecolor: THEME.axis, linecolor: THEME.axis,
        tickfont: { family: MONO, size: 11, color: THEME.muted },
        title: { font: { family: MONO, size: 11, color: THEME.muted } }
      },
      legend: { orientation: 'h', y: -0.18, x: 0, font: { family: MONO, size: 10, color: THEME.ink }, bgcolor: 'rgba(0,0,0,0)' },
      hoverlabel: { bgcolor: '#111111', bordercolor: '#111111', font: { family: SANS, color: '#FFFFFF' } },
      showlegend: opts.showlegend !== false
    };
    return layout;
  }

  function plot(el, data, layout, config) {
    if (!el) return;
    layout.autosize = true;
    const done = el._fullLayout
      ? Plotly.react(el, data, layout, config || CONFIG)
      : Plotly.newPlot(el, data, layout, config || CONFIG);
    // Plotly defaults to a 700 px canvas when a figure is first created. Resize
    // to the card after the DOM has laid it out so axes and legends never clip.
    Promise.resolve(done).then(() => {
      if (el.clientWidth > 0 && typeof Plotly.Plots.resize === 'function') {
        try { Plotly.Plots.resize(el); } catch (e) { /* noop */ }
      }
    }).catch(() => {});
  }

  function clear(el, message) {
    if (!el) return;
    if (message) el.innerHTML = `<div class="empty-state">${message}</div>`;
    else el.innerHTML = '';
  }

  /* ============================ shading helpers ============================ */
  function darkIntervalShapes(fractions, nSlots, resMin, opts = {}) {
    if (!fractions) return [];
    const shapes = [];
    const stepH = resMin / 60;
    const alpha = opts.alpha ?? 0.13;
    let start = null;
    const push = (a, b) => {
      if (b <= a) return;
      shapes.push({
        type: 'rect', xref: 'x', yref: opts.yref || 'paper',
        x0: a, x1: b, y0: opts.y0 ?? 0, y1: opts.y1 ?? 1,
        fillcolor: THEME.dark, opacity: opts.opacity ?? 1, line: { width: 0 }, layer: 'below'
      });
      if (opts.double) {
        shapes.push({
          type: 'rect', xref: 'x', yref: opts.yref || 'paper',
          x0: a + 24, x1: b + 24, y0: opts.y0 ?? 0, y1: opts.y1 ?? 1,
          fillcolor: THEME.dark, opacity: opts.opacity ?? 1, line: { width: 0 }, layer: 'below'
        });
      }
    };
    for (let s = 0; s <= nSlots; s++) {
      const isDark = s < nSlots ? fractions[s] > 0.5 : false;
      if (isDark && start === null) start = s * stepH;
      if (!isDark && start !== null) { push(start, s * stepH); start = null; }
    }
    if (start !== null) push(start, nSlots * stepH);
    return shapes;
  }

  function darkFractions(animals, settings, phaseMap, nSlots, resMin, base) {
    const sum = new Array(nSlots).fill(0);
    const cnt = new Array(nSlots).fill(0);
    for (const a of animals) {
      const mask = I.analysisMask(a, settings, phaseMap);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const t = base === 'CT' ? a.ct[i] : base === 'clock' ? a.clock[i] : a.zt[i];
        const s = Math.min(nSlots - 1, Math.floor((((t % 24) + 24) % 24) * 60 / resMin));
        if (a.light[i] === 0 || a.light[i] === 1) {
          sum[s] += a.light[i] === 0 ? 1 : 0;
          cnt[s]++;
        }
      }
    }
    return sum.map((v, i) => cnt[i] ? v / cnt[i] : 0);
  }

  /* ============================ activity profile ============================ */
  function profileChart(el, profileData, opts = {}) {
    const { times, groups, label, base } = profileData;
    const style = opts.style || 'bars';
    const double = !!opts.double;
    const traces = [];
    const nSlots = times.length;
    const resMin = nSlots ? (1440 / nSlots) : 30;
    const isSleep = /sleep/i.test(label || '');
    const yTitle = opts.yTitle || label || 'Activity';
    const xTitle = opts.xTitle || (base === 'CT' ? 'Circadian time (h)' : base === 'clock' ? 'Clock time (h)' : 'Zeitgeber time (h)');
    const x = double ? times.concat(times.map((t) => t + 24)) : times;
    const extend = (arr) => double ? arr.concat(arr) : arr;

    if (style === 'bars' && groups.length === 1) {
      const g = groups[0];
      traces.push({
        type: 'bar', x, y: extend(g.mean), name: g.group,
        marker: { color: isSleep ? THEME.sleep : THEME.bar, line: { width: 0 } },
        error_y: {
          type: 'data', array: extend(g.sem), visible: true,
          color: THEME.muted, thickness: 1, width: 2
        },
        hovertemplate: `${g.group}<br>${xTitle}: %{x:.1f} h<br>${yTitle}: %{y:.2f}<extra></extra>`
      });
    } else {
      groups.forEach((g, gi) => {
        const col = C.groupColor(gi);
        const mean = extend(g.mean);
        const sem = extend(g.sem);
        const upper = mean.map((v, i) => C.isNum(v) && C.isNum(sem[i]) ? v + sem[i] : null);
        const lower = mean.map((v, i) => C.isNum(v) && C.isNum(sem[i]) ? v - sem[i] : null);
        if (style === 'bars') {
          traces.push({
            type: 'bar', x, y: mean, name: g.group,
            marker: { color: col, line: { width: 0 } },
            error_y: { type: 'data', array: sem, visible: true, color: THEME.muted, thickness: 1, width: 2 },
            hovertemplate: `${g.group}<br>${xTitle}: %{x:.1f} h<br>${yTitle}: %{y:.2f}<extra></extra>`
          });
        } else {
          traces.push({
            x, y: mean, name: g.group, mode: 'lines', line: { color: col, width: 2.2 },
            hovertemplate: `${g.group}<br>${xTitle}: %{x:.1f} h<br>${yTitle}: %{y:.2f}<extra></extra>`
          });
          traces.push({ x, y: upper, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
          traces.push({ x, y: lower, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.13, hoverinfo: 'skip', showlegend: false });
        }
      });
    }

    const layout = baseLayout(opts.title || '', { showlegend: groups.length > 1 });
    layout.xaxis.title.text = xTitle;
    layout.yaxis.title.text = yTitle;
    layout.xaxis.range = double ? [0, 48] : [0, 24];
    layout.xaxis.tickvals = double ? [0, 6, 12, 18, 24, 30, 36, 42, 48] : [0, 4, 8, 12, 16, 20, 24];
    layout.bargap = 0.08;
    layout.bargroupgap = 0.02;
    if (isSleep && !opts.yTitle) layout.yaxis.range = [0, Math.max(1, ...groups.flatMap((g) => g.mean.filter(C.isNum))) * 1.15];
    if (opts.shapes) layout.shapes = opts.shapes;
    if (opts.legend) {
      layout.legend = Object.assign({}, layout.legend, opts.legend);
      layout.margin.t = Math.max(layout.margin.t, 56);
    }
    plot(el, traces, layout);
  }

  /* ============================ sleep architecture ============================ */
  function sleepArchitectureChart(el, profileData, architecture, opts = {}) {
    const traces = [];
    const { times, groups, base } = profileData;
    const xTitle = base === 'CT' ? 'Circadian time (h)' : base === 'clock' ? 'Clock time (h)' : 'Zeitgeber time (h)';
    groups.forEach((g, gi) => {
      traces.push({
        x: times, y: g.mean, name: g.group + ' sleep', mode: 'lines',
        line: { color: C.groupColor(gi), width: 2.4, shape: 'spline', smoothing: 0.4 },
        hovertemplate: `${g.group}<br>${xTitle}: %{x:.1f} h<br>Sleep: %{y:.2f}<extra></extra>`
      });
    });
    if (architecture) {
      traces.push({
        x: architecture.hours, y: architecture.boutCountPerDay, name: 'Bouts initiated', type: 'bar',
        yaxis: 'y2', marker: { color: THEME.wake, opacity: 0.55 },
        hovertemplate: `ZT %{x}:00<br>Bouts/day: %{y:.2f}<extra></extra>`
      });
    }
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.xaxis.title.text = xTitle;
    layout.xaxis.range = [0, 24];
    layout.yaxis.title.text = 'Sleep (min/bin)';
    if (architecture) {
      layout.yaxis2 = {
        title: { text: 'Bouts initiated / day', font: { family: MONO, size: 11, color: THEME.muted } },
        overlaying: 'y', side: 'right', showgrid: false,
        tickfont: { family: MONO, size: 10, color: THEME.muted }
      };
    }
    if (opts.shapes) layout.shapes = opts.shapes;
    plot(el, traces, layout);
  }

  /* ============================ P(wake) / P(doze) ============================ */
  function transitionChart(el, wakeData, dozeData, opts = {}) {
    const traces = [];
    [wakeData, dozeData].forEach((d, gi) => {
      if (!d) return;
      d.groups.forEach((g, i) => {
        const col = C.groupColor(i);
        traces.push({
          x: d.times, y: g.mean, name: `${g.group} · ${gi === 0 ? 'P(wake)' : 'P(doze)'}`,
          mode: 'lines', line: { color: col, width: 2, dash: gi === 0 ? 'solid' : 'dot' },
          hovertemplate: `${g.group}<br>ZT %{x:.1f}<br>P: %{y:.3f}<extra></extra>`
        });
        const upper = g.mean.map((v, i) => C.isNum(v) && C.isNum(g.sem[i]) ? v + g.sem[i] : null);
        const lower = g.mean.map((v, i) => C.isNum(v) && C.isNum(g.sem[i]) ? v - g.sem[i] : null);
        traces.push({ x: d.times, y: upper, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
        traces.push({ x: d.times, y: lower, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.1, hoverinfo: 'skip', showlegend: false });
      });
    });
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.xaxis.title.text = 'Zeitgeber time (h)';
    layout.xaxis.range = [0, 24];
    layout.yaxis.title.text = 'Transition probability';
    layout.yaxis.range = [0, 1];
    if (opts.shapes) layout.shapes = opts.shapes;
    plot(el, traces, layout);
  }

  /* ============================ sleep categories ============================ */
  function sleepCategoryChart(el, categoriesByHour, opts = {}) {
    const hours = categoriesByHour.hours;
    const traces = [
      { x: hours, y: categoriesByHour.short, name: 'Short (≤30 min)', type: 'bar', marker: { color: THEME.orange } },
      { x: hours, y: categoriesByHour.intermediate, name: 'Intermediate (30–60)', type: 'bar', marker: { color: THEME.green } },
      { x: hours, y: categoriesByHour.long, name: 'Long (>60)', type: 'bar', marker: { color: THEME.blue } }
    ];
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.barmode = 'stack';
    layout.xaxis.title.text = 'Zeitgeber time (h)';
    layout.xaxis.range = [0, 24];
    layout.yaxis.title.text = 'Sleep (min)';
    plot(el, traces, layout);
  }

  /* ============================ circular profile ============================ */
  function circularChart(el, profileData, opts = {}) {
    const traces = profileData.groups.map((g, gi) => {
      const theta = profileData.times.map((t) => t * 15);
      const col = C.groupColor(gi);
      return {
        type: 'scatterpolar', mode: 'lines', name: g.group,
        r: g.mean.concat([g.mean[0]]),
        theta: theta.concat([theta[0] + 360]),
        line: { color: col, width: 3 },
        fill: 'toself', fillcolor: col, opacity: 0.24,
        hovertemplate: `${g.group}<br>%{theta:.0f}°<br>%{r:.2f}<extra></extra>`
      };
    });
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.polar = {
      bgcolor: THEME.paper,
      radialaxis: { gridcolor: THEME.grid, linecolor: THEME.axis, tickfont: { family: MONO, size: 9, color: THEME.muted } },
      angularaxis: {
        rotation: 90, direction: 'clockwise',
        tickvals: [0, 45, 90, 135, 180, 225, 270, 315],
        ticktext: ['00', '03', '06', '09', '12', '15', '18', '21'],
        gridcolor: THEME.grid, linecolor: THEME.axis,
        tickfont: { family: MONO, size: 10, color: THEME.muted }
      }
    };
    layout.showlegend = true;
    plot(el, traces, layout);
  }

  /* ============================ actogram ============================ */
  function actogramMatrix(animal, opts = {}) {
    const binMin = opts.binMin || 30;
    const todBins = Math.round(1440 / binMin);
    const dayMin = opts.startDay ?? C.min(animal.day.filter((v) => C.isNum(v)));
    const dayMax = opts.endDay ?? C.max(animal.day.filter((v) => C.isNum(v)));
    const days = [];
    for (let d = dayMin; d <= dayMax; d++) days.push(d);
    const z = [];
    const light = [];
    const sleep = null;
    for (const d of days) {
      const row = new Array(todBins).fill(0);
      const lrow = new Array(todBins).fill(null);
      for (let i = 0; i < animal.activity.length; i++) {
        if (animal.day[i] !== d) continue;
        const slot = Math.min(todBins - 1, Math.floor((((animal.zt[i] % 24) + 24) % 24) * 60 / binMin));
        row[slot] += C.isNum(animal.activity[i]) ? animal.activity[i] : 0;
        if (animal.light[i] === 0 || animal.light[i] === 1) lrow[slot] = animal.light[i];
      }
      z.push(row);
      light.push(lrow);
    }
    return { days, todBins, binHours: binMin / 60, z, light, dayMin, dayMax };
  }

  function actogramScaling(animals, opts = {}) {
    if (opts.scaleMax && C.isNum(opts.scaleMax)) return opts.scaleMax;
    const vals = [];
    for (const a of animals) {
      const m = actogramMatrix(a, opts);
      for (const row of m.z) for (const v of row) if (v > 0) vals.push(v);
    }
    if (!vals.length) return 1;
    vals.sort((a, b) => a - b);
    if (opts.scaleMode === 'percentile') {
      return vals[Math.min(vals.length - 1, Math.floor((opts.percentile ?? 0.99) * vals.length))] || 1;
    }
    return vals[vals.length - 1] || 1;
  }

  function barActogramTrace(matrix, cmax, double, color, opts = {}) {
    const { todBins, binHours, z } = matrix;
    const xs = [], ys = [];
    const nDays = z.length;
    const nMulti = double ? 2 : 1;
    for (let d = 0; d < nDays; d++) {
      for (let m = 0; m < nMulti; m++) {
        const target = d + m;
        if (target >= nDays) continue;
        const offset = m * 24;
        for (let s = 0; s < todBins; s++) {
          const v = z[target][s];
          if (!(v > 0)) continue;
          const x = offset + s * binHours;
          const h = Math.min(0.9, (v / cmax) * 0.9);
          xs.push(x, x, null);
          ys.push(d, d - h, null);
        }
      }
    }
    return {
      type: 'scatter', mode: 'lines', x: xs, y: ys,
      line: { color: color || THEME.bar, width: opts.barWidth || 2.2 },
      hoverinfo: 'skip', showlegend: false
    };
  }

  function actogramShapes(matrix, double, opts = {}) {
    const shapes = [];
    const { days, todBins, binHours, light } = matrix;
    const nMulti = double ? 2 : 1;
    for (let d = 0; d < days.length; d++) {
      shapes.push({
        type: 'line', xref: 'x', yref: 'y',
        x0: 0, x1: nMulti * 24, y0: d, y1: d,
        line: { color: 'rgba(91,107,122,0.25)', width: 0.7 }, layer: 'below'
      });
      for (let m = 0; m < nMulti; m++) {
        const target = d + m;
        if (target >= light.length) continue;
        let start = null;
        for (let s = 0; s <= todBins; s++) {
          const dark = s < todBins ? light[target][s] === 0 : false;
          if (dark && start === null) start = s * binHours + m * 24;
          if (!dark && start !== null) {
            shapes.push({
              type: 'rect', xref: 'x', yref: 'y',
              x0: start, x1: s * binHours + m * 24, y0: d + 0.06, y1: d + 0.94,
              fillcolor: THEME.dark, opacity: 0.9, line: { width: 0 }, layer: 'below'
            });
            start = null;
          }
        }
      }
    }
    if (opts.periodTau && C.isNum(opts.periodTau)) {
      const slope = (opts.periodTau - 24) / 24; // day rows per hour
      for (let d = 0; d < days.length; d++) {
        // small period reference line across each row
        const x0 = 0;
        const x1 = 24;
        const y0 = d + slope * 0;
        const y1 = d + slope * 24;
        shapes.push({
          type: 'line', xref: 'x', yref: 'y', x0, x1, y0, y1,
          line: { color: 'rgba(164,90,82,0.65)', width: 1, dash: 'dot' }, layer: 'above'
        });
      }
    }
    if (opts.ddDay !== null && opts.ddDay !== undefined) {
      const row = days.indexOf(opts.ddDay);
      if (row >= 0) {
        shapes.push({
          type: 'line', xref: 'x', yref: 'y', x0: 0, x1: nMulti * 24, y0: row + 0.5, y1: row + 0.5,
          line: { color: 'rgba(164,90,82,0.8)', width: 1.4, dash: 'dash' }, layer: 'above'
        });
      }
    }
    return shapes;
  }

  function actogramLayout(title, matrix, double, opts = {}) {
    const layout = baseLayout(title, { showlegend: false });
    layout.xaxis.title.text = double ? 'Time (h, double-plotted)' : 'Time (h)';
    layout.xaxis.range = [0, double ? 48 : 24];
    layout.xaxis.tickvals = double ? [0, 12, 24, 36, 48] : [0, 6, 12, 18, 24];
    layout.yaxis.title.text = 'Day';
    layout.yaxis.autorange = 'reversed';
    layout.yaxis.range = [matrix.days.length - 0.5, -0.5];
    layout.yaxis.dtick = Math.max(1, Math.ceil(matrix.days.length / 14));
    layout.yaxis.tickvals = matrix.days.length <= 20
      ? matrix.days
      : matrix.days.filter((_, i) => i % Math.max(1, Math.ceil(matrix.days.length / 14)) === 0);
    layout.margin = { l: 62, r: 18, t: title ? 50 : 20, b: 46 };
    layout.hovermode = 'closest';
    layout.height = Math.max(300, matrix.days.length * 19 + 150);
    return layout;
  }

  function actogram(el, animal, opts = {}) {
    const binMin = opts.binMin || 30;
    const double = opts.double !== false;
    const matrix = actogramMatrix(animal, { ...opts, binMin });
    let cmax = opts.cmax;
    if (!C.isNum(cmax)) cmax = actogramScaling([animal], { ...opts, binMin, scaleMode: opts.scaleMode || 'percentile' });
    const trace = barActogramTrace(matrix, cmax, double, opts.color || THEME.bar, opts);
    const layout = actogramLayout(opts.title || `${animal.id}${animal.group ? ' · ' + animal.group : ''}`, matrix, double, opts);
    layout.shapes = actogramShapes(matrix, double, opts);
    const traces = [trace];
    if (opts.markers && opts.markers.length) {
      for (const kind of ['onset', 'offset']) {
        const ms = opts.markers.filter((m) => m.type === kind);
        if (!ms.length) continue;
        const xs = [], ys = [];
        for (const m of ms) {
          const row = matrix.days.indexOf(m.day);
          if (row < 0) continue;
          xs.push(m.zt); ys.push(row);
          if (double && row > 0) { xs.push(m.zt + 24); ys.push(row - 1); }
        }
        if (xs.length) {
          traces.push({
            type: 'scatter', mode: 'markers', x: xs, y: ys,
            marker: { symbol: kind === 'onset' ? 'circle-open' : 'x-thin', size: 5, color: kind === 'onset' ? THEME.accent : THEME.bar, line: { width: 1 } },
            name: kind, showlegend: false, hoverinfo: 'skip'
          });
        }
      }
    }
    plot(el, traces, layout, { displayModeBar: false, responsive: true });
  }

  function averageActogram(el, animals, opts = {}) {
    const binMin = opts.binMin || 30;
    const double = opts.double !== false;
    const matrices = animals.map((a) => actogramMatrix(a, { ...opts, binMin }));
    const dayMin = Math.min(...matrices.map((m) => m.dayMin));
    const dayMax = Math.max(...matrices.map((m) => m.dayMax));
    const days = [];
    for (let d = dayMin; d <= dayMax; d++) days.push(d);
    const todBins = Math.round(1440 / binMin);
    const z = days.map(() => new Array(todBins).fill(0));
    const n = days.map(() => new Array(todBins).fill(0));
    const light = days.map(() => new Array(todBins).fill(null));
    for (const m of matrices) {
      m.days.forEach((d, di) => {
        const outIdx = days.indexOf(d);
        if (outIdx < 0) return;
        for (let s = 0; s < todBins; s++) {
          if (C.isNum(m.z[di][s])) {
            z[outIdx][s] += m.z[di][s];
            n[outIdx][s]++;
          }
          if (m.light[di][s] !== null) light[outIdx][s] = m.light[di][s];
        }
      });
    }
    const meanZ = z.map((row, di) => row.map((v, s) => n[di][s] ? v / n[di][s] : 0));
    const matrix = { days, todBins, binHours: binMin / 60, z: meanZ, light, dayMin, dayMax };
    const vals = meanZ.flat().filter((v) => v > 0).sort((a, b) => a - b);
    let cmax = opts.cmax;
    if (!C.isNum(cmax)) cmax = vals.length ? vals[Math.min(vals.length - 1, Math.floor(0.99 * vals.length))] : 1;
    const trace = barActogramTrace(matrix, cmax, double, opts.color || THEME.bar, opts);
    const layout = actogramLayout(opts.title || `Average actogram (n=${animals.length})`, matrix, double, opts);
    layout.shapes = actogramShapes(matrix, double, opts);
    plot(el, [trace], layout, { displayModeBar: false, responsive: true });
  }

  /* ============================ sleep actogram ============================ */
  function sleepActogram(el, animal, settings, phaseMap, opts = {}) {
    const binMin = opts.binMin || 30;
    const double = opts.double !== false;
    const mask = I.analysisMask(animal, settings, phaseMap);
    const state = global.SleepLab.stateSeries(animal, settings);
    const sd = global.SleepLab.scoreSleep(state, mask, animal.binMinutes, settings.minSleepMinutes ?? 5);
    // Build sleep state matrix directly.
    const todBins = Math.round(1440 / binMin);
    const days = [...new Set(animal.day.filter((_, i) => mask[i]))].sort((a, b) => a - b);
    const z = days.map(() => new Array(todBins).fill(0));
    const light = days.map(() => new Array(todBins).fill(null));
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const di = days.indexOf(animal.day[i]);
      if (di < 0) continue;
      const s = Math.min(todBins - 1, Math.floor((((animal.zt[i] % 24) + 24) % 24) * 60 / binMin));
      z[di][s] = Math.max(z[di][s], sd.sleep[i] ? 1 : 0);
      if (animal.light[i] === 0 || animal.light[i] === 1) light[di][s] = animal.light[i];
    }
    const matrix = { days, todBins, binHours: binMin / 60, z, light, dayMin: days[0], dayMax: days[days.length - 1] };
    const trace = barActogramTrace(matrix, 1, double, THEME.sleep, { barWidth: 2.6 });
    const layout = actogramLayout(opts.title || `Sleep actogram · ${animal.id}`, matrix, double, opts);
    layout.shapes = actogramShapes(matrix, double, opts);
    plot(el, [trace], layout, { displayModeBar: false, responsive: true });
  }

  /* ============================ raster ============================ */
  function rasterChart(el, raster, opts = {}) {
    const rows = raster.rows.slice(0, opts.maxRows || 60);
    const z = rows.map((r) => r.state);
    const y = rows.map((r) => r.id);
    const trace = {
      type: 'heatmap', z, x: raster.times, y,
      colorscale: [[0, '#FFFFFF'], [1, THEME.sleep]],
      zmin: 0, zmax: 1, showscale: false,
      hovertemplate: '%{y}<br>%{x:.2f} h<br>state %{z}<extra></extra>'
    };
    const layout = baseLayout(opts.title || '', { showlegend: false });
    layout.xaxis.title.text = 'Time (h)';
    layout.yaxis.title.text = '';
    layout.yaxis.tickfont = { family: MONO, size: 8, color: THEME.muted };
    layout.margin.l = 120;
    layout.height = Math.max(320, 14 * rows.length + 100);
    plot(el, [trace], layout);
  }

  /* ============================ periodogram ============================ */
  function periodogramSeries(results, method) {
    const key = method === 'chi-square' ? 'chiSquare' : method === 'lomb-scargle' ? 'lombScargle' : method;
    const valid = results.filter((r) => r && !r.error && r[key] && (r[key].periods || []).length);
    if (!valid.length) return null;
    const grid = valid[0][key].periods;
    const groups = C.unique(valid.map((r) => r.animal.group));
    const out = [];
    for (const g of groups) {
      const rows = valid.filter((r) => r.animal.group === g);
      const mean = new Array(grid.length).fill(NaN);
      const sem = new Array(grid.length).fill(NaN);
      const n = new Array(grid.length).fill(0);
      for (let i = 0; i < grid.length; i++) {
        const vals = [];
        for (const r of rows) {
          const s = r[key];
          if (i >= s.periods.length) continue;
          const v = method === 'chi-square' ? s.qp[i] - s.threshold[i] : s.power[i];
          if (C.isNum(v)) vals.push(v);
        }
        n[i] = vals.length;
        if (vals.length) {
          mean[i] = C.mean(vals);
          if (vals.length > 1) sem[i] = C.sem(vals);
        }
      }
      out.push({ group: g, mean, sem, n, individuals: rows.map((r) => r[key]), nAnimals: rows.length });
    }
    return { method, periods: grid, groups: out, nAnimals: valid.length };
  }

  function periodogramChart(el, results, opts = {}) {
    const method = opts.method || 'chi-square';
    if (method === 'autocorrelation') {
      autocorrelationChart(el, results, { title: opts.title || '' });
      return;
    }
    const data = periodogramSeries(results, method);
    if (!data) { clear(el, 'No periodogram results.'); return; }
    const traces = [];
    if (opts.showIndividuals !== false && data.nAnimals <= 40) {
      for (const g of data.groups) {
        g.individuals.forEach((s, i) => {
          const y = method === 'chi-square'
            ? s.qp.map((v, j) => v - s.threshold[j])
            : s.power;
          traces.push({
            x: s.periods, y, mode: 'lines', name: g.group, showlegend: false,
            line: { color: C.groupColor(data.groups.indexOf(g)), width: 0.6, opacity: 0.18 },
            hoverinfo: 'skip'
          });
        });
      }
    }
    data.groups.forEach((g, gi) => {
      const col = C.groupColor(gi);
      traces.push({
        x: data.periods, y: g.mean, name: `${g.group} (n=${g.nAnimals || g.n[0] || 0})`,
        mode: 'lines', line: { color: col, width: 2.6 },
        hovertemplate: `${g.group}<br>Period %{x:.2f} h<br>Power %{y:.2f}<extra></extra>`
      });
      const upper = g.mean.map((v, i) => C.isNum(v) && C.isNum(g.sem[i]) ? v + g.sem[i] : null);
      const lower = g.mean.map((v, i) => C.isNum(v) && C.isNum(g.sem[i]) ? v - g.sem[i] : null);
      traces.push({ x: data.periods, y: upper, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      traces.push({ x: data.periods, y: lower, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.12, hoverinfo: 'skip', showlegend: false });
    });
    const layout = baseLayout(opts.title || (method === 'chi-square' ? 'Chi-square periodogram' : method === 'lomb-scargle' ? 'Lomb–Scargle periodogram' : 'Periodogram'), { showlegend: true });
    layout.xaxis.title.text = 'Period (h)';
    layout.yaxis.title.text = method === 'chi-square' ? 'Power (Qp − threshold)' : method === 'lomb-scargle' ? 'Power (PN)' : 'Power';
    layout.xaxis.range = [opts.minPeriod ?? 16, opts.maxPeriod ?? 32];
    layout.shapes = [{
      type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: 'rgba(91,107,122,0.5)', width: 1, dash: 'dot' }
    }];
    plot(el, traces, layout);
  }

  function periodDistributionChart(el, results, opts = {}) {
    const rows = results.filter((r) => r && !r.error && C.isNum(r.tau) && r.rhythmic);
    if (!rows.length) { clear(el, 'No rhythmic animals to plot.'); return; }
    const groups = C.unique(rows.map((r) => r.animal.group));
    const data = groups.map((g, gi) => {
      const vals = rows.filter((r) => r.animal.group === g).map((r) => r.tau);
      return {
        y: vals, name: g, type: 'box', boxpoints: 'all', jitter: 0.35, pointpos: 0,
        marker: { color: C.groupColor(gi), size: 7, opacity: 0.85 },
        line: { color: C.groupColor(gi), width: 1.8 },
        fillcolor: C.groupColor(gi), opacity: 0.45, whiskerwidth: 0.25,
        hovertemplate: `${g}<br>Period %{y:.2f} h<extra></extra>`
      };
    });
    const layout = baseLayout(opts.title || 'Period distribution', { showlegend: false });
    layout.xaxis.title.text = '';
    layout.yaxis.title.text = 'Period (h)';
    layout.yaxis.range = [opts.minPeriod ?? 16, opts.maxPeriod ?? 32];
    plot(el, data, layout);
  }

  function autocorrelationChart(el, results, opts = {}) {
    const valid = results.filter((r) => r && !r.error && r.autocorrelation && r.autocorrelation.lags);
    if (!valid.length) { clear(el, 'No autocorrelation results.'); return; }
    const groups = C.unique(valid.map((r) => r.animal.group));
    const traces = [];
    groups.forEach((g, gi) => {
      const rows = valid.filter((r) => r.animal.group === g);
      const grid = rows[0].autocorrelation.lags;
      const mean = new Array(grid.length).fill(0);
      const sem = new Array(grid.length).fill(0);
      for (let i = 0; i < grid.length; i++) {
        const vals = rows.map((r) => r.autocorrelation.smoothed[i]).filter(C.isNum);
        if (vals.length) { mean[i] = C.mean(vals); if (vals.length > 1) sem[i] = C.sem(vals); }
      }
      const col = C.groupColor(gi);
      traces.push({ x: grid, y: mean, name: g, mode: 'lines', line: { color: col, width: 2.2 } });
      traces.push({ x: grid, y: mean.map((v, i) => v + sem[i]), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      traces.push({ x: grid, y: mean.map((v, i) => v - sem[i]), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.1, hoverinfo: 'skip', showlegend: false });
    });
    const layout = baseLayout(opts.title || 'Autocorrelation', { showlegend: true });
    layout.xaxis.title.text = 'Lag (h)';
    layout.yaxis.title.text = 'Autocorrelation (r)';
    layout.yaxis.range = [-0.4, 1.05];
    layout.shapes = [
      { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: THEME.axis, width: 1 } },
      { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0.3, y1: 0.3, line: { color: THEME.accent, width: 1, dash: 'dot' } }
    ];
    plot(el, traces, layout);
  }

  /* ============================ box plots ============================ */
  function boxPlot(el, rows, metric, opts = {}) {
    const groups = C.unique(rows.map((r) => r.group));
    const data = groups.map((g, gi) => {
      const vals = rows.filter((r) => r.group === g).map((r) => r[metric]).filter(C.isNum);
      return {
        y: vals, name: g, type: 'box', boxpoints: 'all', jitter: 0.35, pointpos: 0,
        marker: { color: C.groupColor(gi), size: 7, opacity: 0.8 },
        line: { color: C.groupColor(gi), width: 1.8 },
        fillcolor: C.groupColor(gi), opacity: 0.4, whiskerwidth: 0.25,
        hovertemplate: `${g}<br>${opts.label || metric}: %{y:.3f}<extra></extra>`
      };
    });
    // mean markers
    const means = groups.map((g, gi) => {
      const vals = rows.filter((r) => r.group === g).map((r) => r[metric]).filter(C.isNum);
      return { x: [g], y: [C.mean(vals)], mode: 'markers', type: 'scatter', marker: { symbol: 'diamond', size: 9, color: C.groupColor(gi), line: { color: THEME.paper, width: 1 } }, showlegend: false, hovertemplate: `${g} mean: %{y:.2f}<extra></extra>` };
    });
    const layout = baseLayout(opts.title || '', { showlegend: false });
    layout.xaxis.title.text = opts.xTitle || '';
    layout.yaxis.title.text = opts.label || metric;
    layout.boxmode = 'group';
    layout.boxgap = 0.35;
    if (C.isNum(opts.yMin) || C.isNum(opts.yMax)) layout.yaxis.range = [opts.yMin ?? null, opts.yMax ?? null];
    if (opts.annotations) layout.annotations = opts.annotations;
    plot(el, data.concat(means), layout);
  }

  function barSummaryChart(el, groupsData, opts = {}) {
    const groups = groupsData.map((g) => g.group);
    const means = groupsData.map((g) => g.mean);
    const sems = groupsData.map((g) => g.sem);
    const traces = [{
      type: 'bar', x: groups, y: means,
      marker: { color: groups.map((_, i) => C.groupColor(i)) },
      error_y: { type: 'data', array: sems, visible: true, color: THEME.muted, thickness: 1, width: 2 },
      hovertemplate: '%{x}<br>%{y:.2f}<extra></extra>'
    }];
    const layout = baseLayout(opts.title || '', { showlegend: false });
    layout.yaxis.title.text = opts.label || '';
    layout.xaxis.title.text = '';
    plot(el, traces, layout);
  }

  /* ============================ timeline ============================ */
  function timelineChart(el, series, opts = {}) {
    const traces = [];
    series.forEach((s, gi) => {
      const col = C.groupColor(gi);
      const x = s.times.map((t) => t / 24);
      traces.push({ x, y: s.mean, name: s.group, mode: 'lines', line: { color: col, width: 1.8 } });
      traces.push({ x, y: s.mean.map((v, i) => C.isNum(v) && C.isNum(s.sem[i]) ? v + s.sem[i] : null), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      traces.push({ x, y: s.mean.map((v, i) => C.isNum(v) && C.isNum(s.sem[i]) ? v - s.sem[i] : null), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.1, hoverinfo: 'skip', showlegend: false });
    });
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.xaxis.title.text = opts.xTitle || 'Days from recording start';
    layout.yaxis.title.text = opts.yTitle || 'Mean activity (counts/bin)';
    layout.xaxis.tickformat = '.0f';
    if (opts.shapes) layout.shapes = opts.shapes;
    if (opts.legend) {
      layout.legend = Object.assign({}, layout.legend, opts.legend);
      layout.margin.t = Math.max(layout.margin.t, 56);
    }
    plot(el, traces, layout);
  }

  /* ============================ histograms & comparisons ============================ */
  function histogramChart(el, values, opts = {}) {
    const vals = values.filter(C.isNum);
    if (!vals.length) { clear(el, 'No values to plot.'); return; }
    const edges = opts.edges || [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of vals) {
      let bin = edges.length - 2;
      for (let i = 0; i < edges.length - 1; i++) {
        if (v >= edges[i] && v < edges[i + 1]) { bin = i; break; }
      }
      counts[bin]++;
    }
    const labels = counts.map((_, i) => {
      const a = edges[i], b = edges[i + 1];
      return b >= 1440 ? `>${a}` : `${a}–${b}`;
    });
    const trace = {
      type: 'bar', x: labels, y: counts,
      marker: { color: opts.color || THEME.sleep, opacity: 0.85 },
      hovertemplate: '%{x} min<br>%{y} bouts<extra></extra>'
    };
    const med = C.median(vals);
    const layout = baseLayout(opts.title || '', { showlegend: false });
    layout.xaxis.title.text = 'Bout duration (min)';
    layout.yaxis.title.text = 'Number of bouts';
    layout.annotations = [{ text: `median ${med.toFixed(1)} min`, xref: 'paper', yref: 'paper', x: 0.98, y: 0.95, xanchor: 'right', showarrow: false, font: { family: MONO, size: 9, color: THEME.muted } }];
    plot(el, [trace], layout);
  }

  function multiBoxPlot(el, rows, metrics, labels, opts = {}) {
    const groups = C.unique(rows.map((r) => r.group));
    const traces = [];
    metrics.forEach((metric, mi) => {
      groups.forEach((g, gi) => {
        const vals = rows.filter((r) => r.group === g && C.isNum(r[metric])).map((r) => r[metric]);
        if (!vals.length) return;
        traces.push({
          type: 'box', y: vals, x: vals.map(() => labels[mi]), name: g,
          offsetgroup: g, alignmentgroup: labels[mi],
          boxpoints: 'all', jitter: 0.32, pointpos: 0,
          marker: { color: C.groupColor(gi), size: 6, opacity: 0.8 },
          line: { color: C.groupColor(gi), width: 1.5 },
          fillcolor: C.groupColor(gi), opacity: 0.4, whiskerwidth: 0.25,
          showlegend: mi === 0,
          hovertemplate: `${g}<br>${labels[mi]}: %{y:.3f}<extra></extra>`
        });
      });
    });
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.yaxis.title.text = opts.yTitle || '';
    layout.boxmode = 'group';
    plot(el, traces, layout);
  }

  function populationChart(el, pop, opts = {}) {
    if (!pop) { clear(el, 'No population periodogram.'); return; }
    const traces = [{
      x: pop.periods, y: pop.mean, mode: 'lines', name: `mean (n=${pop.nAnimals})`,
      line: { color: THEME.bar, width: 2.4 },
      hovertemplate: 'Period %{x:.2f} h<br>Mean power %{y:.2f}<extra></extra>'
    }];
    traces.push({ x: pop.periods, y: pop.mean.map((v, i) => v + pop.sem[i]), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
    traces.push({ x: pop.periods, y: pop.mean.map((v, i) => v - pop.sem[i]), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: THEME.bar, opacity: 0.14, hoverinfo: 'skip', showlegend: false });
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.xaxis.title.text = 'Period (h)';
    layout.yaxis.title.text = opts.yTitle || 'Mean power';
    layout.shapes = [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: THEME.axis, width: 1, dash: 'dot' } }];
    plot(el, traces, layout);
  }

  function profileComparisonChart(el, comparison, opts = {}) {
    const { times, a, b, groupA, groupB, binTests } = comparison;
    const traces = [];
    [[a, groupA, 0], [b, groupB, 1]].forEach(([s, name, gi]) => {
      const col = C.groupColor(gi);
      traces.push({ x: times, y: s.mean, mode: 'lines', name, line: { color: col, width: 2.3 },
        hovertemplate: `${name}<br>%{x:.1f} h<br>%{y:.2f}<extra></extra>` });
      traces.push({ x: times, y: s.mean.map((v, i) => C.isNum(v) && C.isNum(s.sem[i]) ? v + s.sem[i] : null), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      traces.push({ x: times, y: s.mean.map((v, i) => C.isNum(v) && C.isNum(s.sem[i]) ? v - s.sem[i] : null), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.12, hoverinfo: 'skip', showlegend: false });
    });
    if (binTests) {
      const sig = binTests.filter((b) => b.pAdj < 0.05);
      traces.push({
        x: sig.map((b) => times[b.bin]), y: sig.map(() => 0), mode: 'markers',
        marker: { symbol: 'line-ns-open', size: 12, color: THEME.accent, line: { width: 2 } },
        name: 'p(FDR) < 0.05', showlegend: true, hoverinfo: 'skip'
      });
    }
    const layout = baseLayout(opts.title || '', { showlegend: true });
    layout.xaxis.title.text = opts.xTitle || 'Zeitgeber time (h)';
    layout.xaxis.range = [0, 24];
    layout.yaxis.title.text = opts.yTitle || 'Value';
    plot(el, traces, layout);
  }

  /* ============================ export ============================ */
  async function figureToDataURL(el, format = 'png', scale = 2) {
    const plots = el.classList && el.classList.contains('js-plotly-plot')
      ? [el] : Array.from(el.querySelectorAll('.js-plotly-plot'));
    if (!plots.length) throw new Error('No figure found in this panel.');
    if (plots.length === 1) {
      return Plotly.toImage(plots[0], {
        format: format === 'svg' ? 'svg' : 'png',
        width: plots[0].clientWidth || 900,
        height: plots[0].clientHeight || 520,
        scale: format === 'svg' ? 1 : scale
      });
    }
    if (format === 'svg') throw new Error('SVG export is available for single figures; choose PNG for a grid.');
    const cols = 3;
    const rows = Math.ceil(plots.length / cols);
    const cellW = plots[0].clientWidth || 360;
    const cellH = plots[0].clientHeight || 260;
    const canvas = document.createElement('canvas');
    canvas.width = cols * cellW * scale;
    canvas.height = rows * cellH * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < plots.length; i++) {
      const imgUrl = await Plotly.toImage(plots[i], { format: 'png', width: cellW, height: cellH, scale });
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = imgUrl; });
      const col = i % cols, row = Math.floor(i / cols);
      ctx.drawImage(img, col * cellW * scale, row * cellH * scale, cellW * scale, cellH * scale);
    }
    return canvas.toDataURL('image/png');
  }

  async function exportFigure(el, filename, format = 'png', scale = 3) {
    const url = await figureToDataURL(el, format, scale);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function resizeAll(root) {
    (root || document).querySelectorAll('.js-plotly-plot').forEach((p) => {
      try { Plotly.Plots.resize(p); } catch (e) { /* noop */ }
    });
  }

  function describeGroups(groupsData) {
    return groupsData.map((g) => `${g.group} (n=${g.n})`).join(', ');
  }

  global.Charts = {
    THEME, baseLayout, plot, clear, darkFractions, darkIntervalShapes,
    profileChart, sleepArchitectureChart, transitionChart, sleepCategoryChart, circularChart,
    actogramMatrix, actogram, averageActogram, sleepActogram, actogramScaling,
    rasterChart, periodogramChart, periodDistributionChart, autocorrelationChart,
    boxPlot, barSummaryChart, timelineChart, histogramChart, multiBoxPlot,
    populationChart, profileComparisonChart,
    figureToDataURL, exportFigure, resizeAll, periodogramSeries, describeGroups, setTheme
  };
})(window);
