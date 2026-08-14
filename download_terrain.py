#!/usr/bin/env python3
"""
GeoAI Platform — Terrain & Infrastructure Data Downloader
Downloads SRTM DEM + OSM roads + OSM water for Antakya study area.
Includes synthetic fallbacks for all three datasets.
"""
import urllib.request, urllib.parse, json, time, os, math, sys

os.makedirs('viewer/data', exist_ok=True)

# Antakya study area bounding box
LAT_MIN, LAT_MAX = 36.12, 36.28
LON_MIN, LON_MAX = 36.11, 36.30
REF_LAT, REF_LON = 36.21, 36.14

# ─────────────────────────────────────────────────────────────────────────────
# SYNTHETIC FALLBACK DEM
# Based on known Antakya geography: Mt. Silpius W, Asi River valley, hills E/N
# ─────────────────────────────────────────────────────────────────────────────
def synthetic_elevation(lat, lon):
    cos_lat = math.cos(math.radians(lat))
    def gauss(lat0, lon0, amp, sigma_km):
        dy = (lat - lat0) * 111.32
        dx = (lon - lon0) * 111.32 * cos_lat
        return amp * math.exp(-(dx*dx + dy*dy) / (2 * sigma_km**2))

    elev = 68.0  # Base river-valley elevation
    # Asi River valley (north-south through west side of city)
    river_lon = 36.155
    dx_river = (lon - river_lon) * 111.32 * cos_lat
    elev -= 18.0 * math.exp(-dx_river**2 / (2 * 0.25**2))
    # Mount Silpius (western ridge)
    elev += gauss(36.197, 36.128, 220, 1.2)
    # Northern hills
    elev += gauss(36.265, 36.19, 160, 1.8)
    # Eastern hills
    elev += gauss(36.21, 36.265, 110, 1.6)
    # Southern plateau
    elev += gauss(36.135, 36.22, 80, 2.0)
    return max(30, min(500, elev))


def build_synthetic_dem(rows=32, cols=32):
    lats = [LAT_MIN + (LAT_MAX - LAT_MIN) * i / (rows - 1) for i in range(rows)]
    lons = [LON_MIN + (LON_MAX - LON_MIN) * j / (cols - 1) for j in range(cols)]
    elevations = [synthetic_elevation(lat, lon) for lat in lats for lon in lons]
    return {
        'rows': rows, 'cols': cols,
        'lat_min': LAT_MIN, 'lat_max': LAT_MAX,
        'lon_min': LON_MIN, 'lon_max': LON_MAX,
        'elevations': elevations,
        'source': 'synthetic'
    }

# ─────────────────────────────────────────────────────────────────────────────
# 1. DEM ELEVATION GRID (SRTM 30m via OpenTopoData)
# ─────────────────────────────────────────────────────────────────────────────
print("[1/3] Downloading SRTM DEM elevation grid...")
ROWS, COLS = 32, 32

lats = [LAT_MIN + (LAT_MAX - LAT_MIN) * i / (ROWS - 1) for i in range(ROWS)]
lons = [LON_MIN + (LON_MAX - LON_MIN) * j / (COLS - 1) for j in range(COLS)]
all_points = [f"{lat:.6f},{lon:.6f}" for lat in lats for lon in lons]

elevations = []
failed = False
CHUNK = 100
for idx in range(0, len(all_points), CHUNK):
    chunk = all_points[idx:idx + CHUNK]
    url = "https://api.opentopodata.org/v1/srtm30m?locations=" + "|".join(chunk)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'GeoAI/1.0'})
        with urllib.request.urlopen(req, timeout=25) as r:
            data = json.loads(r.read())
        chunk_elevs = [res.get('elevation') or 65 for res in data['results']]
        elevations.extend(chunk_elevs)
        batch = idx // CHUNK + 1
        total = (len(all_points) - 1) // CHUNK + 1
        print(f"  DEM batch {batch}/{total}: min={min(chunk_elevs):.0f}m max={max(chunk_elevs):.0f}m")
        time.sleep(1.5)
    except Exception as e:
        print(f"  DEM API failed ({e}), using synthetic for this batch")
        for pt in chunk:
            lat, lon = map(float, pt.split(','))
            elevations.append(synthetic_elevation(lat, lon))
        failed = True

