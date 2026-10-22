# Methods reference — Chronobiology Workbench

This document describes exactly what the browser application computes. The implementation follows the formulas in the technical specification and the original references. All calculations run locally; no data are sent to a server.

---

## 1. Input and canonical representation

Every imported file is converted to a regular time grid. The canonical record for an animal contains:

| Field | Meaning |
|---|---|
| `activity` | Activity per analysis bin (counts, beam crossings or summed distance) |
| `moving` | Optional movement flag (ethoscope); when present, sleep uses this flag |
| `light` | 1 = lights on, 0 = lights off, `null` when no light information exists |
| `tHours` | Elapsed hours from recording start |
| `zt` | Zeitgeber time (hours since lights-on) |
| `ct` | Circadian time (projected subjective dawn) |
| `day` | Day index from ZT0 |

### Adapters

- **DAM (TriKinetics)** — tab- or space-separated monitor files. 24- or 32-channel layouts are detected automatically. The light column is auto-detected among the metadata columns. Multiple monitor files with the same time grid are merged.
- **Zantiks MWP** — quoted CSV with `RUNTIME`, `L_OR_D` and `A1…D6` wells. Large files are parsed line-by-line. The conversion to standard DAM writes 5 metadata columns, the light flag and 32 channels; activity is multiplied by 1000 to preserve sub-unit precision.
- **Generic CSV/TSV/Excel** — wide (one column per animal) or long (animal ID + value). The user chooses the timestamp/elapsed-time column, light column and animal columns. Excel sheets are read with SheetJS.
- **Ethoscope SQLite** — `ROI_1…ROI_n` tables are queried with sql.js. Distance is `10^(xy_dist_log10x1000/1000)`; velocity is distance/dt. Movement is the maximum velocity in 10 s windows above the threshold (default 1.0 relative units). Ethoscope CSV exports with the same columns are also accepted.
- **Metadata CSV** — one row per animal, joined automatically by file/monitor, `region_id`/channel, well/ROI or animal ID. Genotype, experimental group, sex and treatment are copied to the animal records; `start_datetime`, `stop_datetime`, `replicate`, `well` and `exp` are retained. If no group column exists, genotype becomes the grouping variable. Values of `NA`, `N/A`, `none` and `.` are treated as missing. Metadata can be uploaded before or after the behavioural files.
- **Experiments and replicates** — multiple behavioural files can be imported together when they share the analysis bin and start clock. Different recording dates and durations are allowed; shorter recordings are padded with missing values. `exp` defines the experiment and `replicate` the replicate; if `exp` is blank the source filename is used. The global **Data scope** selector filters every figure and statistic by experiment and/or replicate, so an outlier experiment can be excluded without deleting it.

### Time and ZT0

- Lights-on is inferred from the first 0→1 transition in the light column. If the recording is DD-only, set the **Lights-on clock (ZT0)** parameter manually.
- ZT = time since lights-on modulo the cycle length *T*.
- CT in DD is projected from the last lights-on transition: CT = time since that transition modulo the cycle. Activity in DD is therefore not called “night” solely because the light value is 0; day/night summaries use CT 0–12 / 12–24.
- Day index = floor((elapsed + start clock − lights-on clock) / T) + 1. Partial days are flagged and excluded from daily statistics by default.
- Elapsed time, not wall-clock time, is used for all calculations, so daylight-saving changes do not create artificial bins.

### Quality control

- Missing bins are filled with `NA`, never zero.
- An animal is considered dead from the start of the first run of at least 24 h (configurable) with no activity. Data after that point are removed from the analysis and the animal is flagged.
- Animals with more than the allowed missing fraction (default 10%) or very low activity are flagged. Flags are advisory; exclusion is controlled by the **Use** checkbox in the animal table.
- The analysis window is defined by first/last day and by phase (ALL, LD, DD, LL). The default skips the first two days only when the recording is at least seven days long.

---

## 2. Activity metrics

For activity \(x_i\) in analysis bin \(i\):

| Metric | Formula |
|---|---|
| Total activity per day | \(A_{day}(d)=\sum_{i \in d} x_i\) |
| Mean daily activity | mean of \(A_{day}(d)\) over complete days |
| Day / night activity | sums over bins with light = 1 / light = 0 (or CT 0–12 / 12–24 in DD) |
| Light fraction | \(A_{light}/(A_{light}+A_{dark})\) |
| Activity per awake minute | \(A_{total} / \text{awake minutes}\) |
| Normalised profile | bin activity divided by the animal's daily total, mean, maximum or z-score |

