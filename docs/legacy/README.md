# Zantiks-to-Rethomics Behavioral Analyzer

A fully **client-side web application** that implements the complete workflow described in
[`zantiks_rethomics_app_spec.md`](zantiks_rethomics_app_spec.md): it converts raw **Zantiks MWP**
CSV output into standard **DAM** (Drosophila Activity Monitor) format and runs a Rethomics-style
analysis pipeline (actograms, sleep & activity profiles, box plots, statistics, and chi-square
periodograms) — entirely in the browser. No R server, no Python, no internet required (Plotly.js
is bundled locally).

This `docs/` folder is the single home for **both** the web application and its specification
documents.

## Quick start

1. Open [`index.html`](index.html) in any modern browser (Chrome, Edge, Firefox, Safari).
   - Double-click the file, or drag it into a browser window.
2. **Tab 1 (Data Conversion):** click **“🎲 Load sample Zantiks data”** to try the demo dataset,
   or drop in a real Zantiks CSV (e.g. `circadian_rhythms_glasgow-20250801T141426.csv`).
   Click **“Convert to DAM Format”** and download `DAM_file.txt` if needed.
3. **Tab 2 (Metadata Manager):** load the matching metadata CSV (sample or real), review the
   validation report, edit any cell directly, then click **“Link data & Run Analysis”**.
4. **Tabs 3–6:** render actograms, sleep/activity profiles, box plots + statistics, and
   periodograms. Every panel has its own controls (binning resolution, colour map, LD/DD phase,
   period range, alpha, …).
5. **Tab 7 (Export):** download publication figures (PNG / SVG @ 300 DPI), cleaned summary
   tables (`sleep_summary.csv`, `period_summary.csv`), the DAM file, and a self-contained HTML
   report.

> 💡 Because everything runs locally, no data ever leaves your machine.

## Documents

| File | Description |
|---|---|
| [`zantiks_rethomics_app_spec.md`](zantiks_rethomics_app_spec.md) | Full functional & technical specification (Markdown): input formats, DAM conversion algorithm, visualisations, statistics, UI architecture. |
| [`zantiks_rethomics_app_spec.json`](zantiks_rethomics_app_spec.json) | Machine-readable version of the specification (JSON). |
| [`zantiks_rethomics_app_spec.html`](zantiks_rethomics_app_spec.html) | Rendered HTML version of the specification (open in a browser). |

## Features

| Tab | What it does |
|-----|--------------|
| 1 · Data Conversion | Parses Zantiks header (`Execution start`, experiment, apparatus, unit), 24 channels (A1–D6), converts to the 42-column DAM tab-separated format (`round(distance × 1000)` scaling, light status, zero-padded channels 25–32). |
| 2 · Metadata Manager | Validates the 10 required columns, cross-checks `well` ⇄ `region_id`, datetime windows and missing values; interactive editable table; links metadata to the DAM channels. |
| 3 · Actograms | Individual (per fly) and average-group tile heatmaps; 1/5/15/30/60-min binning; Viridis/Magma/Plasma/Standard colour maps. |
| 4 · Sleep & Activity Profiles | Whole-experiment activity trajectory, 24-h wrapped sleep (fraction asleep) and activity profiles with automatic LD/dark shading; LD (entrainment) vs DD (free-running) vs all-days phase selection. |
| 5 · Box Plots & Statistics | Daily sleep (min/day), daily activity, bout count, mean bout duration — box + jitter plots; Shapiro–Wilk normality, Wilcoxon rank-sum (2 groups) or Kruskal-Wallis + Dunn post-hoc (Bonferroni). |
| 6 · Circadian Analysis | Chi-square periodogram (Sokolove & Bushell, 1978), peak period, power vs significance threshold, rhythmic/arrhythmic classification, per-genotype period distributions. |
| 7 · Export | PNG/SVG figures, summary CSVs, DAM file, HTML report. |

## Methods implemented (in-browser)

- **Sleep scoring:** a bin is sleep if it is part of a run of ≥ 5 consecutive minutes of zero
  activity (standard *Drosophila* definition).
- **Bout analysis:** maximal sleep runs → bout count and mean bout duration (min).
- **Daily summaries:** per-fly, per-complete-day `sleep_min_day`, `activity_day`,
  `bout_count_day`, `mean_bout_len_day`; box plots use per-fly means across complete days.
- **Chi-square periodogram:** `Qp(τ) = τ·Σ_j(P_j − M·x̄)² / S²` with `df = τ − 1` (τ in
  aggregation bins), periods expressed in hours (18–32 h default), 30-min internal aggregation.
  Monte-Carlo calibrated (type-I error ≈ α).
- **Statistics:** Shapiro-Wilk (exact port of `scipy.stats.shapiro` / Royston 1993),
  Mann-Whitney U / Wilcoxon rank-sum (normal approx., tie-corrected), Kruskal-Wallis H,
  Dunn's test with Bonferroni adjustment.

## File layout

```
docs/
├── README.md                  # this file (project index + user guide)
├── index.html                 # single-page UI (7 tabs) — open to launch the app
├── css/styles.css             # dark scientific theme
├── js/
│   ├── math.js                # gamma, chi-square & normal distributions, basic stats
│   ├── stats.js               # Shapiro-Wilk, Wilcoxon, Kruskal-Wallis, Dunn
│   ├── periodogram.js         # chi-square periodogram (Sokolove-Bushell)
│   ├── converter.js           # Zantiks CSV ⇄ DAM conversion
│   ├── metadata.js            # metadata parsing, validation & linking
│   ├── analysis.js            # sleep, bouts, summaries, 24-h profiles, phase detection
│   ├── colormaps.js           # viridis / magma / plasma / standard
│   ├── charts.js              # Plotly chart builders & export
│   ├── sampleData.js          # deterministic synthetic demo dataset
│   └── main.js                # app state & wiring
├── vendor/plotly.min.js       # bundled Plotly.js (works offline)
└── zantiks_rethomics_app_spec.{md,json,html}   # specification documents
```

## Using real data

1. **Zantiks CSV** — must contain the 4 `Info` header rows and a `RUNTIME,UNIT,TEMPERATURE,L_OR_D,DAY,HOUR,TIME_BIN,A1..D6` header, with `A1`–`D6` activity columns.
2. **Metadata CSV** — columns (order-independent):
   `file, start_datetime, stop_datetime, region_id, well, genotype, sex, replicate, exp, observations`.
   - `region_id` = channel (1–24), `well` = plate coordinate (A1–D6).
   - `start_datetime` / `stop_datetime` define each fly's analysis window (`YYYY-MM-DD HH:MM:SS`
     or `DD/MM/YYYY HH:MM:SS`).
   - `observations` can be used to include/exclude animals (`alive`/`dead`); all rows are
     currently included — edit the table to filter.
3. Datetimes in the DAM file are reconstructed from the `Date`/`Time` columns, so linking uses
   the absolute timestamps written during conversion.

## Troubleshooting

- **“Start datetime: unknown”** — the CSV header row must be `0,Info,<DATETIME>,Service '…' : Execution start`.
- **No flies linked** — check `region_id`/`well` consistency and that the metadata datetime
  windows overlap the DAM record.
- **Charts blank on a tab** — charts are rendered in the background and resized when you open
  the tab; if a panel is empty, re-run its “Render” button after switching to it.
- **Cache** — after updating files, hard-refresh (`Ctrl+F5`) so the browser reloads the JS.

## License / notes

Demo dataset is synthetic (deterministic seed) and intended for testing and teaching. Statistical
tests follow standard non-parametric practice; verify thresholds (e.g. α) suit your experimental
design.
