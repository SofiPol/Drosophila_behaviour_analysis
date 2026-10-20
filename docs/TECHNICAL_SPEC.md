# Circadian & Sleep Analysis App: Technical Specification

Analysis engine, formulas and visual outputs for DAM and ethoscope behavioural data (and any generic activity recorder).

## 1. Scope and goals

The app ingests locomotor/behavioural time series from individual animals (mainly Drosophila, but valid for any species) and produces:

- Activity metrics (totals, day/night, profiles)
- Sleep metrics (amount, bouts, latency, consolidation, P(wake)/P(doze))
- Circadian metrics (period, power, rhythmicity, phase, nonparametric indices)
- Anticipation indices (morning and evening)
- Visualisations: individual actograms, average actograms, activity profiles, sleep profiles, periodograms

Design rule: every algorithm is a pure function on a canonical time series, with all parameters exposed (see section 13), so results are reproducible and comparable with published tools (ShinyR-DAM, Rethomics/ethoscopy, ClockLab, ActogramJ, SCAMP, pySolo).

## 2. Input data and import adapters

### 2.1 Canonical internal format

All adapters convert to one long-format table:

| Field | Description |
| --- | --- |
| experiment\_id, animal\_id | Unique keys (monitor + channel/ROI) |
| t | Time in seconds from experiment start (float) |
| activity | Raw activity value for that sample/bin (counts, beam crosses, distance) |
| moving | Boolean movement flag (for ethoscope-style data) |
| light | 1 = lights on, 0 = lights off (from file or from schedule) |
| metadata | Genotype, sex, treatment, condition, alive/dead, etc. |

Resampling to a regular grid (default 1 min, optional 5/10/30 min and 1 h) is done after import.

### 2.2 DAM adapter (TriKinetics Drosophila Activity Monitor)

- Monitor files (DAM2/DAM5 text, tab-separated, one row per time bin, usually 1 min): columns are row index, date, time, monitor status, extra columns, a light-status column, then one column per channel (32 for DAM2; DAM5 provides multibeam variants).
- Each channel column is the number of beam crossings in that bin (DAM2: 1 count per interruption of the single beam; DAM5M: a tube-level count sum of beams).
- Parse date and time to a timestamp, extract the light column, and make one animal per channel.
- Handle: files split across several monitors, empty channels (user-defined list of excluded channels), restarts/gaps, and a different bin size (infer from timestamps).
- Metadata come from a user-supplied table (monitor, channel, genotype, sex, ...).

### 2.3 Ethoscope adapter

- Data are in an SQLite database (.db). Tables ROI\_1 ... ROI\_20, one per tube; columns: id, t (ms), x, y, w, h, phi, xy\_dist\_log10x1000, is\_inferred, has\_interacted. A METADATA table holds the experiment date/time and ROI information; the VAR\_MAP/ROI\_MAP tables hold variable and ROI definitions.
- Movement distance between consecutive frames: dist = 10^(xy\_dist\_log10x1000 / 1000), in relative ROI units (convert to mm with the known ROI width if available).
- Velocity: v = dist / dt (dt in seconds between consecutive frames).
- Movement classification (as in sleepr/ethoscopy max-velocity classifier): resample to 10 s windows, take the maximum velocity per window; the animal is MOVING if max velocity exceeds a threshold (default 1.0 after the velocity correction coefficient, configurable), otherwise IMMOBILE. Windows with missing data are treated as NA (not immobile), and linear interpolation is allowed only for gaps up to a user-defined length.
- Optionally, micro-movements (movement without displacement) can be classified from the has\_interacted / phi / w, h changes; in the default pipeline micro-movements count as immobile for sleep.
- Store both 'moving' (boolean per 10 s) and 'activity' (e.g. summed distance, or number of moving windows per bin).

### 2.4 Generic CSV/Excel adapter

User maps columns: timestamp (or elapsed time), animal columns (wide) or animal ID + value (long), optional light column. Unit of the values (counts, distance, moving flag) is declared by the user and decides which sleep rule applies (see 5.1).

