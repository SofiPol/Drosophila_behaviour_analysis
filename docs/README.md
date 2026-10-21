# Chronobiology Workbench

A static, browser-based workbench for circadian and sleep analysis of *Drosophila* and other behavioural time series. Import DAM monitors, Zantiks plates, ethoscope recordings or generic CSV/Excel tables, score sleep, estimate period with six independent methods, quantify phase and anticipation, and compare groups — all client-side.

**Live app (GitHub Pages):** `https://sofipol.github.io/Drosophila_behaviour_analysis/`

No build step. No server. No data leaves the browser.

---

## Quick start

### Open locally

1. Open `docs/index.html` in Chrome, Edge, Firefox or Safari.
2. Click **Load synthetic demo** and then **Build & analyse dataset** to explore every panel immediately.
3. To use your own data, drop a file into **01 Import** and follow the mapping prompts.

> For local files, the page works from `file://`; the optional Ethoscope SQLite reader may require a local HTTP server because browsers restrict WebAssembly loading from `file://`.

### Run a local server (recommended)

```bash
cd docs
python -m http.server 8000
```

Then open <http://localhost:8000>.

### Host on GitHub Pages

The repository is already laid out so that the `docs/` folder is a complete static site.

**Option A — deploy from the `docs/` folder**

1. Push the repository to GitHub.
2. Repository **Settings → Pages**.
3. **Build and deployment → Source:** *Deploy from a branch*.
4. **Branch:** `main` (or your default branch), **Folder:** `/docs`.
5. Save. The site is published at `https://<user>.github.io/<repo>/`.

**Option B — GitHub Actions**

A workflow is included at `.github/workflows/pages.yml`. Set **Settings → Pages → Source** to *GitHub Actions*, then push to `main`. The workflow uploads `docs/` as the Pages artifact.

---

## What the app does

| Section | Analysis |
|---|---|
| **01 Import** | DAM (24/32 channels, multiple monitors), Zantiks MWP, generic CSV/TSV/Excel (wide or long), ethoscope SQLite/CSV. Multiple behavioural files can be uploaded together; animal table, automatic metadata join (including genotype, experiment and replicate), QC flags and group assignment. |
| **02 Settings** | Analysis bin, cycle length, ZT0, phase window, sleep thresholds, dead/missing rules, period search range, rhythmic criteria, anticipation/onset parameters, rebound windows, display options. |
| **03 Overview** | KPIs, group summary, recording timeline, activity profile, QC table. |
| **04 Actograms** | Individual and group-average single/double-plotted bar actograms; dark-phase shading, period line, sleep actogram, custom binning and scaling. |
| **05 Profiles** | Activity, sleep, P(wake), P(doze), bout initiation/length, activity per awake minute; bars or lines, SEM/SD/95% CI, normalisation, circular view, raster. |
| **06 Sleep** | Standard ≥5-min sleep, bout categories (short/intermediate/long), latency, WASO, fragmentation, brief awakenings, P(wake)/P(doze), bout distribution, architecture by hour, rebound. |
| **07 Circadian** | Chi-square periodogram (Sokolove–Bushell), Lomb–Scargle, autocorrelation (RI/RS), FFT, cosinor and onset regression; consensus flags, population periodograms, synthetic validation and property tests. |
| **08 Phase** | IS, IV, M10, L5, relative amplitude, centre of gravity, acrophase, M/E peaks, onset/offset, day/night ratio, MAI/EAI anticipation indices. |
| **09 Statistics** | Shapiro–Wilk, Welch/Student t, Mann–Whitney, ANOVA, Kruskal–Wallis, Dunn, pairwise corrected tests, Fisher exact/chi-square, Cohen's d and rank-biserial effect sizes, profile permutation tests. |
| **10 Export** | Tidy CSVs (`animals_summary`, `time_series`, `bouts`, `periodograms`, `profiles`, `group_stats`, `phase_metrics`), figures PNG/SVG, HTML report, print-to-PDF and a ZIP package with `manifest.json`. |

Use the **Dark / Light** button in the header to switch theme; the choice is remembered in the browser. Charts use a near-square canvas and the vibrant Okabe–Ito-derived palette, with legends above the overview timeline and activity profile.

---

## Supported input formats

### DAM (TriKinetics)

Standard tab-separated monitor files with a date, time, light status and 24 or 32 channel columns. The parser detects the metadata width and light column automatically. Multiple files with the same time grid are merged; animal IDs become `Monitor:Channel`.

### Zantiks MWP

Quoted CSV with `RUNTIME`, `UNIT`, `TEMPERATURE`, `L_OR_D`, `DAY`, `HOUR`, `TIME_BIN`, `A1…D6`. The app parses large files line-by-line, preserves the original values, and can download a standard 32-channel DAM file (values ×1000).

### Generic CSV/TSV/Excel

