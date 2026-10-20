# Drosophila behaviour analysis — Chronobiology Workbench

A complete browser-based analysis suite for circadian and sleep behaviour in *Drosophila* (and any species with a comparable activity time series).

The application lives in [`docs/`](docs/) and is ready for GitHub Pages. It implements the full analysis engine described in the technical specification: activity, sleep, bout structure, P(wake)/P(doze), circadian periodograms, phase and anticipation indices, actograms, profiles, group statistics and export.

## Use it

- **Hosted version:** enable GitHub Pages for this repository with **Source: Deploy from a branch → `main` → `/docs`**, or use the included GitHub Actions workflow.
- **Locally:** open [`docs/index.html`](docs/index.html) in a modern browser, or run `python -m http.server` from `docs/`.
- Click **Load synthetic demo** to explore the full workflow without uploading data.

## Documentation

- [`docs/README.md`](docs/README.md) — user guide, formats and deployment.
- [`docs/METHODS.md`](docs/METHODS.md) — formulas, defaults and references.
- [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md) — full technical specification.

## Highlights

- DAM (24/32 channels, multiple monitors), Zantiks MWP, generic CSV/TSV/Excel (wide/long) and ethoscope SQLite/CSV import.
- ≥5-min sleep scoring, bout categories, latency, WASO, fragmentation, P(wake)/P(doze), rebound.
- Chi-square, Lomb–Scargle, autocorrelation (RI/RS), FFT, cosinor and onset regression.
- IS, IV, M10/L5, relative amplitude, COG, acrophase, M/E peaks, MAI/EAI.
- Single/double-plotted actograms, group-average actograms, activity/sleep/transition profiles, raster and circular views.
- Welch t, Mann–Whitney, ANOVA, Kruskal–Wallis, Dunn, Fisher exact, chi-square, effect sizes and profile permutation tests.
- Tidy CSV tables, PNG/SVG figures, HTML/PDF report, ZIP package and reproducibility manifest.

All computation is client-side; no data are uploaded to a server.