### 2.5 Quality control at import

- Time regularisation: bins must be equidistant; fill missing bins with NA, never with 0.
- Alive/dead: an animal is considered dead from the start of the first period of at least 24 h (configurable) with no activity at all; later data are removed. Animals dead before a minimum survival time (default: before the end of the analysis window) are excluded from the group statistics.
- Flag animals with very low total activity (e.g. less than a configurable mean counts/day) and missing data above a configurable fraction (default 10 %).
- Windows for analysis are set by the user: for LD, usually discard the first day (acclimation); for DD, define the beginning at the first lights-off.

## 3. Time conventions

- ZT (Zeitgeber Time): ZT0 = lights on in LD. With a 12:12 LD cycle, ZT12 = lights off.
- CT (Circadian Time) in DD: CT0 = time of subjective dawn, defined as ZT0 projected from the last LD cycle (CT24 = tau for free-running animals is not rescaled by default; optionally CT = 24 \* (t - t0) / tau).
- Day index: d = floor((t - t\_ZT0) / 24 h) + 1. Time of day: tod = (t - t\_ZT0) mod 24 h.
- Light schedule is read from the light column (preferred) or defined as 'lights-on time + photoperiod'. Support for non-24 h cycles (T-cycles, e.g. T=22 or T=26) by making the cycle length a parameter T, replacing 24 h everywhere below.

## 4. Activity metrics

Let x\_i be the activity in bin i (width Delta, default 1 min).

| Output | Formula |
| --- | --- |
| Total activity per day | A\_day(d) = sum of x\_i over bins in day d |
| Mean daily activity | mean of A\_day(d) over selected days |
| Day activity (light phase) / night activity (dark phase) | Sums over bins with light = 1 / light = 0 |
| Light fraction | A\_light / (A\_light + A\_dark) |
| Activity per hour | Sum over each hour of the day |
| Activity per awake minute | A\_total / number of minutes classified as awake (used as a speed/ hyperactivity index) |
| Normalised profile | Bin activity divided by the animal's daily total, so profiles sum to 1 (or 100 %) per day |

Group values: mean, standard deviation, SEM = SD / sqrt(n), and n (animals).

## 5. Sleep analysis

### 5.1 Definition of sleep

Standard rule (Hendricks et al. 2000; Shaw et al. 2000): sleep is a period of **5 or more consecutive minutes of immobility**. The threshold is a parameter (min\_sleep\_duration = 5 min).

Immobility definition:

- DAM, 1-min bins: immobile if counts = 0.
- Ethoscope: immobile if the 10 s window is not MOVING (see 2.3); sleep = 300 s or more of consecutive immobility.
- Other devices: user-defined threshold, immobile if activity <= threshold.
- If the data are not in 1-min bins (e.g. 5-min DAM bins), sleep can only be approximated: a bin with zero counts is a 5-min sleep bin. The app must warn the user that bout analysis is limited to the bin size.

### 5.2 Algorithm (pseudocode)

```
immobile[i] = (activity[i] <= thr)        # boolean per bin
find runs of consecutive immobile[i] == True
for each run with length_in_minutes >= min_sleep_duration:
    mark bins of the whole run as asleep      # sleep is assigned from the START of the run
    (equivalent to a retroactive assignment once the 5th minute is reached)
bouts = list of runs marked asleep, each with start, end, duration
```

Runs that touch the start or the end of the analysis window are flagged as truncated and are included by default (option to exclude them for bout-length statistics).

### 5.3 Sleep outputs