dem_data = {
    'rows': ROWS, 'cols': COLS,
    'lat_min': LAT_MIN, 'lat_max': LAT_MAX,
    'lon_min': LON_MIN, 'lon_max': LON_MAX,
    'elevations': elevations,
    'source': 'synthetic-partial' if failed else 'SRTM30m-OpenTopoData'
}
with open('viewer/data/antakya-dem.json', 'w') as f:
    json.dump(dem_data, f)

valid = [e for e in elevations if e]
print(f"  DEM saved: {ROWS}x{COLS}={len(elevations)} pts | "
      f"min={min(valid):.0f}m max={max(valid):.0f}m | src={dem_data['source']}")

time.sleep(2)

# ─────────────────────────────────────────────────────────────────────────────
# SYNTHETIC ROAD FALLBACK
# Approximate Antakya major road network (coordinates from OSM manual inspection)
# ─────────────────────────────────────────────────────────────────────────────
SYNTHETIC_ROADS = [
    # Highway 825 (N-S main spine, west of river)
    {'type': 'primary', 'name': 'D825 Karayolu',
     'coords': [[36.140, 36.27], [36.145, 36.25], [36.148, 36.23],
                [36.152, 36.21], [36.154, 36.19], [36.152, 36.17], [36.148, 36.14]]},
    # East-West crossing (Atatürk Caddesi)
    {'type': 'primary', 'name': 'Atatürk Caddesi',
     'coords': [[36.13, 36.21], [36.145, 36.21], [36.155, 36.21],
                [36.165, 36.21], [36.175, 36.21], [36.19, 36.21], [36.21, 36.21]]},
    # Northern ring road
    {'type': 'secondary', 'name': 'Kuzey Çevreyolu',
     'coords': [[36.13, 36.25], [36.15, 36.255], [36.17, 36.258],
                [36.19, 36.255], [36.21, 36.25]]},
    # Southern road
    {'type': 'secondary', 'name': 'Güney Yolu',
     'coords': [[36.13, 36.14], [36.155, 36.145], [36.175, 36.14],
                [36.20, 36.14], [36.22, 36.142]]},
    # Bridge road (crosses Asi River)
    {'type': 'tertiary', 'name': 'Köprübaşı',
     'coords': [[36.145, 36.215], [36.150, 36.215], [36.155, 36.215],
                [36.162, 36.215], [36.170, 36.215]]},
    # Old city road (East bank)
    {'type': 'tertiary', 'name': 'Uzun Çarşı',
     'coords': [[36.165, 36.22], [36.168, 36.215], [36.170, 36.21],
                [36.172, 36.205], [36.170, 36.20]]},
    # Residential grid (NE quadrant)
    {'type': 'residential', 'name': '', 'coords': [[36.17, 36.24], [36.18, 36.24], [36.19, 36.24], [36.20, 36.24]]},
    {'type': 'residential', 'name': '', 'coords': [[36.17, 36.23], [36.18, 36.23], [36.19, 36.23], [36.20, 36.23]]},
    {'type': 'residential', 'name': '', 'coords': [[36.18, 36.22], [36.18, 36.23], [36.18, 36.24], [36.18, 36.25]]},
    {'type': 'residential', 'name': '', 'coords': [[36.19, 36.22], [36.19, 36.23], [36.19, 36.24], [36.19, 36.25]]},
    # Southern residential
    {'type': 'residential', 'name': '', 'coords': [[36.155, 36.17], [36.165, 36.17], [36.175, 36.17], [36.185, 36.17]]},
    {'type': 'residential', 'name': '', 'coords': [[36.155, 36.16], [36.165, 36.16], [36.175, 36.16], [36.185, 36.16]]},
    {'type': 'residential', 'name': '', 'coords': [[36.165, 36.155], [36.165, 36.165], [36.165, 36.175], [36.165, 36.185]]},
    {'type': 'residential', 'name': '', 'coords': [[36.175, 36.155], [36.175, 36.165], [36.175, 36.175], [36.175, 36.185]]},
]

