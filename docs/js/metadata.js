/* ============================================================================
 * metadata.js — experimental metadata parsing, validation & linking
 * Exposed globally as window.ZMetadata.
 * ==========================================================================*/
window.ZMetadata = (function () {
  'use strict';

  const C = window.ZConverter;

  const REQUIRED = ['file', 'start_datetime', 'stop_datetime', 'region_id',
    'well', 'genotype', 'sex', 'replicate', 'exp'];
  const OPTIONAL = ['observations'];

  /* ---------------- Generic CSV parsing (handles quoted fields) ---------------- */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (field.length > 0 || row.length > 0) row.push(field);
        if (row.some((c) => c.trim().length > 0)) rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
    }
    return rows;
  }

  /* ---------------- NA handling ---------------- */
  // Treat missing-value markers (NA, N/A, null, NaN, "-", …) as empty so they
  // are ignored downstream instead of becoming literal values / spurious groups.
  function cleanValue(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    return /^(na|n\/a|null|nan|none|-|#n\/a)$/i.test(s) ? '' : s;
  }

  function parseMetadataCsv(text) {
    const rows = parseCsv(text);
    if (!rows.length) return { columns: [], rows: [], errors: ['Empty file'] };
    const columns = rows[0].map((c) => c.trim().toLowerCase());
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const obj = {};
      for (let j = 0; j < columns.length; j++) obj[columns[j]] = cleanValue(rows[i][j]);
      data.push(obj);
    }
    return { columns, rows: data, errors: [] };
  }

  /* ---------------- Validation ---------------- */
  function validateMetadata(meta, dam) {
    const issues = [];
    const { columns, rows } = meta;

    for (const req of REQUIRED) {
      if (!columns.includes(req)) {
        issues.push({ severity: 'error', row: 0, msg: `Missing required column: "${req}"` });
      }
    }
    for (const opt of OPTIONAL) {
      if (!columns.includes(opt)) {
        issues.push({ severity: 'info', row: 0, msg: `Optional column "${opt}" not present — all animals included` });
      }
    }

    const seenWells = new Set();
    rows.forEach((r, i) => {
      const at = i + 2; // 1-based row incl. header
      if (r.well && r.region_id) {
        const ch = C.wellToChannel(r.well);
        if (ch !== null && ch !== parseInt(r.region_id, 10)) {
          issues.push({ severity: 'warning', row: at, msg: `Row ${at}: well ${r.well} maps to channel ${ch} but region_id is ${r.region_id}` });
        }
      }
      // genotype is essential (drives grouping); the rest are informational
      for (const col of ['genotype']) {
        if (r[col] === undefined || r[col] === '') {
          issues.push({ severity: 'warning', row: at, msg: `Row ${at}: missing "${col}"` });
        }
      }
      for (const col of ['sex', 'observations', 'exp', 'replicate']) {
        if (r[col] === undefined || r[col] === '') {
          issues.push({ severity: 'info', row: at, msg: `Row ${at}: "${col}" not specified (NA)` });
        }
      }
      const ch = parseInt(r.region_id, 10);
      if (r.region_id === '') {
        issues.push({ severity: 'info', row: at, msg: `Row ${at}: no region_id (NA) — row will be skipped` });
      } else if (!Number.isInteger(ch) || ch < 1 || ch > 24) {
        issues.push({ severity: 'error', row: at, msg: `Row ${at}: region_id "${r.region_id}" not a valid channel (1-24)` });
      } else {
        if (seenWells.has(r.well)) {
          issues.push({ severity: 'warning', row: at, msg: `Row ${at}: duplicate well ${r.well}` });
        }
        seenWells.add(r.well);
      }
      const start = r.start_datetime ? C.parseDatetimeRobust(r.start_datetime) : null;
      const stop = r.stop_datetime ? C.parseDatetimeRobust(r.stop_datetime) : null;
      if (start && stop && stop <= start) {
        issues.push({ severity: 'error', row: at, msg: `Row ${at}: stop_datetime before start_datetime` });
      }
    });

    return issues;
  }

  /* ---------------- Linking: metadata + DAM → ethogram ---------------- */
  /**
   * Builds the linked fly time series across 1 or more DAM monitor files.
   * @param {object} dam parsed DAM data or map of DAM monitor files ({'Monitor1.txt': dam1, ...})
   * @param {object} meta parsed metadata
   * @param {string} observationsFilter e.g. 'alive' ('' = all)
   * @returns {Array<object>} flies
   */
  function linkMetadata(dam, meta, observationsFilter) {
    const flies = [];
    const rows = meta.rows;

    const isMulti = dam && typeof dam === 'object' && !dam.rows;
    const damMap = isMulti ? dam : null;
    const defaultDam = isMulti ? damMap[Object.keys(damMap)[0]] : dam;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ch = parseInt(r.region_id, 10);
      if (!Number.isInteger(ch) || ch < 1 || ch > 32) continue;
      if (observationsFilter && r.observations && r.observations !== observationsFilter) continue;

      let targetDam = defaultDam;
      if (isMulti && r.file) {
        targetDam = damMap[r.file] || damMap[Object.keys(damMap).find(k => k.toLowerCase() === r.file.toLowerCase())] || defaultDam;
      }

      if (!targetDam || !targetDam.rows) continue;

      let start = r.start_datetime ? C.parseDatetimeRobust(r.start_datetime) : null;
      let stop = r.stop_datetime ? C.parseDatetimeRobust(r.stop_datetime) : null;
      if (!start && targetDam.startDatetime) start = targetDam.startDatetime;
      if (!stop && targetDam.endDatetime) stop = targetDam.endDatetime;
      if (!start || !stop) continue;

      // collect bins in window
      const tHours = [];
      const todHours = [];
      const dayIdx = [];
      const activity = [];
      const light = [];
      const timestamps = [];
      for (const drow of targetDam.rows) {
        const ts = drow.timestamp;
        if (!ts || ts < start || ts > stop) continue;
        const a = drow.channels[ch - 1];
        if (!Number.isFinite(a)) continue;
        const hrs = (ts - start) / 3600000;
        tHours.push(hrs);
        todHours.push(ts.getHours() + ts.getMinutes() / 60);
        dayIdx.push(Math.floor(hrs / 24));
        activity.push(a);
        light.push(drow.light);
        timestamps.push(ts);
      }

      if (activity.length === 0) continue;

      const flyFile = r.file || targetDam.file || 'DAM';
      const id = `${flyFile}_${r.genotype || '?'}_ch${ch}_${i + 1}`;
      const hasLight = light.some((l) => l === 1);
      const hasDark = light.some((l) => l === 0);
      flies.push({
        id,
        file: flyFile,
        well: r.well || C.channelToWell(ch) || ('ch' + ch),
        regionId: ch,
        genotype: r.genotype || 'CTRL',
        sex: r.sex || 'NA',
        replicate: r.replicate || 1,
        exp: r.exp || 'Exp1',
        observations: r.observations || 'alive',
        start, stop,
        binMinutes: targetDam.binMinutes || 1,
        tHours, todHours, dayIdx, activity, light, timestamps,
        ldSchedule: (hasLight && hasDark) ? 'LD' : (hasDark ? 'DD' : 'LL')
      });
    }
    return flies;
  }

  return {
    REQUIRED,
    parseCsv,
    cleanValue,
    parseMetadataCsv,
    validateMetadata,
    linkMetadata
  };
})();