| Output | Formula / definition |
| --- | --- |
| Sleep per bin (min) | Number of minutes asleep inside the bin |
| Total sleep per 24 h | Sum of asleep minutes in the day, in min (or h) |
| Day sleep / night sleep | Sum of asleep minutes in the light / dark phase |
| % sleep | 100 \* asleep minutes / total minutes in the window |
| Number of bouts | Count of sleep bouts starting in the window (per day, per light phase or per hour) |
| Mean bout length | Total sleep minutes / number of bouts (min) |
| Maximum bout length | Longest bout in the window |
| Median bout length, bout length distribution | From the bout table; histogram with bins (5-10, 10-30, 30-60, 60-120, > 120 min, configurable) |
| Sleep latency | Minutes from lights-off (or lights-on) to the start of the first sleep bout |
| WASO (wake after sleep onset) | Minutes awake between the first sleep onset of the night and the end of the dark phase |
| Sleep fragmentation | Number of bouts per hour of sleep, or bouts per day; optionally the ratio of brief bouts (5-10 min) to total bouts |
| Brief awakenings | Number of wake episodes shorter than a threshold (e.g. 1-2 min) between sleep bouts |
| Activity per awake minute | See section 4 |

### 5.4 Transition probabilities (Wiggin et al. 2020)

Using 1-min bins and the per-minute state S\_t (1 = active, 0 = inactive), defined by the immobility rule:

```
P(Wake) = N(inactive at t -> active at t+1) / N(inactive at t)
P(Doze) = N(active at t -> inactive at t+1) / N(active at t)
```

P(Wake) estimates the tendency to wake (sleep depth), P(Doze) the tendency to fall asleep (sleep pressure). Both are computed per animal and per light phase. These are independent of bout-length truncation, and should be reported next to the 5-min rule results.

### 5.5 Optional measures

- Rebound after sleep deprivation: sleep (min) during the recovery window minus baseline, in absolute or % of the lost sleep.
- Arousal threshold: fraction of animals responding to a stimulus as a function of sleep-bout age (ethoscope with interaction data).
- Sleep architecture by hour: bout number and mean bout length per hour of ZT.

## 6. Circadian period and rhythmicity

Input: binned activity (default 30 min bins for periodogram speed, or 1-5 min), over at least 5-7 days in DD (or LD for entrained period), after the user-defined start. Test periods: 16-32 h, step 0.1 h (or 1 bin if the chi-square method is used).

All methods are implemented; the user chooses one for the primary tau, and the others are available for confirmation.

### 6.1 Chi-square periodogram (Sokolove & Bushell 1978)

For a trial period P (in bins), build K = floor(N / P) rows and use N' = K \* P points. Column means M\_h (h = 1..P) are the average over the K rows, and M is the grand mean:

```
Qp = K * N' * sum_{h=1..P} (M_h - M)^2  /  sum_{i=1..N'} (X_i - M)^2
```

Under the null hypothesis (no periodicity), Qp is approximately chi-square distributed with P - 1 degrees of freedom. The significance threshold at alpha = 0.05 (or 0.01) is the chi-square critical value at df = P - 1, and is plotted as the significance line.

Outputs:

- **Period (tau)** = P with the maximum Qp inside the search range (convert bins to hours: tau = P \* Delta)
- **Power** = Qp(tau) - Qp\_threshold(tau). This is the value used by Levine et al. 2002 and ShinyR-DAM
- **Peak width** = width (h) of the peak at the significance line
- **Rhythmic** = Power >= power\_min (default 10) AND width >= width\_min (default 2 h); parameters configurable
- Amplitude-independent: the percentage of variance explained can also be given: %V = Qp / (N' ) \* 100... (report as Qp / N' \* 100)

Note: Because P is an integer number of bins, the period resolution is Delta. Use 1-5 min bins if a resolution finer than 0.5 h is needed, or interpolate the peak by fitting a parabola through the 3 points around the maximum.

### 6.2 Lomb-Scargle periodogram (Lomb 1976, Scargle 1982)

For data x(t\_j), j = 1..N, mean x\_bar, variance s^2, and angular frequency w = 2\*pi/P:

```
tau_LS: tan(2*w*tau_LS) = sum sin(2*w*t_j) / sum cos(2*w*t_j)

PN(w) = 1/(2 s^2) * [ ( sum (x_j - x_bar) cos(w (t_j - tau_LS)) )^2 / sum cos^2(w (t_j - tau_LS))
                    + ( sum (x_j - x_bar) sin(w (t_j - tau_LS)) )^2 / sum sin^2(w (t_j - tau_LS)) ]
```