---

## 3. Sleep

### 3.1 Immobility and sleep scoring

A bin is immobile when:

- DAM/generic counts: `activity ≤ threshold` (default 0);
- ethoscope: the 10 s window has `max velocity ≤ threshold` (default 1.0);
- missing bins are `NA` and never count as immobile.

Sleep is a run of at least `minSleepMinutes` (default 5) consecutive immobile bins. The whole run is assigned as sleep **retroactively from its start** (Hendricks et al. 2000; Shaw et al. 2000). Runs touching the start or end of the analysis window are flagged as truncated. This is the standard *Drosophila* sleep definition.

If the analysis bin is larger than 1 min, the minimum bout is expressed in bins; the app warns that bout resolution is limited by the bin size.

### 3.2 Bout categories

Each sleep bout is classified by duration:

- short: ≤ 30 min;
- intermediate: 30–60 min;
- long: > 60 min.

The category thresholds are configurable. Category totals are reported per day.

### 3.3 Sleep outputs

| Output | Definition |
|---|---|
| Sleep per bin | bin minutes if asleep |
| Total sleep per day | sum of asleep minutes in complete days |
| Day / night sleep | asleep minutes in the light / dark phase (CT 0–12 / 12–24 in DD) |
| % sleep | 100 × asleep minutes / valid minutes |
| Bout count | number of sleep bouts starting in the window/day |
| Mean, median, maximum bout | from the bout table |
| Sleep latency | minutes from lights-off (LD) or subjective dusk CT 12 (DD) to the first sleep bout |
| WASO | awake minutes between the first sleep onset in the dark/subjective-night window and the end of that window |
| Fragmentation | bouts per hour of sleep |
| Brief awakenings | wake episodes shorter than the configured threshold (default 2 min) between sleep bouts |
| P(wake) | N(inactive → active) / N(inactive) |
| P(doze) | N(active → inactive) / N(active) |

P(wake) and P(doze) are computed from consecutive 1-min states within the analysis mask (transitions across excluded days are not counted).

### 3.4 Sleep rebound (optional)

If baseline, deprivation and recovery days are entered in Settings:

\[
\text{rebound} = \overline{\text{sleep}}_{recovery} - \overline{\text{sleep}}_{baseline}
\]

\[
\text{rebound \%} = 100 \times \frac{\text{rebound}}{\text{baseline} - \text{deprivation}}
\]

The per-animal rebound values are shown as a box plot and exported with the sleep tables.

---

## 4. Circadian period and rhythmicity

The analysis series is aggregated to the periodogram bin (default 30 min) within the analysis mask. Internal gaps up to **Maximum interpolated gap** (default 120 min) are linearly interpolated; longer gaps cause the method to return an informative error for that animal rather than a misleading period.

All methods are implemented. The user chooses a primary method; the others are reported alongside it.

### 4.1 Chi-square periodogram (Sokolove & Bushell 1978)

For a trial period \(P\) bins, \(K=\lfloor N/P \rfloor\), \(N'=K P\), column means \(M_h\) and grand mean \(M\):

\[
Q_p = \frac{K N' \sum_{h=1}^{P}(M_h-M)^2}{\sum_{i=1}^{N'}(X_i-M)^2}
\]

Under the null hypothesis \(Q_p\) is approximately \(\chi^2\) with \(P-1\) degrees of freedom. The significance threshold is the \(\chi^2_{1-\alpha,P-1}\) critical value.

- **Period** = \(P \times \Delta\), where \(\Delta\) is the bin width. A parabolic interpolation around the peak gives a refined \(\tau\).
- **Power** = \(Q_p(\tau) - Q_p^{threshold}(\tau)\).
- **Peak width** = width in hours of the contiguous region around the peak where \(Q_p\) is above the threshold.
- **Rhythmic** = power ≥ `power_min` (default 10) **and** width ≥ `width_min` (default 2 h). The app also reports whether the peak is simply significant (power ≥ 0), because the strict width criterion is deliberately conservative.
- The period resolution is one bin; the requested step is rounded to the nearest bin. Use a smaller periodogram bin if a finer resolution is required.

### 4.2 Lomb–Scargle (Lomb 1976; Scargle 1982)

