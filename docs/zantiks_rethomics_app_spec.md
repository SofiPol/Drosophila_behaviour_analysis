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

## 4. Visualizations & Plots Specifications

| Visualization Name | Library / Function | X-Axis | Y-Axis / Z-Axis | Grouping / Faceting | Purpose |
|---|---|---|---|---|---|
| **Individual Actograms** | `ggetho::stat_bar_tile_etho()` | Time (h, 0–72h) | `period` (Days 0–N) | Facet by `region_id` | Multi-period wrapped bar actograms showing individual fly activity counts |
| **Average Group Actogram** | `ggetho::stat_bar_tile_etho()` | Time (h, 0–72h) | `period` (Days 0–N) | Facet by `genotype` | Population mean multi-period wrapped bar actogram comparison |
| **Whole Exp Activity Profile** | `ggetho::stat_pop_etho()` | Time (Days) | Activity Rate | Color by `genotype` | Continuous activity trajectory across entire experiment |
| **24-Hour Sleep Profile** | `ggetho::stat_pop_etho() + stat_ld_annotations()` | Time of Day (24h wrap) | Fraction Asleep (0 to 1) | Color by `genotype` | Diurnal sleep distribution with LD light/dark bar |
| **24-Hour Activity Profile** | `ggetho::stat_pop_etho() + stat_ld_annotations()` | Time of Day (24h wrap) | Mean Activity Count | Color by `genotype` | Diurnal activity distribution with LD light/dark bar |
| **Daily Sleep Box Plot** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Total Daily Sleep (min/day) | Fill by `genotype` | Statistical comparison of daily sleep quantity |
| **Daily Activity Box Plot** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Total Daily Activity Count | Fill by `genotype` | Statistical comparison of overall activity volume |
| **Sleep Bout Analysis** | `ggplot2::geom_boxplot() + geom_jitter()` | `genotype` | Bout Count / Mean Bout Length | Fill by `genotype` | Assess sleep fragmentation (bout frequency vs duration) |
| **Chi-Square Periodogram** | `zeitgebr::ggperio()` | Period (Hours, 18-32h) | Power ($Q_p$) | Facet by `genotype`, Color by `id` | Circadian rhythmicity & period determination |

---

## 5. Statistical Testing Suite
- **Normality Assessment**: Shapiro-Wilk test on per-group metrics (`sleep_min_day`, `period_hours`).
- **Two-Group Comparisons**: Mann-Whitney U / Wilcoxon rank-sum test (`wilcox.test(sleep_min_day ~ genotype)`).
- **Multi-Group Comparisons**: Kruskal-Wallis test followed by post-hoc Dunn's test with Bonferroni adjustment.
- **Rhythmicity Classification**:
  - Peak period determination using `zeitgebr::find_peaks()`.
  - Classification into Rhythmic ($Power \ge Significance Threshold$) vs Arrhythmic.

---

## 6. Functional UI Layout & Tab Architecture

### Header Bar
- App Title: **Zantiks-to-Rethomics Behavioral Analyzer**
- Workflow Indicator: Upload -> Convert -> Verify -> Analyze -> Export

### Tab 1: Data Conversion & Ingestion
- Upload Zantiks CSV File(s)
- Live preview of extracted start datetime, duration, and well channels
- One-click **"Convert to DAM Format"** button with download option for transformed `.txt` file

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
- 24-hour time-wrapped activity profile
- Separate entrainment (LD) vs free-running (DD) phase analysis toggles

### Tab 5: Box Plots & Statistical Testing
- Interactive box plots for Daily Sleep (min/day), Daily Activity, Bout Count, Mean Bout Length
- Live Wilcoxon / ANOVA test output tables
- Outlier filtering options

### Tab 6: Circadian Periodogram Studio
- Chi-Square Periodogram curves for all flies
- Group period distribution box plots
- Rhythmicity cutoff table (period, power, significance threshold)

### Tab 7: Data & Figure Export
- **Bulk Download Package**: One-click download of all high-resolution figures and CSV summary data bundled in a single ZIP file (`zantiks_rethomics_export.zip`)
- **Individual High-Res Figure Exports**: PNG and PDF exports at customizable DPI (100 to 600 DPI) and dimensions for all plots (`indiv_actogram`, `avg_actogram`, `24h_sleep`, `24h_activity`, `whole_exp_activity`, `periodogram`, `sleep_boxplots`)
- **Data Tables Export**: Cleaned CSV downloads (`sleep_summary.csv`, `period_summary.csv`, `metadata.csv`) and converted `DAM_file.txt`

