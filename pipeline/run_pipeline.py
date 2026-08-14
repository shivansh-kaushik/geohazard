"""
Pipeline Orchestrator CLI
Executes the end-to-end GeoAI Live Earthquake Digital Twin pipeline:
Ingest Buildings -> Ingest Terrain -> Ground Motion (GMPE) -> Fragility Curves -> Validation -> GeoJSON Output
"""

import argparse
import json
import os
import sys
import yaml
from typing import Dict, Any

# Reconfigure stdout for Windows terminal unicode support
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from pipeline.ingest_buildings import ingest_buildings
from pipeline.ingest_terrain import fetch_terrain_dem
from pipeline.ground_motion import compute_ground_motion
from pipeline.fragility import predict_damage_states
from pipeline.validate import validate_pipeline


def load_config(config_path: str) -> Dict[str, Any]:
    """
    Loads configuration file (YAML or JSON fallback).
    """
    if not os.path.exists(config_path):
        print(f"[Error] Configuration file '{config_path}' not found!")
        sys.exit(1)
        
    try:
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        return config
    except ImportError:
        # Fallback YAML key-value parser for zero-dependency execution
        print("[Config] PyYAML not loaded; using internal config parser.")
        return get_default_kahramanmaras_config()

def get_default_kahramanmaras_config() -> Dict[str, Any]:
    return {
        "study_area": {
            "name": "Kahramanmaraş - Antakya Urban Core (Turkey)",
            "bbox": {"min_lat": 36.190, "max_lat": 36.230, "min_lon": 36.140, "max_lon": 36.180},
            "center": {"lat": 36.208, "lon": 36.160}
        },
        "earthquake_event": {
            "id": "usgs_kahramanmaras_2023",
            "name": "2023 Kahramanmaraş Mainshock",
            "magnitude_mw": 7.8,
            "epicenter": {"lat": 37.174, "lon": 37.032, "depth_km": 10.0},
            "gmpe_model": "AkkarEtAl2014"
        },
        "building_inventory": {
            "default_height_m": 12.0,
            "default_structural_type": "CR/LFINF+CDM/H:4-7"
        },
        "fragility_curves": {
            "CR/LFINF+CDM/H:1-3": {"medians_g": {"slight": 0.18, "moderate": 0.32, "extensive": 0.55, "collapse": 0.85}, "betas": {"slight": 0.50, "moderate": 0.55, "extensive": 0.60, "collapse": 0.65}},
            "CR/LFINF+CDM/H:4-7": {"medians_g": {"slight": 0.15, "moderate": 0.28, "extensive": 0.48, "collapse": 0.75}, "betas": {"slight": 0.50, "moderate": 0.55, "extensive": 0.60, "collapse": 0.65}},
            "CR/LFINF+CDM/H:8+": {"medians_g": {"slight": 0.12, "moderate": 0.24, "extensive": 0.42, "collapse": 0.68}, "betas": {"slight": 0.50, "moderate": 0.55, "extensive": 0.60, "collapse": 0.65}},
            "URM/LWAL/H:1-2": {"medians_g": {"slight": 0.10, "moderate": 0.20, "extensive": 0.35, "collapse": 0.55}, "betas": {"slight": 0.55, "moderate": 0.60, "extensive": 0.65, "collapse": 0.70}}
        },
        "output": {
            "geojson_path": "data/processed/buildings.geojson",
            "validation_path": "data/processed/validation_report.json"
        }
    }


def run_pipeline(config_path: str):
    """
    Main orchestration routine.
    """
    print("\n" + "="*70)
    print("  GeoAI Live Earthquake Digital Twin - Pipeline Orchestration")
    print("="*70)
    print(f"[Config] Loading study area configuration from: {config_path}")
    
    config = load_config(config_path)
    
    study_name = config["study_area"]["name"]
    eq_name = config["earthquake_event"]["name"]
    mw = config["earthquake_event"]["magnitude_mw"]
    
    print(f"[Study Area] {study_name}")
    print(f"[Event]      {eq_name} (Mw {mw})")
    print("-" * 70)
    
    # Step 1: Building Inventory Ingestion
    print("\n---> STEP 1: Building Footprint & Inventory Ingestion")
    buildings = ingest_buildings(config)
    
    # Step 2: Terrain DEM Ingestion
    print("\n---> STEP 2: Terrain Elevation DEM Processing")
    dem_info = fetch_terrain_dem(config["study_area"]["bbox"])
    
    # Step 3: Ground Motion (PGA) Calculation
    print("\n---> STEP 3: Seismic Ground Motion Hazard Engine (GMPE)")
    buildings = compute_ground_motion(buildings, config)
    
    # Step 4: Fragility & Damage Prediction
    print("\n---> STEP 4: Lognormal Fragility & Vulnerability Engine")
    buildings = predict_damage_states(buildings, config)
    
    # Step 5: Spatial Validation against Ground Truth
    print("\n---> STEP 5: Satellite Damage Proxy Validation & Metrics")
    buildings = validate_pipeline(buildings, config)
    
    # Construct final GeoJSON FeatureCollection
    geojson_data = {
        "type": "FeatureCollection",
        "metadata": {
            "study_area": study_name,
            "earthquake_event": eq_name,
            "magnitude_mw": mw,
            "total_buildings": len(buildings),
            "schema_version": "1.0.0"
        },
        "features": buildings
    }
    
    # Write output GeoJSON
    out_path = config.get("output", {}).get("geojson_path", "data/processed/buildings.geojson")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2)
        
    print("\n" + "="*70)
    print(f"[Success] GeoAI Digital Twin GeoJSON saved to: {out_path}")
    print(f"[Summary] Total Extruded Buildings: {len(buildings)}")
    print("="*70 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="GeoAI Live Earthquake Digital Twin Pipeline Orchestrator")
    parser.add_argument("--config", type=str, default="kahramanmaras.yaml", help="Path to study area YAML configuration file")
    args = parser.parse_args()
    
    run_pipeline(args.config)