For frequencies \(\omega=2\pi/P\), with the time offset

\[
\tan(2\omega\tau_{LS}) = \frac{\sum_j \sin 2\omega t_j}{\sum_j \cos 2\omega t_j},
\]

\[
P_N(\omega)=\frac{1}{2s^2}\left[
\frac{\left(\sum_j (x_j-\bar x)\cos\omega(t_j-\tau_{LS})\right)^2}{\sum_j \cos^2\omega(t_j-\tau_{LS})}
+
\frac{\left(\sum_j (x_j-\bar x)\sin\omega(t_j-\tau_{LS})\right)^2}{\sum_j \sin^2\omega(t_j-\tau_{LS})}
\right].
\]

Significance: \(p=1-(1-e^{-z})^M\), with \(M\) the number of tested frequencies. The threshold is \(z=-\ln(1-(1-\alpha)^{1/M})\). Lomb–Scargle handles missing/uneven samples naturally; the app still uses the regular grid and interpolates small gaps for consistency with the other methods.

### 4.3 Autocorrelation (Levine et al. 2002)

\[
r_k = \frac{\sum_{i=1}^{N-k}(x_i-\bar x)(x_{i+k}-\bar x)}{\sum_{i=1}^{N}(x_i-\bar x)^2}.
\]

The correlogram is lightly smoothed (3 bins). The **period** is the lag of the highest peak after lag 0 (or the mean interval between peaks, also reported). The **rhythmicity index RI** is the height of the third peak after lag 0. \(RS = RI/(2/\sqrt{N})\). Default: RI ≥ 0.3 rhythmic; 0.1–0.3 weakly rhythmic.

### 4.4 FFT

The series is linearly detrended and optionally Hann-windowed, then zero-padded to the next power of two. Power is \(|X(f)|^2/N\); the period is \(1/f\). The peak in the 16–32 h band is reported.

### 4.5 Cosinor

For a trial period \(\tau\), fit

\[
y(t)=M+\beta\cos(\omega t)+\gamma\sin(\omega t),
\]

with \(A=\sqrt{\beta^2+\gamma^2}\), \(\phi=\operatorname{atan2}(-\gamma,\beta)\), acrophase \(=-\phi/\omega\). The app reports mesor, amplitude, acrophase (ZT), percent rhythm \(=100R^2\), and the F-test p-value with 2 and \(N-3\) degrees of freedom. The best-fitting \(\tau\) in the search range is selected.

### 4.6 Onset regression

Daily onsets in DD are detected as the first sustained crossing of 20% of the maximum smoothed daily activity (30-min smoothing; 30-min sustained). A least-squares line of onset time versus day gives

\[
\tau = 24 + \text{slope (h/day)}.
\]

The app reports \(\tau\), \(R^2\) and the circular SD of onsets. Onset regression is a secondary estimate and is not used to trigger the consensus flag.

### 4.7 Consensus and group summaries

The primary method determines each animal's \(\tau\) and rhythmic classification. The periodogram/cosinor methods (χ², Lomb–Scargle, autocorrelation, FFT, cosinor) are compared; an animal is flagged when the primary estimate differs from the method median by more than the consensus tolerance (default 0.5 h) **and** the full across-method range exceeds twice that tolerance. Group summaries report n, number and % significant, number and % meeting the strict rhythmic criteria, mean ± SEM τ (rhythmic animals), median τ and mean power/RI.

The population periodogram is the mean ± SEM of individual χ² power curves.

---

## 5. Phase and non-parametric indices

The mean 24-h profile is the mean activity in each hour-of-day across selected days. For indices that require a continuous series, activity is aggregated to hourly bins over the analysis window.

| Index | Formula / definition |
|---|---|
| Interdaily stability (IS) | \(N\sum_h(\bar x_h-\bar x)^2 / (p\sum_i(x_i-\bar x)^2)\), \(p=24\) |
| Intradaily variability (IV) | \(N\sum_i(x_i-x_{i-1})^2 / ((N-1)\sum_i(x_i-\bar x)^2)\) |
| M10 | mean activity in the most active 10-h circular window of the mean profile |
| L5 | mean activity in the least active 5-h circular window |
| Relative amplitude (RA) | \((M10-L5)/(M10+L5)\) |
| Centre of gravity (COG) | circular mean of profile activity, \(\operatorname{atan2}(\sum x_i\sin\theta_i,\sum x_i\cos\theta_i)\) |
| Acrophase | time of the cosinor maximum |
| M/E peaks | maxima of the smoothed profile within ±3 h of lights-on / lights-off |
| Onset / offset | mean ZT of sustained threshold crossings, with circular SD |
| Day/night ratio | light-phase activity / dark-phase activity (CT in DD) |