Significance of a peak of height z: p = 1 - (1 - exp(-z))^M, where M is the number of independent frequencies (approximately the number of tested periods; use M = N for a conservative threshold, or a permutation test). The significance line is the z that corresponds to p = 0.05. Lomb-Scargle works with uneven sampling and missing data, which is advantageous for ethoscope data with gaps. Use PN as 'power' (or PN minus the threshold).

### 6.3 Autocorrelation / correlogram (Levine et al. 2002)

```
r_k = sum_{i=1..N-k} (x_i - x_bar)(x_{i+k} - x_bar) / sum_{i=1..N} (x_i - x_bar)^2
```

- Compute for lags k = 0 to about N/2 (limited to maximum 5-6 days).
- Smooth lightly (moving average, 3-5 bins).
- **Period** = lag of the highest peak of the correlogram after lag 0 (or, more robustly, the mean interval between successive peaks).
- **Rhythmicity Index (RI)** = height of the 3rd peak (r at the 3rd peak after lag 0). Following Levine et al. 2002, **RS** = RI / (2 / sqrt(N)), i.e. the ratio of the RI to the approximate 95 % confidence bound of the autocorrelation. Typical cut-offs: RI >= 0.3 rhythmic, 0.1 to 0.3 weakly rhythmic, < 0.1 arrhythmic (configurable). If fewer than 3 peaks are detected, RI = 0 (arrhythmic).

### 6.4 Fourier (FFT) spectrum

Detrend and (optionally) window the data (Hann), then:

```
X(f_k) = sum_{n=0..N-1} x_n * exp(-2*pi*i*k*n/N),  f_k = k / (N * Delta)
Power(f_k) = |X(f_k)|^2 / N,   period = 1 / f_k
```

Report the period at the maximum power in 16-32 h; zero-pad to refine the frequency grid. Use for confirmation and for the population spectrum.

### 6.5 Cosinor (least-squares sinusoid)

Fit y(t) = M + A*cos(2*pi*t/tau + phi) by linear regression of y on cos(2*pi*t/tau) and sin(2*pi\*t/tau) for each tau in the grid (or at the tau found by the periodogram):

```
y = M + beta*cos(w t) + gamma*sin(w t),  A = sqrt(beta^2 + gamma^2),  phi = atan2(-gamma, beta)
```

Outputs: mesor M, amplitude A, acrophase (time of peak = -phi / w, converted to ZT or CT), percent rhythm = 100 \* R^2, and the F-test p-value of the zero-amplitude test.

### 6.6 Onset-based period (actogram regression)

1. Detect daily activity onsets (or offsets) in DD: the first time in each day at which smoothed activity crosses a threshold (e.g. 20 % of the maximum smoothed daily activity) and stays above it for at least a set duration.
2. Fit a least-squares line to onset time (h) versus day number. tau = 24 + slope (h/day).
3. Report tau, R^2 and the SD of the onsets (precision/ 'onset variability').

### 6.7 Consensus period and group statistics

- Animals with a significant peak in the primary method are classified rhythmic. If the secondary methods disagree by more than 0.5 h, flag the animal.
- Group outputs: % rhythmic, mean tau +/- SEM (rhythmic animals only), mean power, mean RI, distribution histogram of tau.
- Population periodogram: average the individual periodograms (rhythmic and non-rhythmic) per group.

## 7. Phase, amplitude and non-parametric indices

Let x\_h be the mean 24-h profile (mean over days) and N the total number of hours; p = number of bins per day.

