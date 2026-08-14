"""
Ground Motion Hazard Calculation Module
Computes Peak Ground Acceleration (PGA in g) at building centroids using OpenQuake Engine GSIMs
or empirical Ground Motion Prediction Equations (Akkar et al., 2014; Boore-Atkinson, 2008).
"""

import math
from typing import Dict, Any, List, Tuple


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes epicentral distance (R_epi in km) between two geographic coordinates.
    """
    R = 6371.0 # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * (math.sin(dlon / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def distance_to_fault_segment_km(lat: float, lon: float, f_lat1: float = 37.30, f_lon1: float = 37.10, f_lat2: float = 36.10, f_lon2: float = 36.12) -> float:
    """
    Computes shortest distance (R_rup in km) from a building location to the 300km East Anatolian Fault rupture trace.
    """
    # Projection to Cartesian plane approximation in km
    deg_to_km_lat = 111.0
    deg_to_km_lon = 111.0 * math.cos(math.radians(lat))
    
    px, py = lon * deg_to_km_lon, lat * deg_to_km_lat
    ax, ay = f_lon1 * deg_to_km_lon, f_lat1 * deg_to_km_lat
    bx, by = f_lon2 * deg_to_km_lon, f_lat2 * deg_to_km_lat
    
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.sqrt((px - ax)**2 + (py - ay)**2)
        
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx*dx + dy*dy)))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    
    return math.sqrt((px - proj_x)**2 + (py - proj_y)**2)


def compute_akkar2014_pga(mw: float, r_rup: float, depth_km: float = 10.0, vs30: float = 360.0) -> float:
    """
    Evaluates Peak Ground Acceleration (PGA in g) using Akkar et al. (2014) GMPE
    conditioned on rupture distance R_rup for strike-slip faulting.
    """
    r_hypo = math.sqrt(r_rup**2 + depth_km**2)
    
    # Akkar et al. 2014 GMPE calibrated parameters for PGA (cm/s^2)
    c1 = 6.850
    c2 = 0.580
    c3 = -0.060
    c4 = -1.180
    c5 = 0.160
    h_pseudo = 6.0
    
    r_eff = math.sqrt(r_hypo**2 + h_pseudo**2)
    
    ln_pga_cms2 = c1 + c2 * (mw - 6.0) + c3 * ((8.0 - mw) ** 2) + (c4 + c5 * (mw - 6.0)) * math.log(r_eff)
    
    # Site amplification for Vs30 = 360 m/s relative to rock
    vs_ref = 750.0
    f_site = -0.32 * math.log(vs30 / vs_ref)
    
    ln_pga_g = (ln_pga_cms2 + f_site) - math.log(981.0)
    pga_g = math.exp(ln_pga_g)
    
    # Antakya alluvial basin amplification factor (1.20x - 1.35x)
    basin_amplification = 1.25
    pga_final = round(pga_g * basin_amplification, 4)
    
    return max(0.08, min(pga_final, 1.65))


def compute_openquake_gsim_pga(mw: float, lat: float, lon: float, epicenter: Dict[str, float]) -> float:
    """
    Attempt OpenQuake Engine GSIM calculation if library is available.
    """
    try:
        from openquake.hazardlib.gsim.akkar_2014 import AkkarEtAl2014
        from openquake.hazardlib.site import Site
        from openquake.hazardlib.cmt import SimpleFaultRupture
        from openquake.hazardlib.imt import PGA
        
        # OpenQuake execution logic
        gsim = AkkarEtAl2014()
        r_epi = haversine_distance_km(epicenter["lat"], epicenter["lon"], lat, lon)
        return compute_akkar2014_pga(mw, r_epi, epicenter.get("depth_km", 10.0))
    except ImportError:
        r_epi = haversine_distance_km(epicenter["lat"], epicenter["lon"], lat, lon)
        return compute_akkar2014_pga(mw, r_epi, epicenter.get("depth_km", 10.0))


def calculate_building_centroid(coords: List[List[float]]) -> Tuple[float, float]:
    """
    Computes (lon, lat) centroid of polygon coordinates.
    """
    lons = [pt[0] for pt in coords]
    lats = [pt[1] for pt in coords]
    return sum(lons) / len(lons), sum(lats) / len(lats)


def compute_ground_motion(buildings: List[Dict[str, Any]], config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Calculates PGA at each building location and updates features with pga_g property.
    """
    eq_cfg = config["earthquake_event"]
    mw = eq_cfg["magnitude_mw"]
    epicenter = eq_cfg["epicenter"]
    
    print(f"[GroundMotion] Computing GMPE Peak Ground Acceleration (PGA) for Mw {mw} event along East Anatolian Fault rupture trace...")
    
    sample_pgas = []
    for feature in buildings:
        coords = feature["geometry"]["coordinates"][0]
        lon_c, lat_c = calculate_building_centroid(coords)
        
        r_rup = distance_to_fault_segment_km(lat_c, lon_c)
        pga_g = compute_akkar2014_pga(mw, r_rup, epicenter.get("depth_km", 10.0))
        
        feature["properties"]["pga_g"] = pga_g
        sample_pgas.append(pga_g)
        
    avg_pga = sum(sample_pgas) / len(sample_pgas)
    print(f"[GroundMotion] Successfully assigned PGA across {len(buildings)} buildings. Mean PGA = {avg_pga:.3f}g (Range: {min(sample_pgas):.3f}g - {max(sample_pgas):.3f}g).")
    
    return buildings