IS and IV are computed on hourly bins; at least 24 hourly values are required.

---

## 6. Anticipation

For each lights-on and lights-off transition in the selected days:

\[
\text{MAI} = \frac{A(t_{on}-3h,\ t_{on})}{A(t_{on}-6h,\ t_{on})},\qquad
\text{EAI} = \frac{A(t_{off}-3h,\ t_{off})}{A(t_{off}-6h,\ t_{off})}.
\]

The windows follow the actual transition times, so non-12:12 photoperiods are handled correctly. The difference-ratio variant is \(AI=2\times ratio-1\). The slope index is the least-squares slope of activity (normalised to the mean of the 6-h window) versus time over the 6 h before the transition, with its 95% CI.

Ratios are `NA` if the 6-h activity is zero or the window is incomplete. The group summary shows the mean ratios; the Statistics panel can compare them.

---

## 7. Profiles and actograms

### Profiles

- Activity profile: per animal, mean activity per time-of-day bin across days; group mean and SEM (or SD/95% CI). Normalisation: none, daily mean, maximum, z-score or fraction of daily total.
- Sleep profile: mean sleep minutes per bin or fraction asleep, with optional bout-count and bout-length overlays.
- P(wake), P(doze): per-bin transition probability.
- Activity per awake minute.
- Raster: animals on rows, time on columns, sleep/wake as a binary heat map.
- Circular view: polar profile by ZT/CT.

Missing bins are `NA`; group means use available animals and the n per bin is exported.

### Actograms

- Single- or double-plotted rows; day 1 at the top.
- Bar actograms with a common, per-animal or 99th-percentile cap; day and night periods use separate washes, and a compact light-schedule bar above the plot labels Day and Night explicitly.
- The diagonal period reference line is optional and off by default. Onset/offset markers and the LD→DD marker remain available through the overlay control.
- A mean activity-level panel above the actograms shows activity by ZT with SEM error bars; bars use a day/night colour pair.
- Average actograms normalise each animal before averaging; the app warns that DD groups with different τ should be phase- or τ-aligned.
- Sleep actograms show sleep state instead of activity.
- PNG/SVG export; multi-panel PNG composition.

---

## 8. Statistics and group comparison

Per-animal metrics are compared by the selected grouping variable (group, sex or treatment).

