# GeoAI Live Earthquake Digital Twin (Phase 1 Prototype)

[![Python](https://img.shields.io/badge/Python-3.12-blue.svg)](https://python.org)
[![CesiumJS](https://img.shields.io/badge/CesiumJS-1.115-orange.svg)](https://cesium.com)
[![Hazard Engine](https://img.shields.io/badge/Hazard-OpenQuake%20%2F%20GMPE-green.svg)](https://github.com/gem/oq-engine)

A 3D spatial Digital Twin prototype for real historical earthquake simulation, ground motion hazard modeling, and damage state estimation. Applied to the **2023 Kahramanmaraş, Turkey ($M_w 7.8$)** earthquake sequence.

---

## Technical Features

1. **Building Inventory Ingestion**: Downloads real building footprints (OpenStreetMap / Google Open Buildings) for the study area bounding box, assigns structural heights and GEM taxonomy codes (`CR/LFINF+CDM/H:1-3`, `CR/LFINF+CDM/H:4-7`, `CR/LFINF+CDM/H:8+`, `URM/LWAL/H:1-2`).
2. **Ground Motion Engine**: Computes site-specific Peak Ground Acceleration ($PGA$, in $g$) using regional GMPEs (Akkar et al. / Boore et al.) calibrated against USGS ShakeMap data.
3. **Lognormal Fragility & Vulnerability**: Calculates discrete damage exceedance probabilities (`none`, `slight`, `moderate`, `extensive`, `collapse`) via lognormal cumulative distribution functions ($PGA$, median $\theta$, dispersion $\beta$).
4. **Interactive 3D Web Viewer**: Renders extruded 3D urban buildings in CesiumJS with Before/After toggling, dynamic damage state color schemes, building collapse deformation, and click-to-inspect analytical cards.
5. **Spatial Validation**: Evaluates model performance against satellite damage proxy observations (confusion matrix, accuracy, precision, recall).
6. **PhD Technical Documentation**: Full mathematical formulation and research paper available in [`RESEARCH_DOCUMENTATION.md`](RESEARCH_DOCUMENTATION.md).

---

## Quick Start

### 1. Environment Setup

Using `uv` (recommended) or standard Python 3.12 virtual environment:

```bash
uv venv .venv --python 3.12
.venv\Scripts\activate
uv pip install -r requirements.txt
```

### 2. Run the Full Hazard & Damage Pipeline

```bash
python pipeline/run_pipeline.py --config kahramanmaras.yaml
```

This generates `data/processed/buildings.geojson` conforming to the per-building data schema contract.

### 3. Launch the Interactive 3D Digital Twin Viewer

Start a local HTTP server:

```bash
python -m http.server 8000
```

Open your browser to: `http://localhost:8000/viewer/index.html`

---

## Per-Building Data Schema Contract

```json
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [...] },
  "properties": {
    "building_id": "bldg_antakya_001042",
    "height_m": 15.0,
    "height_source": "osm_levels",
    "structural_type": "CR/LFINF+CDM/H:4-7",
    "structural_type_source": "assumed_default_for_region",
    "pga_g": 0.482,
    "damage_state_probs": {
      "none": 0.041,
      "slight": 0.138,
      "moderate": 0.295,
      "extensive": 0.342,
      "collapse": 0.184
    },
    "predicted_damage_state": "extensive",
    "ground_truth_damage_state": "extensive"
  }
}
```

---

## Repository Structure

```
geohazard/
├── data/
│   ├── raw/                  # Downloaded raw building footprints & DEM
│   ├── processed/            # Output GeoJSON payload (buildings.geojson)
│   └── validation/           # Ground truth damage proxy reference data
├── pipeline/
│   ├── ingest_buildings.py   # Vector footprint fetch & GEM taxonomy tagging
│   ├── ingest_terrain.py     # Copernicus GLO-30 DEM ingestion
│   ├── ground_motion.py      # OpenQuake / GMPE hazard computation (PGA)
│   ├── fragility.py          # Lognormal fragility CDF damage matrix calculator
│   ├── validate.py           # Confusion matrix & accuracy metric engine
│   └── run_pipeline.py       # Config-driven CLI pipeline orchestrator
├── viewer/
│   ├── index.html            # CesiumJS 3D digital twin viewer interface
│   ├── app.js                # 3D building rendering, interaction & before/after state manager
│   └── style.css             # Glassmorphism dark UI styling
├── kahramanmaras.yaml        # Study area & earthquake event parameters
├── requirements.txt          # Python dependencies
├── RESEARCH_DOCUMENTATION.md # PhD-grade mathematical & methodological paper
└── README.md
```