| Index | Formula | Interpretation |
| --- | --- | --- |
| Interdaily stability (IS) | IS = \[ N \* sum\_{h=1..p} (x\_h\_mean - x\_bar)^2 \] / \[ p \* sum\_{i=1..N} (x\_i - x\_bar)^2 \] | 0 to 1, rhythm stability between days (van Someren) |
| Intradaily variability (IV) | IV = \[ N \* sum\_{i=2..N} (x\_i - x\_{i-1})^2 \] / \[ (N - 1) \* sum\_{i=1..N} (x\_i - x\_bar)^2 \] | 0 to about 2, rhythm fragmentation |
| M10 | Mean activity of the most active 10 h in the mean 24-h profile (circular window) |  |
| L5 | Mean activity of the least active 5 h in the mean 24-h profile |  |
| Relative amplitude (RA) | RA = (M10 - L5) / (M10 + L5) | 0 to 1 |
| Centre of gravity (COG) | COG = atan2( sum x\_i sin(theta\_i), sum x\_i cos(theta\_i) ), theta\_i = 2*pi*tod\_i / T; convert to ZT hours | Phase of mass of activity |
| Acrophase | Time of the maximum of the cosinor fit (6.5) | Phase |
| Phase of onset/offset | Times from 6.6 relative to lights-on/off | Phase angle of entrainment |
| Day/night ratio | A\_light / A\_dark |  |
| Peak phase (M and E peaks) | Times of the local maxima of the smoothed 24 h profile around lights-on and lights-off |  |

For IS and IV, use hourly bins (or the bin size chosen in the settings) and at least 5 full days.

## 8. Anticipation indices (LD)

Used to quantify the increase in activity before the light transitions. Computed on 30-min bins (default) or any bin, on each animal, over the LD days selected (default: days 3-6 of LD after the first 2 days of adaptation), then averaged across days (or computed on the mean profile).

### 8.1 Ratio index (Harrisingh et al. 2007)

```
Morning anticipation index (MAI) = A(ZT21 to ZT24) / A(ZT18 to ZT24)
Evening anticipation index (EAI) = A(ZT9 to ZT12)  / A(ZT6 to ZT12)
```

That is, activity in the last 3 h before lights-on (or lights-off), divided by the activity in the last 6 h before. The index ranges from 0 to 1; 0.5 means no anticipation (flat), values above 0.5 indicate anticipation. The windows are defined relative to the lights-on and off times, so with a different photoperiod, MAI = A(t\_on - 3 h, t\_on) / A(t\_on - 6 h, t\_on).

### 8.2 Difference-ratio variant

```
AI = [ A(last 3 h) - A(previous 3 h) ] / A(last 6 h)
```

Ranges from -1 to 1, 0 = flat, positive = anticipation. This is a mathematical transform of the ratio index (AI = 2 \* ratio - 1) and gives identical statistical conclusions; it is provided for convenience.

### 8.3 Slope index

Linear regression of activity (counts per 30 min bin, normalised to the mean of the 6 h window) against time over the last 3-6 h before the transition. The slope (activity units/h) and its 95 % CI are reported; slopes significantly above 0 indicate anticipation.

### 8.4 Handling and statistics

- If A(last 6 h) = 0 or the animal has fewer than a minimum number of counts in the window, the index is NA.
- Because ratio data are bounded, group comparison uses Mann-Whitney / Kruskal-Wallis (or ANOVA on the arcsine-transformed values); give effect size and n.
- Optional: anticipation in DD (CT windows) and the phase of the M and E peaks (section 7).

## 9. Profiles

### 9.1 Activity profile

1. Choose bin B (default 30 min; 1-60 min).
2. For each animal and each time-of-day bin b: mean over days of the activity in the bin.
3. Group profile: mean of the animals; error = SEM (or SD / 95 % CI, selectable).
4. Optional normalisation: divide each animal's profile by its own mean daily activity or by its maximum; z-score; or fraction of daily total.

Plot: step or line + shaded SEM, white/grey background for light/dark phases, ZT or CT on the x-axis (0-24 h, optional double-plotted 0-48 h). Day-by-day profile (one trace per day) and 'across days' timeline (full recording in hourly bins) are also provided.

### 9.2 Sleep profile

Same as 9.1 but the variable is sleep (min per hour, or % of the time asleep in the bin). Additional overlays: bout number per hour and mean bout length per hour of ZT. Group comparison by genotype/condition in the same plot.