- Descriptive: n, mean, SD, SEM, median, IQR, min, max.
- Normality: Shapiro–Wilk per group.
- Two groups: Welch t-test (reported with 95% CI and Cohen's d) and Mann–Whitney U (rank-biserial effect size).
- More than two groups: one-way ANOVA (η²), Kruskal–Wallis, pairwise Welch t with Holm/BH/Bonferroni correction, and Dunn's rank-based post-hoc test.
- Proportions (e.g. % rhythmic): Fisher exact for 2×2; chi-square with Cramér's V for larger tables.
- Profiles: a permutation test (default 1,000 label shuffles) on the group-mean profile, plus per-bin Welch tests with Benjamini–Hochberg correction.

The app reports effect sizes alongside p-values. It does not implement mixed-effects models or repeated-measures ANOVA; those require a dedicated statistical environment.

---

## 9. Exported tables

| File | Contents |
|---|---|
| `animals_summary.csv` | one row per animal: metadata, activity, sleep, bouts, latency, WASO, P(wake), P(doze), τ, power, width, RI, RS, rhythmic flag, IS, IV, RA, COG, M10, L5, acrophase, onset, offset, MAI, EAI |
| `time_series.csv` | animal × bin: activity, moving, asleep, light, ZT, CT, day |
| `bouts.csv` | animal, bout start/end, duration, ZT, light phase, category, truncated flag |
| `periodograms.csv` | animal × period for χ², Lomb–Scargle, FFT and autocorrelation |
| `profiles.csv` | group × time bin: mean, SEM, n for activity and sleep |
| `group_stats.csv` | descriptive statistics for the current comparison |
| `phase_metrics.csv` | IS, IV, RA, COG, M10, L5, acrophase, onset, offset, MAI, EAI |
| `manifest.json` | app version, date, files, dataset description, parameters and references |

The HTML report embeds the rendered figures and the parameter manifest. Use the browser's **Print / Save as PDF** to create a PDF.

---

## 10. Parameter defaults

| Parameter | Default |
|---|---|
| Analysis bin | 1 min |
| Cycle length T | 24 h |
| Sleep minimum | 5 min |
| Immobility threshold | counts ≤ 0 (DAM); max velocity ≤ 1 (ethoscope) |
| Short / intermediate bout | ≤ 30 / 30–60 min |
| Dead-animal rule | 24 h without activity |
| Maximum missing fraction | 0.10 |
| Period search | 16–32 h, 0.1 h step |
| Periodogram bin | 30 min |
| χ² alpha | 0.05 |
| Rhythmic | power ≥ 10 and width ≥ 2 h |
| Autocorrelation RI | ≥ 0.3 |
| Consensus tolerance | 0.5 h |
| Max interpolated gap | 120 min |
| Anticipation windows | 3 h / 6 h |
| Error bars | SEM |

All defaults are editable in the Settings panel and are written into `manifest.json`.

---

## 11. Validation and limitations

The **Circadian → Validation** panel runs synthetic signals with known periods (23.5, 24, 25 and 26 h) through all methods and reports the recovered periods. It also runs property tests for sleep scoring: every bout is at least the minimum duration, the sum of sleep bins equals the sum of bout durations, and sleep is assigned from the run start.

Known limitations:

- Chi-square resolution is one periodogram bin; use a finer bin or the Lomb–Scargle/cosinor estimates when sub-bin resolution matters.
- Lomb–Scargle and cosinor fit a single sinusoid. A strongly bimodal actogram or a short, entrained LD segment can bias the peak; estimate τ in constant conditions (DD/LL) and use chi-square or autocorrelation as a cross-check.
- The strict “power ≥ 10 and width ≥ 2 h” rhythmic criterion is deliberately conservative. The significant-peak column is shown separately.
- Cycle length *T* is used for ZT/day indexing and period search, but profile and actogram axes are drawn as 24 h/48 h. Non-24 h display requires adapting those axes.
- Actograms are bar actograms; a heat-map alternative and τ-aligned rows are not included. Single/double plotting, day/night washes, the light-schedule bar, onset/offset markers, optional period lines and the LD→DD marker are included.
- Ethoscope SQLite databases are loaded into browser memory; multi-GB databases should be exported to CSV/Parquet first.
- Mixed-effects and repeated-measures models are not implemented.
- PDF output is produced through the browser print dialog.
- The app has no server component; very large exports are limited by browser memory.

---

## 12. References

- Sokolove PG, Bushell WN (1978) The chi square periodogram: its utility for analysis of circadian rhythms. *J Theor Biol* 72:131–160.
- Lomb NR (1976) Least-squares frequency analysis of unequally spaced data. *Astrophys Space Sci* 39:447–462.
- Scargle JD (1982) Studies in astronomical time series analysis. II. *Astrophys J* 263:835–853.
- Levine JD, Funes P, Dowse HB, Hall JC (2002) Signal analysis of behavioral and molecular cycles. *BMC Neurosci* 3:1.
- Hendricks JC et al. (2000) Rest in *Drosophila* is a sleep-like state. *Neuron* 25:129–138.
- Shaw PJ et al. (2000) Correlates of sleep and waking in *Drosophila melanogaster*. *Science* 287:1834–1837.
- Harrisingh MC et al. (2007) The *Drosophila* clock controls the expression of a neuropeptide required for circadian behaviour. *J Neurosci* 27:12489–12499.
- Wiggin TD et al. (2020) Covert sleep-related biological processes are revealed by probabilistic analysis in *Drosophila*. *PNAS* 117:10024–10034.
- Van Someren EJW et al. (1999) Bright light therapy: improved sensitivity to its effects on rest-activity rhythms in Alzheimer patients. *Chronobiol Int* 16:505–518.
- Geissmann Q et al. (2019) Ethoscopes: an open platform for high-throughput ethomics. *PLoS Biol* 17:e3000461.
- Cichewicz K, Hirsh J (2018) ShinyR-DAM: a program analyzing *Drosophila* activity, sleep and circadian rhythms. *Fly* 12:19–25.

Verify thresholds and reference details against the original papers before publication.
