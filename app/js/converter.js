/* ============================================================================
 * converter.js — Zantiks CSV ⇄ DAM text-file conversion
 * Implements the Data Conversion Module from the specification.
 * Exposed globally as window.ZConverter.
 * ==========================================================================*/
window.ZConverter = (function () {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------------- Well ⇄ channel mapping (A1..D6 → 1..24) ---------------- */
  function wellToChannel(well) {
    const m = /^([A-Da-d])([1-6])$/.exec(String(well || '').trim());
    if (!m) return null;
    const rowIdx = m[1].toUpperCase().charCodeAt(0) - 65; // A=0..D=3
    return rowIdx * 6 + parseInt(m[2], 10);
  }
  function channelToWell(ch) {
    ch = parseInt(ch, 10);
    if (ch < 1 || ch > 24) return null;
    const row = String.fromCharCode(65 + Math.floor((ch - 1) / 6));
    const col = ((ch - 1) % 6) + 1;
    return row + col;
  }

  /* ---------------- Generic CSV line splitter (handles quoted fields) ---------------- */
  // Splits one CSV line into cells, handling RFC-4180 style double-quoted fields
  // (e.g. "RUNTIME","A1") and "" escapes. Works for unquoted fields too.
  function splitCsvLine(line) {
    const cells = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    cells.push(field);
    return cells;
  }

  /* ---------------- Robust date parsing ---------------- */
  function parseDatetimeRobust(str) {
    if (!str) return null;
    str = String(str).trim();
    // ISO: 2025-08-01T14:14:26 or 2025-08-01 14:14:26
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(str);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
    }
    // UK: 01/08/2025 14:14[:26]
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(str);
    if (m) {
      return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], m[6] ? +m[6] : 0);
    }
    // US: 08/01/2025? ambiguous — treat as DD/MM/YYYY unless clearly US
    m = /^(\d{1,2})-(\d{1,2})-(\d{4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(str);
    if (m) {
      return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], m[6] ? +m[6] : 0);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateDDMMMYY(date) {
    return String(date.getDate()).padStart(2, '0') + ' ' + MONTHS[date.getMonth()] + ' ' +
      String(date.getFullYear() % 100).padStart(2, '0');
  }
  function formatTimeHHMMSS(date) {
    return String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0') + ':' +
      String(date.getSeconds()).padStart(2, '0');
  }

  /* ---------------- Precise start time from the filename ---------------- */
  // Zantiks export names embed the precise execution start, e.g.
  //   circadian_rhythms_glasgow-20250811T122344.csv  →  2025-08-11 12:23:44
  // The header datetime is rounded to the minute (e.g. "11/08/2025 12:23"),
  // so it can be up to ~59 s off. Prefer the filename timestamp when present.
  function filenameTimestamp(filename) {
    if (!filename) return null;
    const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(filename));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ---------------- Zantiks CSV parsing ---------------- */
  /**
   * @param {string} text raw CSV contents
   * @param {string} filename optional source filename (used for precise start time)
   * @returns {object} { info: {...}, columns: [...], rows: [...] }
   */
  function parseZantiksCsv(text, filename) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const info = {
      startDatetime: null, startStr: '', service: '', expName: '',
      apparatus: '', unitId: ''
    };

    let headerLineIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const cells = splitCsvLine(lines[i]);
      if (cells.length >= 3 && cells[1] === 'Info') {
        const key = cells[2];
        const val = cells.slice(3).join(',').trim();
        if (/execution start/i.test(val)) {
          // Row 1: 0,Info,<START_DATETIME>,Service '<SERVICE_NAME>' : Execution start
          info.startStr = key;
          info.startDatetime = parseDatetimeRobust(key);
          const svc = /'([^']+)'/.exec(val);
          if (svc) info.service = svc[1];
        } else if (/subject identification/i.test(key)) {
          info.expName = val;
        } else if (/apparatus/i.test(key)) {
          info.apparatus = val;
        } else if (/unit id/i.test(key)) {
          info.unitId = val;
        }
      } else if (cells.length >= 8 && /RUNTIME/i.test(cells[0])) {
        headerLineIdx = i;
        break;
      }
    }

    if (headerLineIdx === -1) {
      // fallback: assume first line is header
      headerLineIdx = 0;
    }

    // Prefer the precise start time embedded in the filename (seconds precision)
    // when the header datetime is minute-precision and consistent with it.
    const fnStart = filenameTimestamp(filename);
    if (fnStart) {
      const headerHasSeconds = /(^|[ T])\d{1,2}:\d{2}:\d{2}(\D|$)/.test(info.startStr);
      if (!info.startDatetime) {
        info.startDatetime = fnStart;
        info.startFromFilename = true;
      } else if (!headerHasSeconds && Math.abs(fnStart - info.startDatetime) / 1000 <= 90) {
        info.startDatetime = fnStart;
        info.startFromFilename = true;
      }
    }

    const header = splitCsvLine(lines[headerLineIdx]).map((h) => h.trim());
    const activityCols = header.filter((h) => /^[A-D][1-6]$/i.test(h));
    // precompute column indices once (fast for very large files)
    const colIndex = {};
    for (let i = 0; i < header.length; i++) colIndex[header[i]] = i;
    const activityIdx = activityCols.map((c) => colIndex[c]);

    const rows = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      if (cells.length < 8) continue;
      const row = {
        runtime: parseFloat(cells[0]),
        unit: cells[1],
        temperature: parseFloat(cells[2]),
        lOrD: cells[3],
        day: parseInt(cells[4], 10),
        hour: parseFloat(cells[5]),
        timeBin: parseInt(cells[6], 10),
        channels: []
      };
      for (let ci = 0; ci < activityIdx.length; ci++) {
        const idx = activityIdx[ci];
        row.channels.push(idx >= 0 && idx < cells.length ? parseFloat(cells[idx]) : 0);
      }
      rows.push(row);
    }

    return { info, columns: header, activityCols, rows };
  }

  /* ---------------- Zantiks → DAM conversion ---------------- */
  /**
   * Builds the 42-column tab-separated DAM text file.
   * @param {object} parsed result of parseZantiksCsv
   * @returns {string}
   */
  function convertToDam(parsed) {
    const { info, rows, activityCols } = parsed;
    const start = info.startDatetime || new Date(0);

    const lines = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const t = new Date(start.getTime() + r.runtime * 1000);
      const cols = [
        String(i + 1),
        formatDateDDMMMYY(t),
        formatTimeHHMMSS(t),
        /light/i.test(r.lOrD) ? '1' : '0',
        '0', '1', '0',      // cols 5-7 control flags
        '0', '0', '0'       // cols 8-10 environment
      ];
      // channels 1-24 (scaled: round(distance * 1000))
      for (const v of r.channels) {
        cols.push(String(Math.round((Number.isFinite(v) ? v : 0) * 1000)));
      }
      // channels 25-32 zero padded
      for (let c = r.channels.length; c < 24; c++) cols.push('0');
      for (let c = 24; c < 32; c++) cols.push('0');
      lines.push(cols.join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  /* ---------------- DAM text parsing ---------------- */
  /**
   * @param {string} text DAM tab-separated content
   * @returns {object} { file, nRows, startDatetime, endDatetime, rows, channels: 24, metadata }
   */
  function parseDam(text, filename) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows = [];
    for (const line of lines) {
      const cells = line.split(/\t+/);
      if (cells.length < 34) continue;
      const channels = [];
      for (let c = 10; c < 34; c++) {
        channels.push(parseInt(cells[c], 10) || 0);
      }
      rows.push({
        index: parseInt(cells[0], 10) || 0,
        date: cells[1],
        time: cells[2],
        light: parseInt(cells[3], 10) || 0,
        timestamp: parseDamTimestamp(cells[1], cells[2]),
        channels
      });
    }
    let start = null;
    let end = null;
    for (const r of rows) {
      if (r.timestamp) {
        if (!start || r.timestamp < start) start = r.timestamp;
        if (!end || r.timestamp > end) end = r.timestamp;
      }
    }
    return {
      file: filename || 'DAM_file.txt',
      nRows: rows.length,
      startDatetime: start,
      endDatetime: end,
      rows,
      channels: 24,
      binMinutes: inferBinMinutes(rows)
    };
  }

  function parseDamTimestamp(dateStr, timeStr) {
    const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/.exec(dateStr.trim());
    if (!m) return null;
    const month = MONTHS.indexOf(m[2].slice(0, 3));
    if (month < 0) return null;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const t = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(timeStr.trim());
    if (!t) return null;
    return new Date(year, month, parseInt(m[1], 10), parseInt(t[1], 10), parseInt(t[2], 10), t[3] ? parseInt(t[3], 10) : 0);
  }

  function inferBinMinutes(rows) {
    if (rows.length < 2) return 1;
    const a = rows[0].timestamp;
    const b = rows[1].timestamp;
    if (!a || !b) return 1;
    const diff = (b - a) / 60000; // minutes between rows
    if (!Number.isFinite(diff) || diff <= 0) return 1;
    // snap to common bin sizes
    const snaps = [1, 5, 10, 15, 30, 60];
    for (const s of snaps) {
      if (Math.abs(diff - s) < 0.5) return s;
    }
    // not a standard bin size — keep the true measured bin duration
    // (e.g. 1-second recording → 1/60 ≈ 0.0167 min per bin)
    return diff;
  }

  /* ---------------- download helper ---------------- */
  function downloadText(content, filename, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function downloadCsv(headers, rows, filename) {
    const esc = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const r of rows) lines.push(rows.map ? r.map(esc).join(',') : esc(r));
    downloadText(lines.join('\n'), filename, 'text/csv;charset=utf-8');
  }

  return {
    wellToChannel, channelToWell,
    parseDatetimeRobust,
    parseZantiksCsv,
    convertToDam,
    parseDam,
    downloadText, downloadCsv
  };
})();