### 9.3 Other profiles

P(Wake) and P(Doze) per hour; activity per awake minute per hour; the sleep/wake raster (animals on rows, time on the x-axis, state as colour).

## 10. Actograms

### 10.1 Individual actogram

- Rows = days (day 1 at the top); x-axis = time of day.
- **Single-plotted**: row d covers time-of-day 0-24 h of day d.
- **Double-plotted**: row d covers days d and d+1 (x-axis 0-48 h), so the final row repeats the final day on the left, with a blank second half (standard in chronobiology).
- Each bin is drawn as a vertical bar (height proportional to counts in the bin, scaled to a common maximum or to a per-animal maximum, with an optional cap at a given percentile, e.g. 99th, to avoid being dominated by outliers). Heat-map (grayscale/colour intensity) is an alternative.
- Shading of the dark phase (grey) using the light column; in DD, a marker for the previous LD schedule and the subjective night is optional.
- Overlays: fitted onset/offset lines, the period line with slope tau - 24, tau annotation, a vertical marker for LD to DD transition.
- Aligned to the zeitgeber (clock time) by default; the user can instead align to period-length rows (i.e. rows of length tau) to straighten the free-running rhythm ('tau-aligned' actogram).
- Binning: 1-30 min selectable; display bin independent of the analysis bin.
- Sleep actogram: same layout, but plots sleep (or sleep bouts as horizontal segments) instead of counts.

### 10.2 Average actogram

- Group average: for each day and time bin, mean across animals (after the same normalisation as in 9.1; normalise per animal first so highly active animals do not dominate). Optional: median.
- Valid when the animals are synchronised (LD, or DD with similar tau). For DD groups with differing tau, align every animal to its own onset/phase (phase-aligned average) or average the tau-aligned actograms, and warn the user.
- Display SEM as a second panel or in a table; include the number of animals contributing to each day.
- Optionally generate the actogram of only the rhythmic animals.

### 10.3 Rendering requirements

- Export as PNG, SVG, PDF at a configurable DPI, with a consistent colour scale across animals in a group.
- Interactive: zoom, hover tooltip (time, ZT, value), click to open the animal's detail page.
- Batch export: one page per animal with the actogram + periodogram + sleep profile + summary table.

## 11. Data flow and outputs

1. Import (adapter) -> canonical table -> QC (dead animals, missing) -> window selection
2. Resample to analysis bin -> sleep classification -> activity/sleep tables
3. Circadian analysis (periodograms etc.) on the selected window
4. Anticipation, profiles, actograms
5. Group aggregation and statistics -> export

### Output tables (CSV/Excel)

| Table | Content |
| --- | --- |
| animals\_summary | One row per animal: metadata, alive/dead, total/day/night activity, total/day/night sleep, bouts (number, mean, max), latency, P(wake), P(doze), tau, power, width, RI, RS, rhythmic flag, IS, IV, RA, COG, MAI, EAI |
| time\_series | Animal x bin: activity, moving, asleep, light, ZT/CT, day |
| bouts | Animal, bout start, end, duration, ZT, light phase |
| periodograms | Animal x period: Qp, threshold, Lomb-Scargle, autocorrelation, FFT |
| profiles | Group x bin of the ZT: mean, SEM, n for activity and sleep |
| group\_stats | Means, SEM, n and test results |

## 12. Statistics and group comparison

