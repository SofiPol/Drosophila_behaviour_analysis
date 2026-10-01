# Comprehensive Functional & Technical Specification: Zantiks-to-Rethomics Analysis App

## 1. System Overview & Objective
The goal of this application is to provide an end-to-end workflow for behavioral genetics and circadian rhythm researchers working with **Zantiks MWP / multi-well systems**. 

The app automates two main stages:
1. **Data Conversion Module**: Converts raw Zantiks CSV output (e.g., `circadian_rhythms_glasgow-20250801T141426 (1).csv`) into standard Drosophila Activity Monitor (DAM) tab-separated text format (`DAM_file.txt`).
2. **Analysis & Visualization Studio**: Links converted DAM files with experimental metadata (e.g., `Metadata_150726_ebony.csv`) and runs a full analysis pipeline using **Rethomics** (`rethomics_analysis_template.R`), producing publication-ready graphs and statistical tests.

---

## 2. Input Data Formats & Schemas

### 2.1 Raw Zantiks CSV Specification
- **Header Structure**:
  - Row 1: `0,Info,<START_DATETIME>,Service '<SERVICE_NAME>' : Execution start` (e.g., `01/08/2025 14:14`)
  - Row 2: `0,Info,Subject Identification,<EXP_NAME>`
  - Row 3: `0,Info,Apparatus,<APPARATUS_NAME>`
  - Row 4: `0,Info,Unit ID,<UNIT_ID>`
  - Row 5: Column Headers: `RUNTIME,UNIT,TEMPERATURE,L_OR_D,DAY,HOUR,TIME_BIN,A1,A2,A3,A4,A5,A6,B1,B2,B3,B4,B5,B6,C1,C2,C3,C4,C5,C6,D1,D2,D3,D4,D5,D6`
- **Data Rows**:
  - `RUNTIME`: Cumulative elapsed time in seconds.
  - `UNIT`: Unit identification text.
  - `TEMPERATURE`: Recorded ambient temperature in °C.
  - `L_OR_D`: Light condition (`LIGHT` vs `DARK`).
  - `TIME_BIN`: Bin counter.
  - Channels `A1`..`D6`: 24 activity metric measurements (distance moved in mm/pixels per bin).

### 2.2 Standard DAM File Specification (`DAM_file.txt`)
- **Format**: 42 tab-separated columns without column headers.
- **Column Mapping**:
  - `Col 1`: Row index (`1..N`).
  - `Col 2`: Date string (`DD-MMM-YY` or `DD MMM YY`, e.g., `"01 Aug 25"`).
  - `Col 3`: Time string (`"HH:MM:SS"`).
  - `Col 4`: Light status (`"1"` for Light, `"0"` for Dark).
  - `Cols 5-7`: Dummy/control status flags (default `0`).
  - `Cols 8-10`: Temperature/Environmental channels (default `0`).
  - `Cols 11-34`: Channels 1 to 24 corresponding to wells `A1` through `D6` (scaled activity counts: `round(distance * 1000)`).
  - `Cols 35-42`: Unused channels 25 to 32 (padded with `0`).

### 2.3 Experimental Metadata Specification (`metadata.csv`)
- **Required Columns**:
  | Column Name | Type | Description |
  |---|---|---|
  | `file` | String | Converted DAM file name (e.g. `DAM_file.txt`) |
  | `start_datetime` | Timestamp | Experiment start filter window (`YYYY-MM-DD HH:MM:SS`) |
  | `stop_datetime` | Timestamp | Experiment end filter window (`YYYY-MM-DD HH:MM:SS`) |
  | `region_id` | Integer | Channel number (1 to 24) |
  | `well` | String | Well coordinate (`A1` through `D6`) |
  | `genotype` | String | Experimental genotype/group (e.g. `CTRL`, `Axenic`, `hTauOE`) |
  | `sex` | String | Sex identifier (`female`, `male`) |
  | `replicate` | Integer | Replicate ID |
  | `exp` | String | Experiment title |
  | `observations` | String | Inclusion filter (`alive` vs `dead`) |

---

## 3. Detailed Data Transformation Algorithm

