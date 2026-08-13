/* ============================================================================
 * charts.js — Plotly chart builders (dark scientific theme)
 * Exposed globally as window.ZCharts.
 * ==========================================================================*/
window.ZCharts = (function () {
  'use strict';

  const M = window.ZMath;
  const CM = window.ZColormaps;

  const GENOTYPE_COLORS = [
    '#4e9bff', '#ff8c42', '#37d67a', '#f45b69', '#b58cff',
    '#ffd166', '#4ecdc4', '#ff6b9d', '#8bd450', '#5c8dff',
    '#ffa07a', '#98d8c8'
  ];

  function genotypeColor(i) {
    return GENOTYPE_COLORS[i % GENOTYPE_COLORS.length];
  }

  function baseLayout(title) {
    return {
      title: { text: title || '', font: { family: 'Inter, sans-serif', size: 15, color: '#e2e8f0' } },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter, sans-serif', color: '#cbd5e1', size: 12 },
      margin: { l: 60, r: 30, t: 50, b: 50 },
      xaxis: { gridcolor: '#28354a', zerolinecolor: '#334155', linecolor: '#334155', tickfont: { color: '#94a3b8' } },
      yaxis: { gridcolor: '#28354a', zerolinecolor: '#334155', linecolor: '#334155', tickfont: { color: '#94a3b8' } },
      legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#cbd5e1' } },
      hovermode: 'closest'
    };
  }

  const plotlyConfig = { displayModeBar: true, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  function newPlot(el, data, layout, config) {
    return Plotly.newPlot(el, data, layout, config || plotlyConfig);
  }

  /* ---------------- Actogram matrix ---------------- */
  // robust color-scale max: 95th percentile of non-zero cells (sparse/low
  // activity data would otherwise be crushed to black by a single extreme cell)
  function robustColorMax(zArrays) {
    const vals = [];
    for (const z of zArrays) {
      for (const row of z) {
        for (const v of row) {
          if (v !== null && v !== undefined && v > 0) vals.push(v);
        }
      }
    }
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    const p95 = vals[Math.min(vals.length - 1, Math.floor(0.95 * vals.length))];
    return p95 > 0 ? p95 : vals[vals.length - 1];
  }

  function actogramMatrix(fly, binMin) {
    binMin = binMin || 30;
    const todBins = Math.round(24 * 60 / binMin);
    const maxDay = fly.dayIdx.length ? M.max(fly.dayIdx) : 0;
    const nDays = maxDay + 1;
    const z = [];
    const days = [];
    for (let d = 0; d < nDays; d++) {
      days.push('D' + (d + 1));
      const row = new Array(todBins).fill(0);
      for (let i = 0; i < fly.activity.length; i++) {
        if (fly.dayIdx[i] !== d) continue;
        const s = Math.min(todBins - 1, Math.floor(fly.todHours[i] * 60 / binMin));
        row[s] += fly.activity[i]; // sum (total activity per cell)
      }
      z.push(row);
    }
    const tod = [];
    for (let s = 0; s < todBins; s++) tod.push((s * binMin) / 60);
    return { days, tod, z };
  }

  function heatmapTrace(z, days, tod, colorscale, cmax) {
    return {
      type: 'heatmap',
      z,
      x: days,
      y: tod,
      colorscale: colorscale,
      zmin: 0,
      zmax: cmax || undefined,
      colorbar: { thickness: 8, tickfont: { color: '#94a3b8', size: 10 }, title: { text: 'Act.', font: { size: 10 } } },
      hovertemplate: 'Day %{x}<br>ZT %{y:.1f} h<br>Act %{z:.1f}<extra></extra>'
    };
  }

  /**
   * Individual actograms — one tile per fly, arranged in a responsive grid.
   */
  function actogramIndividual(flies, container, opts) {
    opts = opts || {};
    const binMin = opts.binMin || 30;
    const colorscale = CM.scale(opts.colormap || 'viridis');
    const cmax = opts.cmax || 'auto';
    container.innerHTML = '';

    // compute matrices once, then robust color-scale max for consistent scaling
    const matrices = flies.map((f) => actogramMatrix(f, binMin));
    const globalMax = cmax === 'auto'
      ? robustColorMax(matrices.map((m) => m.z))
      : cmax;

    const grid = document.createElement('div');
    grid.className = 'actogram-grid';
    container.appendChild(grid);

    for (let fi = 0; fi < flies.length; fi++) {
      const fly = flies[fi];
      const cell = document.createElement('div');
      cell.className = 'actogram-cell';
      grid.appendChild(cell);

      const { days, tod, z } = matrices[fi];
      const layout = baseLayout(fly.well + ' · ' + fly.genotype);
      layout.width = 280;
      layout.height = 190;
      layout.margin = { l: 46, r: 10, t: 26, b: 28 };
      layout.xaxis.title = { text: 'Time (Days)', font: { size: 10 } };
      layout.yaxis.title = { text: 'ZT (h)', font: { size: 10 } };
      layout.yaxis.autorange = 'reversed';
      layout.showlegend = false;
      layout.coloraxis = undefined;

      newPlot(cell, [heatmapTrace(z, days, tod, colorscale, globalMax)], layout, {
        displayModeBar: false, responsive: true
      });
    }
  }

  /**
   * Average group actograms — one tile per genotype.
   */
  function actogramGroup(flies, container, opts) {
    opts = opts || {};
    const binMin = opts.binMin || 30;
    const colorscale = CM.scale(opts.colormap || 'viridis');
    const cmax = opts.cmax || 'auto';
    container.innerHTML = '';

    const genotypes = window.ZAnalysis.uniqueGenotypes(flies);
    const matrices = genotypes.map((g) => {
      const gflies = flies.filter((f) => f.genotype === g);
      const maxDay = Math.max(...gflies.map((f) => (f.dayIdx.length ? M.max(f.dayIdx) : 0)));
      const todBins = Math.round(24 * 60 / binMin);
      const nDays = maxDay + 1;
      const z = [];
      for (let d = 0; d < nDays; d++) z.push(new Array(todBins).fill(0));
      for (const fly of gflies) {
        for (let i = 0; i < fly.activity.length; i++) {
          const d = Math.min(nDays - 1, fly.dayIdx[i]);
          const s = Math.min(todBins - 1, Math.floor(fly.todHours[i] * 60 / binMin));
          z[d][s] += fly.activity[i]; // sum across flies & bins
        }
      }
      return { name: g, z, n: gflies.length };
    });

    const globalMax = cmax === 'auto'
      ? robustColorMax(matrices.map((m) => m.z))
      : cmax;

    const grid = document.createElement('div');
    grid.className = 'actogram-grid';
    container.appendChild(grid);

    matrices.forEach((m, gi) => {
      const cell = document.createElement('div');
      cell.className = 'actogram-cell';
      grid.appendChild(cell);
      const days = m.z.map((_, d) => 'D' + (d + 1));
      const tod = [];
      for (let s = 0; s < Math.round(24 * 60 / binMin); s++) tod.push((s * binMin) / 60);
      const layout = baseLayout(m.name + '  (n=' + m.n + ')');
      layout.width = 300;
      layout.height = 220;
      layout.margin = { l: 50, r: 10, t: 28, b: 30 };
      layout.xaxis.title = { text: 'Time (Days)', font: { size: 10 } };
      layout.yaxis.title = { text: 'ZT (h)', font: { size: 10 } };
      layout.yaxis.autorange = 'reversed';
      layout.showlegend = false;
      newPlot(cell, [heatmapTrace(m.z, days, tod, colorscale, globalMax)], layout, {
        displayModeBar: false, responsive: true
      });
    });
  }

  /* ---------------- Dark-window helper for LD annotations ---------------- */
  function darkHours(flies, phase) {
    // fraction of bins that are dark per hour-of-day across selected days
    const hours = [];
    const dark = new Array(24).fill(0);
    const n = new Array(24).fill(0);
    for (const fly of flies) {
      const allowed = new Set(window.ZAnalysis.selectPhaseDays(fly, phase));
      if (allowed.size === 0) continue;
      for (let i = 0; i < fly.activity.length; i++) {
        if (!allowed.has(fly.dayIdx[i])) continue;
        const h = Math.min(23, Math.floor(fly.todHours[i]));
        n[h]++;
        if (fly.light[i] === 0) dark[h]++;
      }
    }
    for (let h = 0; h < 24; h++) hours.push(n[h] ? dark[h] / n[h] : 0);
    return hours;
  }

  function ldAnnotationShapes(darkFrac) {
    const shapes = [];
    const alpha = 0.16;
    // find dark intervals (wrap-aware)
    let start = null;
    for (let h = 0; h <= 24; h++) {
      const hh = h % 24;
      const isDark = h < 24 ? darkFrac[hh] > 0.5 : (start !== null);
      if (isDark && start === null) start = h;
      if (!isDark && start !== null) {
        shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: h, y0: 0, y1: 1, fillcolor: '#0b1020', opacity: alpha, line: { width: 0 } });
        start = null;
      }
    }
    if (start !== null) {
      shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: start, x1: 24, y0: 0, y1: 1, fillcolor: '#0b1020', opacity: alpha, line: { width: 0 } });
    }
    return shapes;
  }

  /* ---------------- Whole experiment activity ---------------- */
  // Robust y-max: if a single huge peak would crush the rest of the data,
  // clip the view to a high percentile so the rest is visible.
  function robustYMax(values) {
    const vals = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v) && v > 0);
    if (!vals.length) return 0;
    vals.sort((a, b) => a - b);
    const mx = vals[vals.length - 1];
    const p95 = vals[Math.min(vals.length - 1, Math.floor(0.95 * vals.length))];
    const p99 = vals[Math.min(vals.length - 1, Math.floor(0.99 * vals.length))];
    if (p95 > 0 && mx > 2.5 * p95) {
      // outlier present — cap so the bulk of the data is visible
      return Math.max(p99, 1.5 * p95);
    }
    return mx;
  }

  function wholeExpActivity(series, container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const layout = baseLayout('Whole-Experiment Activity Profile');
    layout.xaxis.title = { text: 'Time (Days)' };
    layout.yaxis.title = { text: 'Activity Rate (counts / bin)' };
    layout.showlegend = true;
    layout.legend.orientation = 'h';
    layout.legend.y = -0.18;

    const data = [];
    series.forEach((s, gi) => {
      const col = genotypeColor(gi);
      const x = s.t.map((h) => h / 24);
      const upper = s.mean.map((v, i) => (v === null ? null : v + s.sem[i]));
      const lower = s.mean.map((v, i) => (v === null ? null : v - s.sem[i]));
      data.push({ x, y: s.mean, name: s.name, mode: 'lines', line: { color: col, width: 2 }, hovertemplate: 'Day %{x:.2f}<br>' + s.name + ': %{y:.2f}<extra></extra>' });
      data.push({ x, y: upper, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      data.push({ x, y: lower, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.15, hoverinfo: 'skip', showlegend: false });
    });

    // robust y-axis: manual override or auto-clip outliers
    let yMax;
    if (opts.yMax && Number.isFinite(opts.yMax) && opts.yMax > 0) {
      yMax = opts.yMax;
    } else {
      const all = [];
      for (const s of series) for (const v of s.mean) all.push(v);
      yMax = robustYMax(all);
    }
    if (yMax > 0) layout.yaxis.range = [0, yMax];

    // dark shading from light data
    if (opts.shapes && opts.shapes.length) {
      layout.shapes = opts.shapes;
    } else if (opts.darkFracAll) {
      layout.shapes = ldAnnotationShapes(opts.darkFracAll);
    }
    newPlot(container, data, layout);
  }

  /* ---------------- 24h wrapped profiles ---------------- */
  function profile24Chart(profiles, flies, container, metric, phase, opts) {
    // metric: 'sleep' | 'activity'
    opts = opts || {};
    container.innerHTML = '';
    const isSleep = metric === 'sleep';
    const layout = baseLayout(isSleep ? '24-Hour Sleep Profile' : '24-Hour Activity Profile');
    layout.xaxis.title = { text: 'Time of Day (h)' };
    layout.xaxis.range = [0, 24];
    layout.yaxis.title = isSleep ? { text: 'Fraction Asleep' } : { text: 'Mean Activity Count' };
    if (isSleep) layout.yaxis.range = [0, 1];
    layout.showlegend = true;
    layout.legend.orientation = 'h';
    layout.legend.y = -0.18;

    const data = [];
    profiles.forEach((p, gi) => {
      const col = genotypeColor(gi);
      const mean = isSleep ? p.sleepMean : p.actMean;
      const sem = isSleep ? p.sleepSem : p.actSem;
      const upper = mean.map((v, i) => (v === null ? null : v + sem[i]));
      const lower = mean.map((v, i) => (v === null ? null : v - sem[i]));
      data.push({
        x: p.hours, y: mean, name: p.name, mode: 'lines', line: { color: col, width: 2.2 },
        hovertemplate: 'ZT %{x:.1f} h<br>' + p.name + ': %{y:.3f}<extra></extra>'
      });
      data.push({ x: p.hours, y: upper, mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
      data.push({ x: p.hours, y: lower, mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: col, opacity: 0.15, hoverinfo: 'skip', showlegend: false });
    });

    const darkFrac = darkHours(flies, phase);
    layout.shapes = ldAnnotationShapes(darkFrac);

    // robust y-axis for the activity profile (manual override or auto-clip)
    if (!isSleep) {
      let yMax;
      if (opts.yMax && Number.isFinite(opts.yMax) && opts.yMax > 0) {
        yMax = opts.yMax;
      } else {
        const all = [];
        for (const p of profiles) for (const v of p.actMean) all.push(v);
        yMax = robustYMax(all);
      }
      if (yMax > 0) layout.yaxis.range = [0, yMax];
    }

    newPlot(container, data, layout);
  }

  /* ---------------- Box plots ---------------- */
  function boxPlot(flyLevel, metric, container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const labels = {
      sleepMinDay: { title: 'Total Daily Sleep (min/day)', hover: 'Sleep' },
      activityDay: { title: 'Total Daily Activity (counts/day)', hover: 'Activity' },
      boutCountDay: { title: 'Sleep Bout Count (per day)', hover: 'Bouts' },
      meanBoutLenDay: { title: 'Mean Bout Duration (min)', hover: 'Bout len' }
    };
    const lab = labels[metric] || labels.sleepMinDay;

    const genotypes = window.ZAnalysis.uniqueGenotypes(flyLevel.map((r) => r.fly));
    const data = [];
    genotypes.forEach((g, gi) => {
      const vals = flyLevel.filter((r) => r.genotype === g).map((r) => r[metric]);
      data.push({
        y: vals,
        name: g,
        type: 'box',
        boxpoints: 'all',
        jitter: 0.35,
        pointpos: 0,
        marker: { color: genotypeColor(gi), size: 6, opacity: 0.85 },
        line: { color: genotypeColor(gi), width: 1.8 },
        fillcolor: genotypeColor(gi),
        opacity: 0.55,
        whiskerwidth: 0.25,
        hovertemplate: g + '<br>' + lab.hover + ': %{y:.2f}<extra></extra>'
      });
    });
    const layout = baseLayout(lab.title);
    layout.xaxis.title = { text: 'Genotype' };
    layout.yaxis.title = { text: lab.title };
    layout.showlegend = false;
    layout.margin.t = 40;
    if (opts.outlierCut && opts.outlierCut > 0) {
      layout.yaxis.range = [0, opts.outlierCut];
    }
    newPlot(container, data, layout);
  }

  /* ---------------- Periodogram ---------------- */
  function periodogramPlot(periodSummary, container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const genotypes = window.ZAnalysis.uniqueGenotypes(periodSummary.map((r) => r.fly));

    const subplots = [];
    const allPeriods = [];
    genotypes.forEach((g, gi) => {
      const rows = periodSummary.filter((r) => r.genotype === g);
      const p = rows[0] && rows[0].result;
      const periods = p ? p.periods : [];
      for (const t of periods) if (!allPeriods.includes(t)) allPeriods.push(t);
      subplots.push({ name: g, rows, periods });
    });
    allPeriods.sort((a, b) => a - b);

    const data = [];
    const annotations = [];
    subplots.forEach((sp, gi) => {
      const col = genotypeColor(gi);
      const xaxis = gi === 0 ? 'x' : 'x' + (gi + 1);
      const yaxis = gi === 0 ? 'y' : 'y' + (gi + 1);
      sp.rows.forEach((r) => {
        data.push({
          x: r.result.periods, y: r.result.qp, type: 'scatter', mode: 'lines',
          xaxis, yaxis, line: { color: col, width: 1.1, opacity: 0.75 },
          name: r.well, showlegend: false,
          hovertemplate: sp.name + ' ' + r.well + '<br>Period %{x:.1f} h<br>Power %{y:.0f}<extra></extra>'
        });
      });
      // significance threshold (median across flies for display)
      const thrVals = sp.rows.filter((r) => r.threshold !== undefined).map((r) => r.threshold);
      if (thrVals.length) {
        const thr = M.median(thrVals);
        data.push({
          x: allPeriods, y: allPeriods.map(() => thr), type: 'scatter', mode: 'lines',
          xaxis, yaxis, line: { color: '#f87171', width: 1.6, dash: 'dash' },
          name: 'Significance', showlegend: false,
          hovertemplate: 'Threshold: %{y:.0f}<extra></extra>'
        });
      }
      annotations.push({
        text: sp.name + '  (n=' + sp.rows.length + ')', xref: 'paper', yref: 'paper',
        x: 0.5, y: 1.12, showarrow: false, font: { size: 13, color: '#e2e8f0' }
      });
    });

    const layout = baseLayout('Chi-Square Periodogram');
    layout.xaxis.title = { text: 'Period (Hours)' };
    layout.yaxis.title = { text: 'Power (Qp)' };
    layout.xaxis.range = [17.5, 32.5];
    layout.annotations = annotations;
    layout.margin.t = 60;
    if (subplots.length > 1) {
      layout.grid = { rows: 1, columns: subplots.length, pattern: 'independent' };
      // per-subplot axes
      for (let gi = 0; gi < subplots.length; gi++) {
        const pre = gi === 0 ? '' : String(gi + 1);
        layout['xaxis' + (pre || '')] = layout['xaxis' + (pre || '')] || Object.assign({}, layout.xaxis);
        layout['yaxis' + (pre || '')] = layout['yaxis' + (pre || '')] || Object.assign({}, layout.yaxis);
      }
      // ensure axis range on all
      for (let gi = 0; gi < subplots.length; gi++) {
        const pre = gi === 0 ? '' : String(gi + 1);
        const ax = layout['xaxis' + (pre || '')];
        if (ax) { ax.range = [17.5, 32.5]; ax.title = { text: 'Period (Hours)' }; }
      }
    }
    newPlot(container, data, layout);
  }

  function periodDistributionBox(periodSummary, container, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const genotypes = window.ZAnalysis.uniqueGenotypes(periodSummary.map((r) => r.fly));
    const data = [];
    genotypes.forEach((g, gi) => {
      const vals = periodSummary.filter((r) => r.genotype === g).map((r) => r.period);
      data.push({
        y: vals, name: g, type: 'box',
        boxpoints: 'all', jitter: 0.35, pointpos: 0,
        marker: { color: genotypeColor(gi), size: 6, opacity: 0.85 },
        line: { color: genotypeColor(gi), width: 1.8 },
        fillcolor: genotypeColor(gi), opacity: 0.55,
        whiskerwidth: 0.25,
        hovertemplate: g + '<br>Period %{y:.2f} h<extra></extra>'
      });
    });
    const layout = baseLayout('Peak Period Distribution (rhythmic flies)');
    layout.xaxis.title = { text: 'Genotype' };
    layout.yaxis.title = { text: 'Period (Hours)' };
    layout.yaxis.range = [17, 33];
    layout.showlegend = false;
    newPlot(container, data, layout);
  }

  /* ---------------- Export ---------------- */
  function exportFigure(el, filename, format, scale) {
    format = format || 'png';
    scale = scale || 2;
    return Plotly.toImage(el, { format, width: el.clientWidth, height: el.clientHeight, scale }).then((url) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  return {
    genotypeColor,
    newPlot, baseLayout,
    actogramIndividual, actogramGroup,
    wholeExpActivity, profile24Chart,
    boxPlot, periodogramPlot, periodDistributionBox,
    ldAnnotationShapes, darkHours,
    exportFigure
  };
})();