# ─────────────────────────────────────────────────────────────────────────────
# 2. ROAD NETWORK (OpenStreetMap Overpass API)
# ─────────────────────────────────────────────────────────────────────────────
print("[2/3] Downloading road network from OpenStreetMap...")
BBOX = f"{LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}"
roads_ql = f"""
[out:json][timeout:50];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service|unclassified"]({BBOX});
);
(._;>;);
out body;
"""
overpass_url = "https://overpass-api.de/api/interpreter"
try:
    req = urllib.request.Request(overpass_url,
        data=urllib.parse.urlencode({'data': roads_ql}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded',
                 'User-Agent': 'GeoAI-Seismic/1.0 (educational)'},
        method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        roads_raw = json.loads(r.read())

    nodes = {e['id']: (e['lat'], e['lon'])
             for e in roads_raw['elements'] if e['type'] == 'node'}
    roads = []
    for e in roads_raw['elements']:
        if e['type'] != 'way': continue
        coords = [nodes[nid] for nid in e.get('refs', []) if nid in nodes]
        if len(coords) < 2: continue
        roads.append({
            'coords': [[c[1], c[0]] for c in coords],   # [lon, lat]
            'type': e.get('tags', {}).get('highway', 'road'),
            'name': e.get('tags', {}).get('name', '')
        })
    print(f"  Roads saved: {len(roads)} OSM segments")
    with open('viewer/data/antakya-roads.json', 'w', encoding='utf-8') as f:
        json.dump({'roads': roads, 'source': 'OpenStreetMap'}, f)
except Exception as e:
    print(f"  Road API failed ({e}), using synthetic roads")
    with open('viewer/data/antakya-roads.json', 'w', encoding='utf-8') as f:
        json.dump({'roads': SYNTHETIC_ROADS, 'source': 'synthetic'}, f)

time.sleep(3)

# ─────────────────────────────────────────────────────────────────────────────
# SYNTHETIC WATER FALLBACK — Asi River (Orontes) through Antakya
# ─────────────────────────────────────────────────────────────────────────────
SYNTHETIC_WATER = [
    {
        'type': 'river', 'name': 'Asi Nehri (Orontes)',
        'coords': [
            [36.134, 36.275], [36.139, 36.265], [36.143, 36.255],
            [36.148, 36.244], [36.151, 36.232], [36.154, 36.222],
            [36.156, 36.213], [36.157, 36.205], [36.155, 36.196],
            [36.152, 36.185], [36.149, 36.175], [36.147, 36.165],
            [36.145, 36.155], [36.143, 36.145], [36.141, 36.135]
        ]
    },
    {
        'type': 'stream', 'name': 'Hacı Kürüs',
        'coords': [
            [36.128, 36.21], [36.132, 36.205], [36.138, 36.200],
            [36.143, 36.197], [36.150, 36.196]
        ]
    }
]

# ─────────────────────────────────────────────────────────────────────────────
# 3. WATER BODIES (OpenStreetMap Overpass API)
# ─────────────────────────────────────────────────────────────────────────────
print("[3/3] Downloading water bodies from OpenStreetMap...")
water_ql = f"""
[out:json][timeout:50];
(
  way["waterway"~"river|stream|canal|drain"]({BBOX});
  way["natural"~"water|wetland"]({BBOX});
);
(._;>;);
out body;
"""
try:
    req = urllib.request.Request(overpass_url,
        data=urllib.parse.urlencode({'data': water_ql}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded',
                 'User-Agent': 'GeoAI-Seismic/1.0 (educational)'},
        method='POST')
    with urllib.request.urlopen(req, timeout=60) as r:
        water_raw = json.loads(r.read())

    nodes = {e['id']: (e['lat'], e['lon'])
             for e in water_raw['elements'] if e['type'] == 'node'}
    waters = []
    for e in water_raw['elements']:
        if e['type'] != 'way': continue
        coords = [nodes[nid] for nid in e.get('refs', []) if nid in nodes]
        if len(coords) < 2: continue
        wtype = e.get('tags', {}).get('waterway',
                e.get('tags', {}).get('natural', 'water'))
        waters.append({
            'coords': [[c[1], c[0]] for c in coords],
            'type': wtype,
            'name': e.get('tags', {}).get('name', '')
        })
    print(f"  Water saved: {len(waters)} OSM features")
    with open('viewer/data/antakya-water.json', 'w', encoding='utf-8') as f:
        json.dump({'water': waters, 'source': 'OpenStreetMap'}, f)
except Exception as e:
    print(f"  Water API failed ({e}), using synthetic river")
    with open('viewer/data/antakya-water.json', 'w', encoding='utf-8') as f:
        json.dump({'water': SYNTHETIC_WATER, 'source': 'synthetic'}, f)

print("\n✅ All terrain data ready in viewer/data/")
print("   antakya-dem.json  — elevation grid")
print("   antakya-roads.json — road network")
print("   antakya-water.json — rivers/water")