- Descriptive: mean, SD, SEM, median, IQR, n.
- Two groups: Student/Welch t-test or Mann-Whitney; several groups: one-way ANOVA with Tukey/Dunnett, or Kruskal-Wallis with Dunn's test; repeated measures (days) by mixed models.
- Proportions rhythmic (%): Fisher's exact / chi-square test.
- Profiles: two-way repeated measures ANOVA (genotype x time-of-day) or permutation tests; multiple-comparison correction (Holm/Benjamini-Hochberg).
- Effect sizes (Cohen's d, rank-biserial) and 95 % CI shown next to p-values.

## 13. Parameters (defaults and ranges)

| Parameter | Default | Notes |
| --- | --- | --- |
| Raw bin | 1 min | Detected from file |
| Analysis bin (profiles) | 30 min | 1-60 min |
| Cycle length T | 24 h | For T-cycles |
| Photoperiod | 12:12 LD | Read from the light column |
| Sleep threshold | 5 min | 1-30 min |
| Immobility threshold | counts = 0 (DAM); max velocity < 1 (ethoscope) | Per device |
| Dead animal rule | 24 h with no activity | Configurable |
| Period search range | 16-32 h | Step 0.1 h or 1 bin |
| Chi-square alpha | 0.05 | 0.01 optional |
| Rhythmic criteria | Power >= 10, width >= 2 h | Autocorr: RI >= 0.3 |
| Min. days for period | 5 (DD) | Warn if fewer |
| LD analysis days | Day 3 to last full day | Skip acclimation |
| Anticipation windows | 3 h / 6 h | Variants in section 8 |
| Error bars | SEM | SD, 95 % CI |

## 14. Edge cases and validation

- Daylight-saving or clock changes: use the elapsed time of the device, never wall-clock time for calculation.
- NA propagation: sums and means ignore NA only if the NA fraction in the window is below the limit; otherwise the result is NA.
- Partial first/last days are excluded from daily statistics (but included in periodograms).
- Short or arrhythmic animals: periodogram methods still return a peak, therefore the rhythmic flag must be used before reporting tau.
- Trend: remove slow linear trends (detrend) before FFT/Lomb-Scargle; do not detrend for chi-square.
- Validation: unit tests against published tools (ShinyR-DAM, Rethomics/sleepr, ClockLab, SCAMP, pySolo) on shared example datasets; synthetic signals of known tau (e.g. 23.5, 24, 25 h) with added noise and missing data; property tests (sleep never < 5 min bouts, sum of the sleep over bins = total sleep).

## 15. Recommended implementation

- Language/libraries: Python (pandas, numpy, scipy, astropy.timeseries.LombScargle, statsmodels, matplotlib/plotly, sqlite3; ethoscopy for ethoscope loading) or R (Rethomics: behavr, damr, scopr, sleepr, zeitgebr, ggetho; shiny front-end). The engine should be independent of the UI so that it can be used as a command-line tool and as an API.
- Data model: tidy tables as in section 2.1; keep metadata separate (one row per animal).
- Performance: ethoscope DBs can be several GB; read ROI tables lazily and resample to 10 s windows immediately, store the result as Parquet.
- Reproducibility: every export includes a JSON with the app version, input file hash, parameters and the date.

## 16. Key references

- Sokolove PG, Bushell WN (1978) The chi square periodogram: its utility for analysis of circadian rhythms. J Theor Biol 72:131-160.
- Lomb NR (1976) Astrophys Space Sci 39:447-462; Scargle JD (1982) Astrophys J 263:835-853.
- Levine JD, Funes P, Dowse HB, Hall JC (2002) Signal analysis of behavioral and molecular cycles. BMC Neurosci 3:1.
- Hendricks JC et al. (2000) Rest in Drosophila is a sleep-like state. Neuron 25:129-138; Shaw PJ et al. (2000) Science 287:1834-1837.
- Harrisingh MC et al. (2007) Bruchpilot... / anticipation of light transitions, J Neurosci 27:12489-12499.
- Wiggin TD et al. (2020) Covert sleep-related biological processes are revealed by probabilistic analysis in Drosophila. PNAS 117:10024-10034.
- Van Someren EJW et al. (1999) Chronobiol Int 16:505-518 (IS, IV, RA).
- Geissmann Q et al. (2019) Ethoscopes: an open platform for high-throughput ethomics. PLoS Biol 17:e3000461; Geissmann Q et al. (2017) Rethomics, PLoS One.
- Cichewicz K, Hirsh J (2018) ShinyR-DAM. Fly 12:19-25.

Note: verify the exact reference details and the default thresholds against the original papers before the final release of the specification.