```r
# Data Transformation Pipeline Logic (Zantiks to DAM format)

parse_zantiks_to_dam <- function(input_csv_path, output_dam_path) {
  # 1. Parse Start Datetime from header line 1
  header_line <- readLines(input_csv_path, n = 1)
  raw_datetime_str <- unlist(strsplit(header_line, ","))[3]
  start_dt <- parse_datetime_robust(raw_datetime_str)
  
  # 2. Load Raw Zantiks Data skipping header info
  raw_df <- data.table::fread(input_csv_path, skip = 4)
  
  # 3. Calculate Row Timestamps
  timestamps <- start_dt + raw_df$RUNTIME
  date_str <- strftime(timestamps, format = "%d %b %y")
  time_str <- strftime(timestamps, format = "%H:%M:%S")
  
  # 4. Extract Activity Matrix (Channels A1 to D6)
  activity_cols <- names(raw_df)[grep("^[A-D][1-6]$", names(raw_df))]
  act_matrix <- as.matrix(raw_df[, ..activity_cols])
  scaled_act <- round(act_matrix * 1000) # Scale movement values
  
  # 5. Build 42 DAM Columns
  n_rows <- nrow(raw_df)
  dam_data <- data.frame(
    Index = 1:n_rows,
    Date = date_str,
    Time = time_str,
    Light = ifelse(raw_df$L_OR_D == "LIGHT", 1, 0),
    C5 = 0, C6 = 1, C7 = 0, C8 = 0, C9 = 0, C10 = 0
  )
  
  # Add 24 channels + 8 zero-padded channels = 32 channels
  dam_channels <- as.data.frame(scaled_act)
  for (ch in 25:32) {
    dam_channels[[paste0("V", ch)]] <- 0
  }
  
  complete_dam <- cbind(dam_data, dam_channels)
  
  # 6. Write formatted tab-separated text file
  write.table(complete_dam, file = output_dam_path, sep = "\t", 
              quote = FALSE, row.names = FALSE, col.names = FALSE)
}
```

---

## 4. Morning & Evening Anticipation Index (MAI & EAI) Analysis Engine

### 4.1 Biological Concept & Rationale
In *Drosophila* circadian biology under 12:12 Light:Dark (LD) cycles, locomotor activity exhibits characteristic bimodal peaks:
- **Morning Peak**: Regulated by morning oscillator neurons (e.g., pigment-dispersing factor [PDF]-expressing s-LNvs), preparing the fly for lights-on at Zeitgeber Time 0 (ZT0 / ZT24).
- **Evening Peak**: Regulated by evening oscillator neurons (e.g., PDF-negative LNds and 5th s-LNv), preparing the fly for lights-off at Zeitgeber Time 12 (ZT12).

The **Anticipation Index (AI)** quantifies the proportion of activity occurring in the 3-hour window immediately prior to a light transition relative to the wider 6-hour pre-transition window. It directly distinguishes genuine circadian clock-driven anticipation from mere acute startle responses to environmental transitions.

### 4.2 Algorithm Specification & Code Implementation

The canonical algorithm calculates anticipation for any transition time (ZT) using a ratio of 3-hour ($w_3$) to 6-hour ($w_6$) pre-transition activity:

```python
def anticipation_index(activity_by_zt, transition_zt, binsize_h):
    # activity_by_zt: counts for one fly, one day, indexed by bin start (ZT hours)
    w3 = sum(a for zt, a in activity_by_zt if in_window(zt, transition_zt - 3, transition_zt))
    w6 = sum(a for zt, a in activity_by_zt if in_window(zt, transition_zt - 6, transition_zt))
    return w3 / w6 if w6 > 0 else None   # optionally subtract 0.5
```

#### Parameter & Window Definitions:
1. **Morning Anticipation Index (MAI)**:
   - `transition_zt = 0` (or `24`, corresponding to Dark-to-Light transition / lights-on).
   - $w_3$ Window: $ZT \in [21, 24)$ (3 hours immediately preceding lights-on).
   - $w_6$ Window: $ZT \in [18, 24)$ (6 hours preceding lights-on).
   - Formula:
     $$\text{MAI} = \frac{\sum_{ZT=21}^{24} \text{Activity}}{\sum_{ZT=18}^{24} \text{Activity}}$$

2. **Evening Anticipation Index (EAI)**:
   - `transition_zt = 12` (corresponding to Light-to-Dark transition / lights-off in standard LD 12:12).
   - $w_3$ Window: $ZT \in [9, 12)$ (3 hours immediately preceding lights-off).
   - $w_6$ Window: $ZT \in [6, 12)$ (6 hours preceding lights-off).
   - Formula:
     $$\text{EAI} = \frac{\sum_{ZT=9}^{12} \text{Activity}}{\sum_{ZT=6}^{12} \text{Activity}}$$