- **Wide:** one row per time point and one numeric column per animal.
- **Long:** columns for time, animal ID and value.
- Mapping controls let you choose the time/timestamp column, time unit, light column and animal columns. Excel sheets are read with SheetJS.

### Ethoscope

- **SQLite `.db`:** `ROI_1…ROI_n` tables are read with sql.js. Movement is the maximum velocity in 10 s windows above the threshold; activity is summed distance.
- **CSV export:** long format with `t`, ROI and `xy_dist_log10x1000`.

### Metadata

Upload a CSV with one row per animal. The app automatically detects and links metadata by **file/monitor**, **channel/well/ROI** or **animal ID**. Genotype is carried through to the animal table, exports, group summaries and the statistics grouping menu; group, sex and treatment are linked at the same time. If a metadata file has a genotype but no separate group, genotype becomes the grouping variable.

Use the `exp` column to name an experiment and `replicate` to name a replicate. If `exp` is blank, the source filename is used as the experiment label. Multiple files may be selected together in **Upload data**; they are combined into one analysis table when they share the same bin size and start clock. Different experiment dates and durations are supported, and missing tails are padded with missing values.

The **Data scope** bar below the navigation lets you tick any combination of experiments and replicates. Leaving all boxes ticked combines everything; untick an outlier experiment or replicate to exclude it from every graph and statistic. The scope is recorded in the manifest. The animal table also shows editable **Experiment** and **Replicate** columns.

A typical file can use the lab format:

```csv
file,start_datetime,stop_datetime,region_id,sex,genotype,replicate,well,exp,observations
DAM-like.txt,2026-10-08 08:00:00,2026-10-17 08:00:00,1,male,CTRL-7D,,A1,,
```

`region_id` is used as the channel/well join key; `well` supplies the arena label; and `start_datetime` / `stop_datetime`, `replicate` and `exp` are preserved on the animal record and in the manifest. Values of `NA`, `N/A`, `none` and `.` are treated as missing. The minimum useful columns are a join key (`file`, `region_id`/`channel`, `well` or `animal_id`) plus `genotype`. Use the mapping controls to correct a join or add an experimental group; the match count and any missing genotypes are shown immediately. Metadata can be uploaded before or after the behavioural files and is applied automatically when the dataset is used. You can also edit genotype, group, sex and treatment directly in the animal table.

---

## Scientific notes

- Sleep is ≥5 consecutive minutes of immobility, assigned retroactively from the start of the run (Hendricks 2000; Shaw 2000).
- Day/night summaries use the light column in LD. In DD, “day” and “night” are the projected subjective day (CT 0–12) and night (CT 12–24), not the light value.
- Chi-square power is \(Q_p - Q_p^{threshold}\). The strict rhythmic flag requires power ≥ 10 and peak width ≥ 2 h; the significant-peak column is reported separately.
- The full formulas, parameters, defaults and references are in [`METHODS.md`](METHODS.md).
- The application is a research tool, not a validated clinical device. Verify thresholds and methods against the original references before publication.
- The interface follows the Ethogram visual language: a black-and-white scientific surface, Bricolage Grotesque labels, Source Serif 4 body text, red for the current selection and Okabe–Ito colours for data categories.

---

## Project structure

```
docs/
├── index.html                  # single-page application
├── README.md                   # this guide
├── METHODS.md                  # formulas, parameters, references
├── TECHNICAL_SPEC.md           # full technical specification
├── TECHNICAL_SPEC.json         # machine-readable specification
├── css/styles.css              # editorial slate/cream theme
├── js/
│   ├── core.js                 # distributions, statistics, CSV, downloads
│   ├── stats.js                # hypothesis tests and effect sizes
│   ├── importers.js            # DAM/Zantiks/generic/ethoscope adapters + QC
│   ├── sleep.js                # sleep, bouts, activity, profiles
│   ├── circadian.js            # χ², Lomb–Scargle, autocorrelation, FFT, cosinor, onset
│   ├── phase.js                # IS/IV/RA/COG/anticipation
│   ├── charts.js               # Plotly figures and figure export
│   ├── sample.js               # deterministic demo + validation signals
│   └── app.js                  # UI state, rendering, exports
├── vendor/
│   ├── plotly.min.js           # figures (bundled, offline)
│   ├── jszip.min.js            # ZIP export
│   ├── xlsx.full.min.js        # Excel import
│   ├── sql-wasm.js             # SQLite import
│   └── sql-wasm.wasm
└── legacy/                     # previous Zantiks-only app (kept for reference)
```

---

## Browser requirements

- A modern browser with ES2017, Canvas and WebAssembly (Chrome, Edge, Firefox, Safari).
- `FileReader`, `Blob` and `URL.createObjectURL` for import/export.
- For the Ethoscope SQLite adapter, serve over HTTP so the `.wasm` file can load.

---

## License and citation

The app is provided for research and teaching. If you use it in a publication, cite the methods above and the original references listed in `METHODS.md`. The demo dataset is synthetic and deterministic; it is not real experimental data.
