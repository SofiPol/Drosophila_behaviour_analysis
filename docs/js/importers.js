/* ============================================================================
 * importers.js — data adapters, regularisation, metadata joining and QC
 * Exposed as window.Importers
 * ==========================================================================*/
(function (global) {
  'use strict';
  const C = global.Core;

  /* ============================ small helpers ============================ */
  function splitRow(line, delim) {
    if (delim) return line.split(delim);
    return line.trim().split(/\t+/);
  }

  // RFC-4180-ish single-line splitter. Fast path for the common unquoted
  // case, which is important for multi-megabyte Zantiks files.
  function splitCsvLine(line) {
    if (line.indexOf('"') < 0) return line.split(',');
    const cells = [];
    let field = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(field); field = ''; }
      else field += ch;
    }
    cells.push(field);
    return cells;
  }
  function numericColumns(rows, maxRows = 200) {
    const n = rows[0] ? rows[0].length : 0;
    const flags = new Array(n).fill(0);
    const counts = new Array(n).fill(0);
    for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
      for (let c = 0; c < n; c++) {
        const v = rows[r][c];
        if (v === undefined || v === null) continue;
        counts[c]++;
        if (v !== '' && Number.isFinite(Number(v))) flags[c]++;
      }
    }
    return flags.map((f, i) => counts[i] > 0 && f / counts[i] > 0.8);
  }
  function firstDataLine(lines, start = 0) {
    for (let i = start; i < lines.length; i++) if (lines[i].trim()) return i;
    return -1;
  }

  /* ============================ DAM ============================ */
  /**
   * Parse TriKinetics DAM monitor text. Handles tab- or space-separated rows,
   * optional header, 24/32 channels and either 5-metadata-column (standard)
   * or extended 10-metadata-column layouts.
   *
   * @param {string} text
   * @param {string} filename
   * @param {object} opts { lightIndex, metaCols, channels }
   */
  function parseDam(text, filename, opts = {}) {
    const rawLines = text.split(/\r?\n/);
    const lines = rawLines.filter((l) => l.trim().length > 0);
    if (!lines.length) throw new Error('The DAM file is empty.');

    // Detect delimiter from the first few lines. DAM files are normally tabs;
    // some exports use multiple spaces.
    const sample = lines.slice(0, 5).join('\n');
    let delim = null;
    if (/\t/.test(sample)) delim = '\t';
    let header = null;
    let dataStart = 0;
    const firstCells = splitRow(lines[0], delim);
    const hasHeader = firstCells.some((c) => /date|time|status|light|channel|monitor/i.test(c)) &&
      !/^\d+$/.test((firstCells[0] || '').trim());
    if (hasHeader) {
      header = firstCells.map((c) => c.trim());
      dataStart = 1;
    }

    // Find a representative data row and count columns.
    let firstData = null;
    for (let i = dataStart; i < lines.length; i++) {
      const cells = splitRow(lines[i], delim);
      if (cells.length >= 8) { firstData = cells; dataStart = i; break; }
    }
    if (!firstData) throw new Error('No DAM data rows with at least 8 columns were found.');

    // If there is no tab delimiter, split the first 5 fields carefully:
    // index, date (3 tokens), time (1 token), status, light, channels.
    let metaTokenCount = 5;
    if (!delim) {
      const m = /^(\d+)\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(lines[dataStart].trim());
      if (m) {
        const rest = m[4].trim().split(/\s+/);
        // rest = status, light, channels...
        metaTokenCount = 2;
        firstData = [m[1], m[2], m[3]].concat(rest);
      }
    }

    const nCols = firstData.length;
    let metaCols = opts.metaCols;
    if (!metaCols && header && header.length >= nCols) {
      // Prefer the channel names in the header. DAM files can have four or
      // five metadata columns before 32 channels, and a four-column layout
      // would otherwise be mistaken for a 24-channel file.
      const headerChannels = header.slice(3).filter((h) => /^(ch(?:annel)?\s*)?\d+$/i.test(String(h).trim())).length;
      if (headerChannels >= 4) metaCols = Math.max(1, nCols - headerChannels);
    }
    if (!metaCols) {
      // Standard DAM2: 5 metadata + 32 channels = 37. A four-metadata-column
      // 32-channel export is 36 columns. Zantiks 24-channel export: 10 + 24 = 34.
      if (nCols >= 37) metaCols = nCols - 32;
      else if (nCols >= 36) metaCols = nCols - 32;
      else if (nCols >= 34) metaCols = nCols - 24;
      else metaCols = Math.max(4, nCols - 24);
    }
    const nChannels = Math.max(1, nCols - metaCols);
    let lightIndex = opts.lightIndex;
    if (lightIndex === undefined || lightIndex === null) {
      // Usually the 5th column (index 4) in standard DAM; 4th (index 3) in
      // some 10-column TriKinetics exports. Pick the first binary column.
      const candidates = [];
      for (let c = 0; c < Math.min(metaCols, nCols); c++) {
        let binary = true, changes = 0, prev = null, run = 0, maxRun = 0;
        for (let r = dataStart; r < Math.min(lines.length, dataStart + 400); r++) {
          const cells = splitRow(lines[r], delim);
          if (!delim) {
            // Use the reconstructed columns only for this heuristic.
            const mm = /^(\d+)\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(lines[r].trim());
            if (!mm) continue;
            const rr = [mm[1], mm[2], mm[3]].concat(mm[4].trim().split(/\s+/));
            cells.length = 0;
            cells.push(...rr);
          }
          if (c >= cells.length) { binary = false; break; }
          const v = cells[c].trim();
          if (v !== '0' && v !== '1') { binary = false; break; }
          if (prev !== null && v !== prev) { changes++; run = 0; }
          run++;
          maxRun = Math.max(maxRun, run);
          prev = v;
        }
        if (binary && changes > 0) candidates.push({ c, changes, maxRun });
      }
      candidates.sort((a, b) => (b.changes - a.changes) || (b.maxRun - a.maxRun));
      lightIndex = candidates.length ? candidates[0].c : Math.min(metaCols - 1, 4);
    }

    const rows = [];
    let parseErrors = 0;
    for (let i = dataStart; i < lines.length; i++) {
      let cells = splitRow(lines[i], delim);
      let dateStr, timeStr, metaVals;
      if (delim) {
        dateStr = cells[1];
        timeStr = cells[2];
        metaVals = cells.slice(3, metaCols);
        const channelVals = cells.slice(metaCols, metaCols + nChannels);
        rows.push(makeDamRow(cells[0], dateStr, timeStr, metaVals, channelVals, lightIndex - 3));
      } else {
        const m = /^(\d+)\s+(\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/.exec(lines[i].trim());
        if (!m) { parseErrors++; continue; }
        const rest = m[4].trim().split(/\s+/);
        // rest[0] = status, rest[1] = light, rest[2...] = channels (standard)
        const metaV = rest.slice(0, Math.max(1, metaCols - 3));
        const channelV = rest.slice(Math.max(1, metaCols - 3));
        rows.push(makeDamRow(m[1], m[2], m[3], metaV, channelV, 1));
      }
    }

    let start = null, end = null;
    for (const r of rows) {
      if (!r.timestamp) continue;
      if (!start || r.timestamp < start) start = r.timestamp;
      if (!end || r.timestamp > end) end = r.timestamp;
    }
    const binMinutes = inferBinMinutes(rows);

    return {
      kind: 'dam',
      file: filename || 'DAM.txt',
      rows,
      nChannels,
      metaCols,
      lightIndex,
      lightMetaIndex: Math.max(0, lightIndex - 3),
      header,
      binMinutes,
      start,
      end,
      parseErrors
    };
  }

  function makeDamRow(index, dateStr, timeStr, metaVals, channelVals, lightMetaIndex) {
    const ts = C.parseDateTime(dateStr + ' ' + (timeStr || '00:00:00'));
    const light = metaVals && lightMetaIndex >= 0 && lightMetaIndex < metaVals.length
      ? (String(metaVals[lightMetaIndex]).trim() === '1' ? 1 : 0)
      : 0;
    const channels = new Array(channelVals.length);
    for (let i = 0; i < channelVals.length; i++) {
      const v = Number(channelVals[i]);
      channels[i] = Number.isFinite(v) ? v : NaN;
    }
    return {
      index: parseInt(index, 10) || 0,
      date: dateStr,
      time: timeStr,
      timestamp: ts,
      light,
      meta: metaVals,
      channels
    };
  }

  function inferBinMinutes(rows) {
    const diffs = [];
    for (let i = 1; i < Math.min(rows.length, 50); i++) {
      if (rows[i].timestamp && rows[i - 1].timestamp) {
        const d = (rows[i].timestamp - rows[i - 1].timestamp) / 60000;
        if (d > 0) diffs.push(d);
      }
    }
    if (!diffs.length) return 1;
    diffs.sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)];
    const snaps = [1, 2, 5, 10, 15, 20, 30, 60];
    for (const s of snaps) if (Math.abs(med - s) < 0.35) return s;
    return med;
  }

  /* ============================ Zantiks ============================ */
  function parseZantiks(text, filename) {
    const lines = text.split(/\r?\n/);
    if (!lines.length) throw new Error('The Zantiks CSV is empty.');
    const info = { startDate: null, startString: '', experiment: '', apparatus: '', unit: '', service: '' };
    let headerRow = -1;
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const cells = splitCsvLine(lines[i]).map((c) => String(c).trim());
      if (cells[1] === 'Info' && cells[2]) {
        const key = cells[2];
        const val = cells.slice(3).join(',').trim();
        if (/execution start/i.test(val)) {
          info.startString = key;
          info.startDate = C.parseDateTime(key);
          const m = /'([^']+)'/.exec(val);
          if (m) info.service = m[1];
        } else if (/subject identification/i.test(key)) info.experiment = val;
        else if (/apparatus/i.test(key)) info.apparatus = val;
        else if (/unit id/i.test(key)) info.unit = val;
      }
      if (cells.some((c) => /^RUNTIME$/i.test(c))) { headerRow = i; break; }
    }
    if (headerRow < 0) throw new Error('Could not find the Zantiks RUNTIME header row.');
    const header = splitCsvLine(lines[headerRow]).map((c) => String(c).trim());
    const activityCols = header.filter((h) => /^[A-H][1-9]$/i.test(h));
    if (!activityCols.length) throw new Error('No Zantiks wells (A1…D6) found in the header.');
    const index = {};
    header.forEach((h, i) => { index[h] = i; });
    const runtimeIdx = header.findIndex((h) => /^RUNTIME$/i.test(h));
    const ldIdx = header.findIndex((h) => /L_OR_D|LIGHT/i.test(h));
    const dayIdx = header.findIndex((h) => /^DAY$/i.test(h));
    const hourIdx = header.findIndex((h) => /^HOUR$/i.test(h));
    const tempIdx = header.findIndex((h) => /TEMPERATURE/i.test(h));
    const activityIdx = activityCols.map((c) => index[c]);

    const light = [];
    const series = {};
    for (const c of activityCols) series[c] = [];
    const runtime = [];
    const temperature = [];
    for (let r = headerRow + 1; r < lines.length; r++) {
      const line = lines[r];
      if (!line || line.length < 3) continue;
      const cells = splitCsvLine(line);
      const rt = Number(cells[runtimeIdx]);
      if (!Number.isFinite(rt)) continue;
      runtime.push(rt);
      temperature.push(tempIdx >= 0 ? Number(cells[tempIdx]) : NaN);
      const ld = ldIdx >= 0 ? String(cells[ldIdx]) : '';
      light.push(/light/i.test(ld) ? 1 : 0);
      for (let a = 0; a < activityCols.length; a++) {
        const v = Number(cells[activityIdx[a]]);
        series[activityCols[a]].push(Number.isFinite(v) ? v : NaN);
      }
    }
    if (!runtime.length) throw new Error('No Zantiks data rows found.');
    // Prefer the precise timestamp embedded in the filename.
    let start = info.startDate;
    const fm = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(filename || '');
    if (fm) {
      const fdate = new Date(+fm[1], +fm[2] - 1, +fm[3], +fm[4], +fm[5], +fm[6]);
      if (!start || Math.abs(fdate - start) <= 90 * 1000) start = fdate;
    }
    if (!start) start = new Date(2000, 0, 1, 0, 0, 0);
    // Runtime is seconds; infer sample interval.
    const diffs = [];
    for (let i = 1; i < Math.min(runtime.length, 50); i++) diffs.push(runtime[i] - runtime[i - 1]);
    diffs.sort((a, b) => a - b);
    const dtSec = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 60;
    const binMinutes = dtSec / 60;
    const timesDate = runtime.map((t) => new Date(start.getTime() + t * 1000));

    return {
      kind: 'wide',
      format: 'zantiks',
      name: filename || 'Zantiks.csv',
      info,
      times: timesDate,
      start,
      startClockHour: start.getHours() + start.getMinutes() / 60 + start.getSeconds() / 3600,
      light,
      series,
      keys: activityCols,
      labels: activityCols,
      binMinutes,
      rawText: null
    };
  }

  /**
   * Convert a parsed Zantiks dataset into a standard DAM text file
   * (5 metadata columns + 32 channels).
   */
  function zantiksToDam(z) {
    const pad = (v) => String(v).padStart(2, '0');
    const months = C.MONTHS;
    const out = [];
    const n = z.times.length;
    for (let i = 0; i < n; i++) {
      const d = z.times[i];
      const date = `${pad(d.getDate())} ${months[d.getMonth()]} ${pad(d.getFullYear() % 100)}`;
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const vals = [];
      for (let c = 0; c < 32; c++) {
        if (c < z.keys.length) {
          const v = z.series[z.keys[c]][i];
          vals.push(String(Number.isFinite(v) ? Math.round(v * 1000) : 0));
        } else vals.push('0');
      }
      out.push([String(i + 1), date, time, '0', String(z.light[i] || 0)].concat(vals).join('\t'));
    }
    return out.join('\n') + '\n';
  }

  /* ============================ generic CSV / Excel ============================ */
  function autoMapGeneric(text) {
    const parsed = C.csvParse(text);
    const rows = parsed.rows;
    if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
    const cleanHeader = (h) => String(h ?? '').replace(/^\uFEFF/, '').trim();
    const header = rows[0].map(cleanHeader);
    const body = rows.slice(1);
    const numeric = numericColumns(body);
    const lower = header.map((h) => h.toLowerCase());
    const find = (patterns) => {
      for (const p of patterns) {
        const idx = lower.findIndex((h) => p.test(h));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const timeIdx = find([/^timestamp$/, /datetime/, /date.?time/, /^date$/, /^time$/, /elapsed/, /runtime/, /^t$/, /hours?/, /seconds?/]);
    const idIdx = find([/animal|subject|genotype|roi|region|channel|well|^id$/]);
    const valueIdx = find([/activity|count|value|distance|beam|movement|moving/]);
    const lightIdx = find([/light|ld|photoperiod|l_or_d/]);
    const timeValues = timeIdx >= 0 ? body.slice(0, 10).map((r) => r[timeIdx]) : [];
    const timeType = timeValues.length && timeValues.every((v) => C.parseDateTime(v))
      ? 'datetime'
      : 'elapsed';
    // Wide columns: numeric columns other than time/light/id/value.
    const wideCols = [];
    header.forEach((h, i) => {
      if (i === timeIdx || i === lightIdx || i === idIdx || i === valueIdx) return;
      if (numeric[i]) wideCols.push(i);
    });
    const long = idIdx >= 0 && valueIdx >= 0 && idIdx !== valueIdx && !(timeIdx >= 0 && wideCols.length > 1);
    return {
      parsed, header, body, numeric, timeIdx, idIdx, valueIdx, lightIdx,
      timeType, mode: long ? 'long' : 'wide', wideCols,
      hasHeader: true
    };
  }

  function buildGeneric(map, opts = {}) {
    const header = map.header;
    const body = map.body;
    const timeIdx = opts.timeIdx ?? map.timeIdx;
    const lightIdx = opts.lightIdx ?? map.lightIdx;
    const idIdx = opts.idIdx ?? map.idIdx;
    const valueIdx = opts.valueIdx ?? map.valueIdx;
    const mode = opts.mode || map.mode;
    const timeUnit = opts.timeUnit || 'auto';
    const startClockHour = opts.startClockHour ?? 0;
    if (timeIdx < 0) throw new Error('Choose a timestamp or elapsed-time column.');

    // Parse time values.
    const firstTime = body[0] ? body[0][timeIdx] : '';
    const parsedFirst = C.parseDateTime(firstTime);
    const absolute = parsedFirst !== null && !/^\d+(\.\d+)?$/.test(String(firstTime).trim());
    let times;
    if (absolute) {
      times = body.map((r) => C.parseDateTime(r[timeIdx])).filter(Boolean);
    } else {
      const raw = body.map((r) => Number(r[timeIdx]));
      // factor = hours per input unit
      let factor = 1 / 3600; // seconds by default
      if (timeUnit === 'hours') factor = 1;
      else if (timeUnit === 'minutes') factor = 1 / 60;
      else if (timeUnit === 'seconds') factor = 1 / 3600;
      else if (timeUnit === 'days') factor = 24;
      else {
        const finite = raw.filter(Number.isFinite);
        const span = finite.length ? Math.max(...finite) - Math.min(...finite) : 0;
        const diffs = [];
        for (let i = 1; i < Math.min(finite.length, 200); i++) {
          const d = finite[i] - finite[i - 1];
          if (d > 0) diffs.push(d);
        }
        diffs.sort((a, b) => a - b);
        const dt = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 1;
        const headerName = String(header[timeIdx] || '').toLowerCase();
        if (/runtime|seconds?|_s\b|^s$/.test(headerName)) factor = 1 / 3600;
        else if (/minutes?|mins?|_min\b/.test(headerName)) factor = 1 / 60;
        else if (/hours?|hrs?|^h$/.test(headerName)) factor = 1;
        else if (/days?|^d$/.test(headerName)) factor = 24;
        else if (dt < 0.2) factor = span < 500 ? 1 : 1 / 3600;
        else if (dt <= 1.5) factor = span > 500 ? 1 / 60 : 1 / 3600;
        else if (dt <= 90) factor = 1 / 60;
        else factor = 1;
      }
      times = raw.map((v) => v * factor);
    }
    let nRows = Math.min(times.length, body.length);

    const series = {};
    const labels = {};
    const rawTimes = times.slice();
    if (mode === 'long') {
      if (idIdx < 0 || valueIdx < 0) throw new Error('Long format needs an animal-ID column and a value column.');
      const norm = (t) => t instanceof Date ? t.getTime() : t;
      const isDate = times[0] instanceof Date;
      const globalFirst = rawTimes.reduce((m, t) => (m === null || norm(t) < m ? norm(t) : m), null);
      const grouped = new Map();
      for (let i = 0; i < nRows; i++) {
        const id = String(body[i][idIdx] ?? '').trim();
        if (!id) continue;
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push({ t: times[i], v: Number(body[i][valueIdx]) });
      }
      const groupMaps = new Map();
      for (const [id, vals] of grouped) {
        const byTime = new Map();
        for (const x of vals) {
          const t = norm(x.t);
          const rel = isDate ? (t - globalFirst) / 3600000 : t - globalFirst;
          if (!byTime.has(rel)) byTime.set(rel, x.v);
        }
        groupMaps.set(id, byTime);
        labels[id] = id;
      }
      const timeKeys = [...new Set(rawTimes.map(norm))].sort((a, b) => a - b);
      times = timeKeys.map((k) => isDate ? new Date(k) : k);
      nRows = timeKeys.length;
      for (const [id, byTime] of groupMaps) {
        series[id] = timeKeys.map((k) => {
          const rel = isDate ? (k - globalFirst) / 3600000 : k - globalFirst;
          const v = byTime.get(rel);
          return v === undefined ? NaN : v;
        });
      }
    } else {
      const cols = (opts.wideCols || map.wideCols || []).filter((c) => c !== timeIdx);
      if (!cols.length) throw new Error('No numeric animal columns were detected.');
      for (const c of cols) {
        const id = header[c] || ('col' + (c + 1));
        series[id] = body.slice(0, nRows).map((r) => {
          const v = Number(r[c]);
          return Number.isFinite(v) ? v : NaN;
        });
        labels[id] = id;
      }
    }

    let light = lightIdx >= 0
      ? body.slice(0, Math.min(rawTimes.length, body.length)).map((r) => {
        const v = String(r[lightIdx] ?? '').trim();
        if (/^1$|light|^l$|^day$/i.test(v)) return 1;
        if (/^0$|dark|^d$|^night$/i.test(v)) return 0;
        const n = Number(v);
        return Number.isFinite(n) ? (n > 0 ? 1 : 0) : 0;
      })
      : null;
    if (mode === 'long' && light) {
      const norm = (t) => t instanceof Date ? t.getTime() : t;
      const lightMap = new Map();
      for (let i = 0; i < rawTimes.length; i++) {
        const k = norm(rawTimes[i]);
        if (!lightMap.has(k)) lightMap.set(k, light[i]);
      }
      light = times.map((t) => {
        const v = lightMap.get(norm(t));
        return v === undefined ? 0 : v;
      });
    }

    let start = null, startClockHourFinal = startClockHour;
    if (times[0] instanceof Date) {
      start = times[0];
      startClockHourFinal = start.getHours() + start.getMinutes() / 60 + start.getSeconds() / 3600;
    }
    // Infer sample interval
    let binMinutes = 1;
    if (nRows > 1) {
      const t0 = times[0], t1 = times[1];
      const d = t0 instanceof Date ? (t1 - t0) / 60000 : (t1 - t0) * 60;
      if (Number.isFinite(d) && d > 0) binMinutes = d;
    }

    return {
      kind: 'wide',
      format: 'generic',
      name: opts.name || 'Generic CSV',
      times,
      start,
      startClockHour: startClockHourFinal,
      light,
      series,
      keys: Object.keys(series),
      labels,
      binMinutes,
      meta: {
        timeColumn: header[timeIdx],
        mode,
        absolute,
        nRows,
        columns: header
      }
    };
  }

  /* ============================ Ethoscope ============================ */
  function movingFromDistance(dist, dtSeconds, threshold, windowSeconds = 10) {
    // Aggregate distance into windowSeconds windows, take max velocity.
    const n = dist.length;
    if (n < 2) return { moving: new Uint8Array(0), windows: [] };
    const winMs = windowSeconds * 1000;
    const groups = new Map();
    for (let i = 1; i < n; i++) {
      const dt = dtSeconds[i];
      const v = dt > 0 ? dist[i] / dt : 0;
      const key = Math.floor(i * dtSeconds[i] / windowSeconds);
      if (!groups.has(key)) groups.set(key, { maxV: 0, distance: 0, n: 0 });
      const g = groups.get(key);
      g.maxV = Math.max(g.maxV, v);
      g.distance += dist[i];
      g.n++;
    }
    const keys = [...groups.keys()].sort((a, b) => a - b);
    const moving = new Uint8Array(keys.length);
    const windows = [];
    keys.forEach((k, i) => {
      const g = groups.get(k);
      moving[i] = g.maxV > threshold ? 1 : 0;
      windows.push({ t: k * windowSeconds, maxV: g.maxV, distance: g.distance, moving: moving[i] });
    });
    return { moving, windows };
  }

  async function parseEthoscopeDb(arrayBuffer, filename, opts = {}) {
    if (typeof global.initSqlJs !== 'function') {
      throw new Error('Ethoscope SQLite support is unavailable (sql.js not loaded). Export ROI CSVs from ethoscope and upload those instead.');
    }
    const SQL = await global.initSqlJs({ locateFile: (f) => 'vendor/' + f });
    const db = new SQL.Database(new Uint8Array(arrayBuffer));
    const tables = [];
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    if (res[0]) for (const row of res[0].values) tables.push(row[0]);
    const roiTables = tables.filter((t) => /^ROI_\d+$/i.test(t));
    if (!roiTables.length) throw new Error('No ROI_1…ROI_n tables found in this ethoscope database.');

    let expDate = null;
    for (const t of ['METADATA', 'metadata', 'EXPERIMENT']) {
      if (!tables.includes(t)) continue;
      try {
        const info = db.exec(`PRAGMA table_info(${t})`);
        const cols = info[0] ? info[0].values.map((v) => String(v[1]).toLowerCase()) : [];
        if (cols.length) {
          const q = db.exec(`SELECT * FROM ${t} LIMIT 20`);
          if (q[0]) {
            for (const row of q[0].values) {
              const joined = row.map((v) => String(v)).join(' ');
              const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(joined);
              if (m) { expDate = C.parseDateTime(m[1] + ' ' + m[2]); break; }
            }
          }
        }
      } catch (e) { /* ignore metadata parse issues */ }
      if (expDate) break;
    }

    const threshold = opts.velocityThreshold ?? 1.0;
    const windowSeconds = opts.windowSeconds ?? 10;
    const series = {};
    const labels = {};
    const movingSeries = {};
    const windowsMeta = {};
    let nWindows = 0;

    for (const table of roiTables) {
      const q = db.exec(`SELECT t, xy_dist_log10x1000, has_interacted FROM ${table} ORDER BY t`);
      if (!q[0]) continue;
      const vals = q[0].values;
      const n = vals.length;
      if (n < 2) continue;
      const tms = new Float64Array(n);
      const dist = new Float64Array(n);
      const dtSec = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        tms[i] = Number(vals[i][0]);
        const lg = Number(vals[i][1]);
        dist[i] = Number.isFinite(lg) ? Math.pow(10, lg / 1000) : 0;
        dtSec[i] = i === 0 ? 0 : Math.max(1e-6, (tms[i] - tms[i - 1]) / 1000);
      }
      // Use the displacement between consecutive frames, not the distance at i.
      const stepDist = new Float64Array(n);
      stepDist[0] = 0;
      for (let i = 1; i < n; i++) stepDist[i] = dist[i];
      const mv = movingFromDistance(stepDist, dtSec, threshold, windowSeconds);
      const key = table.replace(/^ROI_/i, 'ROI ');
      series[key] = mv.windows.map((w) => w.distance);
      labels[key] = key;
      movingSeries[key] = mv.moving;
      windowsMeta[key] = mv.windows.map((w) => w.t);
      nWindows = Math.max(nWindows, mv.windows.length);
    }
    db.close();
    return {
      kind: 'wide',
      format: 'ethoscope',
      name: filename || 'Ethoscope.db',
      times: Array.from({ length: nWindows }, (_, i) => i * windowSeconds / 3600),
      start: expDate,
      startClockHour: expDate ? expDate.getHours() + expDate.getMinutes() / 60 : 0,
      light: null,
      series,
      moving: movingSeries,
      keys: Object.keys(series),
      labels,
      binMinutes: windowSeconds / 60,
      meta: { roiTables, threshold, windowSeconds }
    };
  }

  function parseEthoscopeCsv(text, filename, opts = {}) {
    const parsed = C.csvParse(text);
    const rows = parsed.rows;
    if (rows.length < 2) throw new Error('The ethoscope CSV is empty.');
    const header = rows[0].map((h) => String(h).trim());
    const lower = header.map((h) => h.toLowerCase());
    const tIdx = lower.findIndex((h) => h === 't' || h === 'time' || h.includes('timestamp') || h === 'datetime');
    const roiIdx = lower.findIndex((h) => h === 'roi' || h === 'id' || h.includes('roi') || h.includes('region') || h.includes('animal'));
    let distIdx = lower.indexOf('xy_dist_log10x1000');
    if (distIdx < 0) distIdx = lower.findIndex((h) => h.includes('distance') || h.includes('activity') || h === 'value');
    if (tIdx < 0 || roiIdx < 0 || distIdx < 0) {
      // Maybe it is a wide ethoscope export: t + ROI columns.
      const g = buildGeneric(autoMapGeneric(text), { name: filename });
      g.format = 'ethoscope-csv';
      return g;
    }
    const threshold = opts.velocityThreshold ?? 1.0;
    const windowSeconds = opts.windowSeconds ?? 10;
    const grouped = new Map();
    for (let r = 1; r < rows.length; r++) {
      const roi = String(rows[r][roiIdx] ?? '').trim();
      if (!roi) continue;
      if (!grouped.has(roi)) grouped.set(roi, []);
      grouped.get(roi).push({
        t: Number(rows[r][tIdx]),
        d: Number(rows[r][distIdx])
      });
    }
    const series = {}, labels = {}, movingSeries = {};
    let nWindows = 0;
    for (const [roi, vals] of grouped) {
      vals.sort((a, b) => a.t - b.t);
      const n = vals.length;
      const t0 = vals[0].t;
      const dtSec = new Float64Array(n);
      const stepDist = new Float64Array(n);
      for (let i = 1; i < n; i++) {
        // t may be ms or s; infer from total span
        const scale = (vals[n - 1].t - t0) > 1e6 ? 1000 : 1;
        dtSec[i] = Math.max(1e-6, (vals[i].t - vals[i - 1].t) / scale);
        stepDist[i] = Math.pow(10, vals[i].d / 1000);
      }
      const mv = movingFromDistance(stepDist, dtSec, threshold, windowSeconds);
      const key = 'ROI ' + roi.replace(/^ROI[_\s]*/i, '');
      series[key] = mv.windows.map((w) => w.distance);
      labels[key] = key;
      movingSeries[key] = mv.moving;
      nWindows = Math.max(nWindows, mv.windows.length);
    }
    return {
      kind: 'wide',
      format: 'ethoscope-csv',
      name: filename || 'Ethoscope.csv',
      times: Array.from({ length: nWindows }, (_, i) => i * windowSeconds / 3600),
      start: null,
      startClockHour: opts.startClockHour ?? 0,
      light: null,
      series,
      moving: movingSeries,
      keys: Object.keys(series),
      labels,
      binMinutes: windowSeconds / 60,
      meta: { threshold, windowSeconds }
    };
  }

  /* ============================ file reading ============================ */
  async function readFileAsText(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
      reader.readAsText(file);
    });
  }
  async function readFileAsArrayBuffer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function parseFile(file, opts = {}) {
    const name = file.name || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      if (typeof global.XLSX === 'undefined') throw new Error('Excel support is not available; save the sheet as CSV and upload that.');
      const buf = await readFileAsArrayBuffer(file, opts.onProgress);
      const wb = global.XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const text = global.XLSX.utils.sheet_to_csv(ws);
      return { ...parseText(text, name, opts), excelText: text };
    }
    if (ext === 'db' || ext === 'sqlite' || ext === 'sqlite3') {
      const buf = await readFileAsArrayBuffer(file, opts.onProgress);
      return parseEthoscopeDb(buf, name, opts);
    }
    const text = await readFileAsText(file, opts.onProgress);
    return parseText(text, name, opts);
  }

  function parseText(text, name, opts = {}) {
    const lower = (name || '').toLowerCase();
    const head = text.slice(0, 4000);
    if (/\.db$|\.sqlite/.test(lower)) throw new Error('SQLite files must be read as binary.');
    if (/"RUNTIME"/i.test(head) || (/Info/i.test(head) && /Zantiks/i.test(head)) ||
        (/^\s*\d+(?:\.\d+)?,\s*"?Info"?,/m.test(head) && /RUNTIME/i.test(head))) {
      return parseZantiks(text, name);
    }
    if (/xy_dist_log10x1000/i.test(head)) return parseEthoscopeCsv(text, name, opts);
    if (/\.txt$|\.dat$/i.test(lower)) return parseDam(text, name, opts);
    // A tab-separated file with date/time and many numeric columns is DAM.
    const firstLines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3);
    if (firstLines.length && /\t/.test(firstLines[0]) && /\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}/.test(firstLines[0]) && !/RUNTIME/i.test(firstLines[0])) {
      return parseDam(text, name, opts);
    }
    const map = autoMapGeneric(text);
    const ds = buildGeneric(map, { name });
    ds.genericMap = map;
    return ds;
  }

  /* ============================ canonical dataset ============================ */
  /**
   * Regularise a wide dataset to a fixed grid.
   * @param {object} ds parsed wide dataset
   * @param {object} settings { binMin, lightOnOverride, cycleLength }
   * @returns {object} regularised dataset
   */
  function regularise(ds, settings = {}) {
    // Never upsample: a 1-min target cannot create information from 5-min data.
    const binMin = Math.max(settings.binMin || 1, ds.binMinutes || 0, 1e-9);
    const binMs = binMin * 60000;
    const isDate = ds.times && ds.times[0] instanceof Date;
    let startMs;
    if (isDate) startMs = ds.times[0].getTime();
    else if (ds.times && ds.times.length) startMs = 0;
    else startMs = 0;
    const nRaw = ds.times ? ds.times.length : 0;
    if (!nRaw) throw new Error('The dataset has no time points.');
    let endMs;
    if (isDate) endMs = ds.times[nRaw - 1].getTime();
    else endMs = ds.times[nRaw - 1] * 3600000;
    const nBins = Math.max(1, Math.floor((endMs - startMs) / binMs) + 1);
    if (nBins > 2_000_000) {
      throw new Error(`The regular grid would contain ${nBins.toLocaleString()} bins. Check the time column and time-unit mapping (a 1-minute file should span hours, not hundreds of thousands of hours).`);
    }

    const binIndex = new Int32Array(nRaw);
    for (let i = 0; i < nRaw; i++) {
      const rel = isDate ? (ds.times[i].getTime() - startMs) : (ds.times[i] * 3600000);
      binIndex[i] = Math.max(0, Math.min(nBins - 1, Math.floor(rel / binMs)));
    }

    const light = new Array(nBins).fill(null);
    const lightCount = new Array(nBins).fill(0);
    if (ds.light) {
      for (let i = 0; i < nRaw; i++) {
        const b = binIndex[i];
        const v = ds.light[i];
        if (v === 0 || v === 1) {
          light[b] = (light[b] || 0) + v;
          lightCount[b]++;
        }
      }
      for (let b = 0; b < nBins; b++) {
        if (lightCount[b]) light[b] = light[b] / lightCount[b] >= 0.5 ? 1 : 0;
        else light[b] = null;
      }
    }

    const series = {};
    const moving = {};
    const keys = ds.keys || Object.keys(ds.series || {});
    for (const key of keys) {
      const raw = ds.series[key];
      const vals = new Array(nBins).fill(NaN);
      const counts = new Array(nBins).fill(0);
      for (let i = 0; i < nRaw; i++) {
        const v = raw ? raw[i] : NaN;
        if (!Number.isFinite(v)) continue;
        const b = binIndex[i];
        if (!Number.isFinite(vals[b])) vals[b] = 0;
        vals[b] += v;
        counts[b]++;
      }
      // If target bin is smaller than the source, averaging is safer than
      // duplicating; if it is larger, summing is the correct aggregation.
      if (ds.binMinutes && ds.binMinutes > binMin * 1.01) {
        for (let b = 0; b < nBins; b++) if (counts[b] > 0) vals[b] /= counts[b];
      }
      series[key] = vals;
      if (ds.moving && ds.moving[key]) {
        const mv = new Uint8Array(nBins);
        const seen = new Uint8Array(nBins);
        for (let i = 0; i < nRaw; i++) {
          const b = binIndex[i];
          if (ds.moving[key][i]) { mv[b] = 1; seen[b] = 1; }
          else seen[b] = 1;
        }
        moving[key] = { moving: mv, seen };
      }
    }

    // Convert times to hours and clock hours.
    const tHours = new Array(nBins);
    for (let b = 0; b < nBins; b++) tHours[b] = b * binMin / 60;
    const startClockHour = ds.startClockHour !== undefined && ds.startClockHour !== null
      ? ds.startClockHour
      : (isDate ? ds.times[0].getHours() + ds.times[0].getMinutes() / 60 : 0);
    const clock = tHours.map((t) => ((startClockHour + t) % 24 + 24) % 24);

    return {
      ...ds,
      binMinutes: binMin,
      nBins,
      tHours,
      clock,
      light,
      series,
      moving,
      startClockHour,
      startDate: ds.start || (isDate ? ds.times[0] : null)
    };
  }

  /* ============================ lights-on / ZT / CT ============================ */
  function inferLightsOn(reg, override) {
    let overrideHours = NaN;
    if (typeof override === 'string' && override.includes(':')) overrideHours = C.parseClock(override, NaN);
    else if (override !== null && override !== undefined && override !== '') overrideHours = Number(override);
    if (Number.isFinite(overrideHours)) {
      return { clock: overrideHours, source: 'user' };
    }
    // Find a 0 → 1 transition in the light column.
    const n = reg.light.length;
    for (let i = 1; i < n; i++) {
      if (reg.light[i] === 1 && reg.light[i - 1] === 0) {
        return { clock: reg.clock[i], index: i, source: 'light column' };
      }
    }
    // Fallback: first light bin.
    for (let i = 0; i < n; i++) if (reg.light[i] === 1) return { clock: reg.clock[i], index: i, source: 'first light bin' };
    return { clock: reg.startClockHour || 0, index: 0, source: 'recording start' };
  }

  function addCircadianTime(reg, settings = {}) {
    const cycle = settings.cycleLength || 24;
    const lightsOn = inferLightsOn(reg, settings.lightsOn);
    const zt = new Array(reg.nBins);
    const day = new Array(reg.nBins);
    for (let i = 0; i < reg.nBins; i++) {
      let z = ((reg.clock[i] - lightsOn.clock) % cycle + cycle) % cycle;
      zt[i] = z;
      day[i] = Math.floor(((reg.clock[i] - lightsOn.clock) % cycle + cycle) % cycle === z ? (reg.tHours[i] + (reg.startClockHour - lightsOn.clock)) / cycle : 0);
      // day index should be continuous from the first ZT0 at or before the start
      const elapsed = reg.tHours[i] + (reg.startClockHour - lightsOn.clock);
      day[i] = Math.floor(elapsed / cycle) + 1;
    }
    // CT: projected subjective dawn from the last lights-on before DD.
    // In LD, CT = ZT. In DD, CT advances from the last lights-on.
    const ct = new Array(reg.nBins);
    let lastOn = null;
    for (let i = 1; i < reg.nBins; i++) {
      if (reg.light[i] === 1 && reg.light[i - 1] === 0) lastOn = i;
    }
    for (let i = 0; i < reg.nBins; i++) {
      const isDD = reg.light[i] === 0 || reg.light[i] === null;
      if (isDD && lastOn !== null && i > lastOn) {
        ct[i] = ((reg.tHours[i] - reg.tHours[lastOn]) % cycle + cycle) % cycle;
      } else {
        ct[i] = zt[i];
      }
    }
    reg.zt = zt;
    reg.ct = ct;
    reg.day = day;
    reg.lightsOn = lightsOn;
    reg.cycleLength = cycle;
    return reg;
  }

  function classifyDayPhases(reg) {
    const map = new Map();
    const nBins = reg.nBins || (reg.day ? reg.day.length : 0);
    for (let i = 0; i < nBins; i++) {
      const d = reg.day[i];
      if (!map.has(d)) map.set(d, { day: d, n: 0, light: 0, dark: 0, missing: 0 });
      const rec = map.get(d);
      rec.n++;
      if (reg.light[i] === 1) rec.light++;
      else if (reg.light[i] === 0) rec.dark++;
      else rec.missing++;
    }
    const out = [];
    for (const [d, rec] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
      const valid = rec.light + rec.dark;
      const fracLight = valid ? rec.light / valid : 0;
      let phase = 'LD';
      if (valid === 0) phase = 'unknown';
      else if (fracLight < 0.02) phase = 'DD';
      else if (fracLight > 0.98) phase = 'LL';
      out.push({ ...rec, fracLight, phase });
    }
    return out;
  }

  /* ============================ animal assembly ============================ */
  /**
   * Build animal records from a regularised dataset.
   * @param {object} reg
   * @param {Array} configs [{key, id, group, sex, treatment, include, ...}]
   * @param {object} settings
   */
  function assembleAnimals(reg, configs, settings = {}) {
    const byKey = new Map(configs.map((c) => [c.key, c]));
    const animals = [];
    for (const key of Object.keys(reg.series)) {
      const cfg = byKey.get(key) || { key, id: key, group: 'All', include: true };
      if (cfg.include === false) continue;
      const labels = reg.labels || {};
      const animal = {
        id: cfg.id || key,
        key,
        label: labels[key] || key,
        file: reg.name,
        format: reg.format || reg.kind,
        channel: cfg.channel ?? null,
        well: cfg.well ?? key,
        group: cfg.group || 'All',
        genotype: cfg.genotype || '',
        sex: cfg.sex || '',
        treatment: cfg.treatment || '',
        replicate: cfg.replicate || '',
        experiment: cfg.experiment || '',
        startDateTime: cfg.startDateTime || null,
        stopDateTime: cfg.stopDateTime || null,
        condition: cfg.condition || '',
        metadata: cfg.metadata || {},
        include: true,
        activity: reg.series[key],
        moving: reg.moving && reg.moving[key] ? reg.moving[key].moving : null,
        movingSeen: reg.moving && reg.moving[key] ? reg.moving[key].seen : null,
        light: reg.light,
        tHours: reg.tHours,
        clock: reg.clock,
        zt: reg.zt,
        ct: reg.ct,
        day: reg.day,
        binMinutes: reg.binMinutes,
        nBins: reg.nBins,
        startDate: reg.startDate,
        formatMeta: reg.meta || {},
        flags: [],
        deadFrom: null,
        deadDay: null,
        alive: true
      };
      if (cfg.metadata && !cfg.genotype) animal.flags.push('metadata genotype missing');
      // QC: dead run detection
      const deadHours = settings.deadHours ?? 24;
      const deadBins = Math.round(deadHours * 60 / reg.binMinutes);
      const dead = detectDeadRun(animal.activity, deadBins);
      if (dead) {
        animal.deadFrom = dead.start;
        animal.deadDay = animal.day[dead.start];
        animal.alive = false;
        animal.flags.push(`No activity for ≥ ${deadHours} h from day ${animal.deadDay}`);
      }
      // QC: missing fraction over the selected window (entire record for now)
      const nMiss = animal.activity.filter((v) => !C.isNum(v)).length;
      animal.missingFraction = nMiss / Math.max(1, animal.activity.length);
      if (animal.missingFraction > (settings.maxMissing ?? 0.10)) {
        animal.flags.push(`${(animal.missingFraction * 100).toFixed(1)}% missing data`);
      }
      // QC: low activity
      const meanPerDay = C.mean(animal.activity.filter(C.isNum)) * (1440 / reg.binMinutes);
      animal.meanActivityPerDay = meanPerDay;
      if (C.isNum(meanPerDay) && meanPerDay < (settings.lowActivity ?? 1)) {
        animal.flags.push(`Low activity (${meanPerDay.toFixed(2)} counts/day)`);
      }
      animals.push(animal);
    }
    return animals;
  }

  function detectDeadRun(activity, deadBins) {
    let run = 0;
    for (let i = 0; i < activity.length; i++) {
      if (activity[i] === 0) {
        run++;
        if (run >= deadBins) return { start: i - run + 1, end: i };
      } else if (C.isNum(activity[i])) {
        run = 0;
      } else {
        // missing data does not count as death
        run = 0;
      }
    }
    return null;
  }

  function dayPhaseMap(animals) {
    const map = new Map();
    for (const a of animals) {
      if (!map.has(a.id)) {
        map.set(a.id, new Map(classifyDayPhases(a).map((d) => [d.day, d.phase])));
      }
    }
    return map;
  }

  /**
   * Select bins in the analysis window for one animal.
   * @returns {Uint8Array} mask
   */
  function analysisMask(animal, settings, phaseMap) {
    const startDay = settings.startDay || 1;
    const endDay = settings.endDay || Infinity;
    const phase = settings.phase || 'ALL';
    let phases = phaseMap;
    // dayPhaseMap() returns a map of animal id -> (day -> phase); accept
    // either that or a direct day -> phase map.
    if (phases && typeof phases.get === 'function') {
      const perAnimal = phases.get(animal.id);
      if (perAnimal && typeof perAnimal.get === 'function') phases = perAnimal;
    }
    if (!phases) phases = new Map(classifyDayPhases(animal).map((d) => [d.day, d.phase]));
    const mask = new Uint8Array(animal.activity.length);
    for (let i = 0; i < mask.length; i++) {
      const d = animal.day[i];
      if (d < startDay || d > endDay) continue;
      if (animal.deadFrom !== null && i >= animal.deadFrom) continue;
      if (phase !== 'ALL') {
        const p = phases.get(d);
        const phaseValue = p && typeof p === 'object' && !Array.isArray(p) ? p.phase : p;
        if (phaseValue !== phase) continue;
      }
      mask[i] = 1;
    }
    return mask;
  }

  function maskStats(animal, mask) {
    let n = 0, miss = 0, sum = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      n++;
      const v = animal.activity[i];
      if (!C.isNum(v)) miss++;
      else sum += v;
    }
    return { n, missing: miss, missingFraction: n ? miss / n : NaN, sum };
  }

  /* ============================ metadata CSV ============================ */
  function parseMetadata(text) {
    const parsed = C.csvParse(text);
    if (parsed.rows.length < 2) throw new Error('Metadata needs a header and at least one row.');
    const header = parsed.rows[0].map((h) => String(h ?? '').replace(/^\uFEFF/, '').trim());
    const lower = header.map((h) => h.toLowerCase());
    const rows = [];
    for (let r = 1; r < parsed.rows.length; r++) {
      const obj = {};
      for (let c = 0; c < header.length; c++) obj[header[c]] = String(parsed.rows[r][c] ?? '').trim();
      rows.push(obj);
    }
    const find = (patterns) => {
      for (const p of patterns) {
        const i = lower.findIndex((h) => p.test(h));
        if (i >= 0) return header[i];
      }
      return null;
    };
    const genotype = find([/genotype/, /genotype.?id/, /strain/, /allele/, /^line$/, /line.?id/]);
    return {
      header, rows,
      suggested: {
        file: find([/^file$/, /file.?name/, /monitor/, /source/]),
        channel: find([/channel/, /region.?id/, /^roi$/, /well/]),
        id: find([/animal.?id/, /fly.?id/, /subject/, /^id$/, /name/]),
        genotype,
        group: find([/^group$/, /experimental.?group/, /cohort/, /condition/, /treatment/]) || genotype,
        sex: find([/sex/, /gender/]),
        treatment: find([/treatment/, /condition/, /drug/, /diet/]),
        well: find([/well/, /arena/, /chamber/]),
        replicate: find([/replicate/, /^rep$/, /block/]),
        experiment: find([/^exp$/, /experiment/]),
        start: find([/start.?datetime/, /start.?time/, /^start$/]),
        stop: find([/stop.?datetime/, /stop.?time/, /^stop$/])
      }
    };
  }

  function suggestMetadataMapping(meta) {
    const s = meta && meta.suggested ? meta.suggested : {};
    return {
      file: s.file || null,
      channel: s.channel || null,
      id: s.id || null,
      group: s.group || null,
      genotype: s.genotype || null,
      sex: s.sex || null,
      treatment: s.treatment || null,
      well: s.well || null,
      replicate: s.replicate || null,
      experiment: s.experiment || null,
      start: s.start || null,
      stop: s.stop || null
    };
  }

  /**
   * Apply metadata rows to configs by file+channel or animal ID.
   */
  function applyMetadata(configs, meta, mapping) {
    if (!meta || !mapping) return configs;
    const rows = meta.rows;
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    const normKey = (v) => {
      const s = norm(v);
      return /^-?\d+(?:\.0+)?$/.test(s) ? String(Number(s)) : s;
    };
    const clean = (v) => {
      const s = String(v ?? '').trim();
      return /^(na|n\/a|null|none|\.|-)$/i.test(s) ? '' : s;
    };
    const normFile = (v) => norm(v).replace(/\.[a-z0-9]+$/, '');
    const metadataFiles = mapping.file
      ? [...new Set(rows.map((r) => clean(r[mapping.file])).filter(Boolean))]
      : [];
    const dataFiles = [...new Set(configs.map((c) => c.file).filter(Boolean))];
    const rowMatches = (cfg, r, ignoreFile) => {
      const idVal = mapping.id ? normKey(r[mapping.id]) : '';
      const chVal = mapping.channel ? normKey(r[mapping.channel]) : '';
      const wellVal = mapping.well ? normKey(r[mapping.well]) : '';
      const fileVal = mapping.file ? norm(r[mapping.file]) : '';
      const cfgCh = normKey(cfg.channel ?? cfg.well ?? cfg.key);
      const cfgWell = normKey(cfg.well);
      const cfgFile = norm(cfg.file ?? '');
      const idMatch = idVal && (idVal === normKey(cfg.id) || idVal === normKey(cfg.key) || idVal === cfgWell);
      const chMatch = chVal && (chVal === cfgCh || chVal === cfgWell ||
        chVal.replace(/^ch/, '') === cfgCh.replace(/^ch/, ''));
      const wellMatch = wellVal && wellVal === cfgWell;
      const fileMatch = ignoreFile || !mapping.file || !fileVal ||
        fileVal === cfgFile || normFile(fileVal) === normFile(cfgFile);
      return idMatch || ((chMatch || wellMatch) && fileMatch);
    };
    let matched = 0, genotyped = 0, fileFallback = 0;
    const matchedRows = new Set();
    for (const cfg of configs) {
      let hit = rows.find((r) => rowMatches(cfg, r, false)) || null;
      if (!hit && mapping.file) {
        // A renamed data file should not prevent a unique region/channel or
        // well match. Only use this fallback when exactly one metadata row fits.
        const candidates = rows.filter((r) => rowMatches(cfg, r, true));
        if (candidates.length === 1) {
          hit = candidates[0];
          fileFallback++;
        }
      }
      if (!hit) continue;
      matched++;
      matchedRows.add(hit);
      const genotype = mapping.genotype && hit[mapping.genotype] ? clean(hit[mapping.genotype]) : '';
      if (genotype) cfg.genotype = genotype;
      if (mapping.group && clean(hit[mapping.group])) cfg.group = clean(hit[mapping.group]);
      // If the metadata only supplies a genotype, use it as the grouping key
      // so every downstream analysis automatically groups by genotype.
      if (!cfg.genotype && mapping.group && /genotype|strain|allele|line/i.test(mapping.group)) {
        cfg.genotype = clean(hit[mapping.group]);
      }
      if ((!cfg.group || cfg.group === 'All') && cfg.genotype) cfg.group = cfg.genotype;
      if (mapping.sex && clean(hit[mapping.sex])) cfg.sex = clean(hit[mapping.sex]);
      if (mapping.treatment && clean(hit[mapping.treatment])) cfg.treatment = clean(hit[mapping.treatment]);
      if (mapping.well && clean(hit[mapping.well])) cfg.well = clean(hit[mapping.well]);
      if (mapping.replicate && clean(hit[mapping.replicate])) cfg.replicate = clean(hit[mapping.replicate]);
      if (mapping.experiment && clean(hit[mapping.experiment])) cfg.experiment = clean(hit[mapping.experiment]);
      const startCol = mapping.start || (meta.suggested && meta.suggested.start);
      const stopCol = mapping.stop || (meta.suggested && meta.suggested.stop);
      if (startCol && clean(hit[startCol])) cfg.startDateTime = clean(hit[startCol]);
      if (stopCol && clean(hit[stopCol])) cfg.stopDateTime = clean(hit[stopCol]);
      if (cfg.genotype) genotyped++;
      cfg.metadata = Object.assign({}, cfg.metadata, hit);
      cfg.include = !/dead|exclude|no/i.test(hit.observations || '') || /alive/i.test(hit.observations || '');
    }
    configs.metaStats = {
      matched,
      total: configs.length,
      metadataRows: rows.length,
      matchedRows: matchedRows.size,
      unmatched: configs.length - matched,
      genotyped,
      missingGenotype: matched - genotyped,
      metadataFiles,
      dataFiles,
      fileFallback
    };
    return configs;
  }

  /* ============================ config generation ============================ */
  function configsFromDam(dam, metadataMap) {
    const configs = [];
    for (let ch = 1; ch <= dam.nChannels; ch++) {
      const key = 'Ch' + ch;
      const label = 'Channel ' + ch;
      const cfg = { key, id: `${dam.file}_ch${ch}`, channel: ch, well: 'Ch' + ch, group: 'All', genotype: '', include: true, file: dam.file };
      if (metadataMap && metadataMap[ch]) Object.assign(cfg, metadataMap[ch]);
      configs.push(cfg);
    }
    return configs;
  }

  function configsFromWide(ds) {
    return (ds.keys || Object.keys(ds.series)).map((key, i) => ({
      key,
      id: key,
      channel: i + 1,
      well: ds.labels && ds.labels[key] ? ds.labels[key] : key,
      group: 'All',
      genotype: '',
      include: true,
      file: ds.name || ''
    }));
  }

  /* ============================ exports ============================ */
  global.Importers = {
    parseDam, parseZantiks, zantiksToDam, parseEthoscopeDb, parseEthoscopeCsv,
    autoMapGeneric, buildGeneric, parseFile, parseText, readFileAsText, readFileAsArrayBuffer,
    regularise, addCircadianTime, inferLightsOn, classifyDayPhases, dayPhaseMap, assembleAnimals,
    detectDeadRun, analysisMask, maskStats, parseMetadata, suggestMetadataMapping, applyMetadata,
    configsFromDam, configsFromWide, movingFromDistance, inferBinMinutes
  };
})(window);