3. **Baseline Normalization & Zero-Division Handling**:
   - **Neutral Baseline ($0.5$)**: If a fly displays perfectly uniform, flat activity across the 6-hour window, $w_3 / w_6 = 3 / 6 = 0.5$. Values $> 0.5$ indicate positive anticipation (progressive ramping of activity), whereas values $< 0.5$ denote decreasing or suppressed pre-transition activity.
   - **Optional Zero-Centering (`subtract_0.5 = TRUE`)**: When enabled in the UI, subtracting $0.5$ transforms the neutral baseline to $0.0$ (range $[-0.5, +0.5]$), where values $> 0$ denote positive anticipation.
   - **Quiescent Fly Guard**: If total activity in the 6-hour window is zero ($w_6 = 0$), the index evaluates to `None` (`NA_real_`) to prevent division-by-zero artifacts.

### 4.3 R / Rethomics Pipeline Integration

```r
# Vectorized Anticipation Index Engine for Rethomics / behavr data
calc_anticipation_indices <- function(dt, transition_morning = 0, transition_evening = 12, subtract_half = FALSE) {
  # Helper for circular 24h interval membership
  in_window <- function(zt, start, end) {
    if (start < end) (zt >= start & zt < end)
    else (zt >= start | zt < end)
  }
  
  # Ensure ZT is expressed in 0-24 hours
  dt[, zt_hour := (t / 3600) %% 24]
  
  # Group by individual fly id and experimental LD day
  ai_summary <- dt[, {
    # Morning windows (ZT 21-24 vs ZT 18-24)
    m_w3 <- sum(activity[in_window(zt_hour, (transition_morning - 3) %% 24, transition_morning %% 24)], na.rm = TRUE)
    m_w6 <- sum(activity[in_window(zt_hour, (transition_morning - 6) %% 24, transition_morning %% 24)], na.rm = TRUE)
    mai <- if (m_w6 > 0) m_w3 / m_w6 else NA_real_
    
    # Evening windows (ZT 9-12 vs ZT 6-12)
    e_w3 <- sum(activity[in_window(zt_hour, (transition_evening - 3) %% 24, transition_evening %% 24)], na.rm = TRUE)
    e_w6 <- sum(activity[in_window(zt_hour, (transition_evening - 6) %% 24, transition_evening %% 24)], na.rm = TRUE)
    eai <- if (e_w6 > 0) e_w3 / e_w6 else NA_real_
    
    if (subtract_half) {
      if (!is.na(mai)) mai <- mai - 0.5
      if (!is.na(eai)) eai <- eai - 0.5
    }
    
    list(
      MAI = mai,
      EAI = eai,
      m_w3 = m_w3,
      m_w6 = m_w6,
      e_w3 = e_w3,
      e_w6 = e_w6
    )
  }, by = .(id, day, genotype)]
  
  return(ai_summary)
}
```

---

## 5. Visualizations & Plots Specifications

| Visualization Name | Library / Function | X-Axis | Y-Axis / Z-Axis | Grouping / Faceting | Purpose |
|---|---|---|---|---|---|
| **Individual Actograms** | `ggetho::stat_bar_tile_etho()` | Time (h, 0–72h) | `period` (Days 0–N) | Facet by `region_id` | Multi-period wrapped bar actograms showing individual fly activity counts |
| **Average Group Actogram** | `ggetho::stat_bar_tile_etho()` | Time (h, 0–72h) | `period` (Days 0–N) | Facet by `genotype` | Population mean multi-period wrapped bar actogram comparison |
| **Whole Exp Activity Profile** | `ggetho::stat_pop_etho()` | Time (Days) | Activity Rate | Color by `genotype` | Continuous activity trajectory across entire experiment |
| **24-Hour Sleep Profile** | `ggetho::stat_pop_etho() + stat_ld_annotations()` | Time of Day (24h wrap) | Fraction Asleep (0 to 1) | Color by `genotype` | Diurnal sleep distribution with LD light/dark bar |
| **24-Hour Activity Profile** | `ggetho::stat_pop_etho() + stat_ld_annotations()` | Time of Day (24h wrap) | Mean Activity Count | Color by `genotype` | Diurnal activity distribution with LD light/dark bar and anticipation window shading ($w_3$ & $w_6$) |
| **Morning Anticipation Box Plot (MAI)** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Morning Anticipation Index (MAI) | Fill by `genotype` | Statistical comparison of lights-on anticipation across groups |
| **Evening Anticipation Box Plot (EAI)** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Evening Anticipation Index (EAI) | Fill by `genotype` | Statistical comparison of lights-off anticipation across groups |
| **Daily Sleep Box Plot** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Total Daily Sleep (min/day) | Fill by `genotype` | Statistical comparison of daily sleep quantity |
| **Daily Activity Box Plot** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Total Daily Activity Count | Fill by `genotype` | Statistical comparison of overall activity volume |
| **Sleep Bout Analysis** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Bout Count / Mean Bout Length | Fill by `genotype` | Assess sleep fragmentation (bout frequency vs duration) |
| **Chi-Square Periodogram** | `zeitgebr::ggperio()` | Period (Hours, 18-32h) | Power ($Q_p$) | Facet by `genotype`, Color by `id` | Circadian rhythmicity & period determination |

---

## 6. Statistical Testing Suite
- **Normality Assessment**: Shapiro-Wilk test on per-group metrics (`sleep_min_day`, `period_hours`, `MAI`, `EAI`).
- **Two-Group Comparisons**: Mann-Whitney U / Wilcoxon rank-sum test (`wilcox.test(MAI ~ genotype)`, `wilcox.test(EAI ~ genotype)`, `wilcox.test(sleep_min_day ~ genotype)`).
- **Multi-Group Comparisons**: Kruskal-Wallis test followed by post-hoc Dunn's test with Bonferroni adjustment.
- **Anticipation Index Baseline Significance**: One-sample Wilcoxon signed-rank test against baseline (0.5 or 0.0 if subtracted) to determine whether anticipation is statistically significant within each genotype.
- **Rhythmicity Classification**:
  - Peak period determination using `zeitgebr::find_peaks()`.
  - Classification into Rhythmic ($Power \ge Significance Threshold$) vs Arrhythmic.

---

## 7. Functional UI Layout & Tab Architecture

### Header Bar
- App Title: **Zantiks-to-Rethomics Behavioral Analyzer**
- Workflow Indicator: Upload -> Convert -> Verify -> Analyze -> Export

### Tab 1: Data Conversion & Ingestion
- **Option A (Zantiks CSV Conversion)**: Upload raw Zantiks CSV output, preview start datetime, duration, and well channels, then convert to standard 42-column DAM format.
- **Option B (Direct Multi-Monitor DAM Upload)**: Upload multiple pre-existing DAM monitor tab-separated files simultaneously (up to 10 monitors, e.g. `Monitor1.txt`, `Monitor2.txt`, ..., `Monitor10.txt`) to bypass Zantiks conversion and analyze multi-monitor datasets concurrently.
- Live preview of loaded DAM datasets (monitor counts, total channels, row counts, date ranges, bin sizes).

### Tab 2: Metadata Management
- Upload Metadata CSV File
- Automated cross-validation (matching region IDs/wells, checking for missing values, observation status)
- Interactive table editor for quick metadata corrections

### Tab 3: Actogram Studio
- Individual fly multi-period wrapped bar actograms (faceted by channel `1` to `23`)
- Group average multi-period wrapped bar actograms by genotype
- Multiplot period length selection (24h, 48h, 72h)
- Activity height scaling and custom color palette selector

### Tab 4: Sleep & Activity Profiles
- Whole experiment time-series plot
- 24-hour time-wrapped sleep profile with customizable LD annotations
- 24-hour time-wrapped activity profile with highlighted Morning (ZT18–24) and Evening (ZT6–12) anticipation calculation windows
- Separate entrainment (LD) vs free-running (DD) phase analysis toggles

### Tab 5: Box Plots & Statistical Testing
- Interactive box plots for:
  - **Morning Anticipation Index (MAI)**
  - **Evening Anticipation Index (EAI)**
  - Daily Sleep (min/day)
  - Daily Activity Volume
  - Sleep Bout Count & Mean Bout Length
- **Anticipation Analysis Controls**:
  - Checkbox toggle: `Subtract 0.5 (Center baseline at 0.0)`
  - Transition ZT configuration (Default: Lights-on = ZT0, Lights-off = ZT12)
  - LD Day selector (e.g. Days 2 to 5, excluding initial acclimation day)
- Live Wilcoxon / Kruskal-Wallis / ANOVA test output tables
- Outlier filtering options (IQR rule or z-score)

### Tab 6: Circadian Periodogram Studio
- Chi-Square Periodogram curves for all flies
- Group period distribution box plots
- Rhythmicity cutoff table (period, power, significance threshold)

### Tab 7: Data & Figure Export
- **Bulk Download Package**: One-click download of all high-resolution figures and CSV summary data bundled in a single ZIP file (`zantiks_rethomics_export.zip`)
- **Individual High-Res Figure Exports**: PNG and PDF exports at customizable DPI (100 to 600 DPI) and dimensions for all plots (`indiv_actogram`, `avg_actogram`, `24h_sleep`, `24h_activity`, `whole_exp_activity`, `periodogram`, `sleep_boxplots`, `morning_anticipation_boxplot`, `evening_anticipation_boxplot`)
- **Data Tables Export**: Cleaned CSV downloads (`sleep_summary.csv`, `anticipation_summary.csv`, `period_summary.csv`, `metadata.csv`) and converted `DAM_file.txt`


